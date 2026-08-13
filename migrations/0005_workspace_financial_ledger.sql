-- Ledger financeiro provider-agnostic. Aditivo, sem backfill e sem dados remotos.
-- O runner substitui o token final pelo SHA-256 desta representacao canonica.
CREATE TABLE IF NOT EXISTS workspace_financial_transactions (
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  statement_id TEXT,
  order_id TEXT,
  adjustment_order_id TEXT,
  transaction_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  revenue NUMERIC(18,2),
  buyer_shipping NUMERIC(18,2),
  seller_shipping NUMERIC(18,2),
  commission NUMERIC(18,2),
  payment_fee NUMERIC(18,2),
  fulfillment_fee NUMERIC(18,2),
  ads NUMERIC(18,2),
  taxes_withheld NUMERIC(18,2),
  refunds NUMERIC(18,2),
  adjustment NUMERIC(18,2),
  settlement_amount NUMERIC(18,2),
  settlement_state TEXT NOT NULL DEFAULT 'unsettled'
    CHECK (settlement_state IN ('unsettled', 'settled', 'reversed')),
  is_estimated BOOLEAN NOT NULL DEFAULT FALSE,
  source_resource TEXT NOT NULL,
  source_record_id TEXT,
  source_observed_at TIMESTAMPTZ NOT NULL,
  source_rank SMALLINT NOT NULL CHECK (source_rank BETWEEN 0 AND 100),
  raw_allowlisted JSONB CHECK (
    raw_allowlisted IS NULL OR
    (jsonb_typeof(raw_allowlisted) = 'object' AND pg_column_size(raw_allowlisted) <= 16384)
  ),
  raw_sha256 BYTEA NOT NULL CHECK (octet_length(raw_sha256) = 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider, connection_id, transaction_id),
  CONSTRAINT financial_transactions_provenance_check CHECK (
    source_resource = btrim(source_resource) AND source_resource <> '' AND
    (
      (settlement_state = 'unsettled' AND is_estimated AND source_rank < 100) OR
      (settlement_state IN ('settled', 'reversed') AND NOT is_estimated AND source_rank = 100)
    )
  ),
  CONSTRAINT financial_transactions_statement_source_check CHECK (
    source_resource <> 'statement_transactions' OR
    (statement_id IS NOT NULL AND NOT is_estimated AND source_rank = 100
      AND settlement_state IN ('settled', 'reversed'))
  ),
  CONSTRAINT financial_transactions_pending_source_check CHECK (
    source_resource <> 'unsettled' OR
    (statement_id IS NULL AND is_estimated AND source_rank < 100
      AND settlement_state = 'unsettled')
  )
);

CREATE INDEX IF NOT EXISTS financial_transactions_period_idx
  ON workspace_financial_transactions
  (workspace_id, provider, connection_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS financial_transactions_order_idx
  ON workspace_financial_transactions
  (workspace_id, provider, connection_id, order_id)
  WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS financial_transactions_statement_idx
  ON workspace_financial_transactions
  (workspace_id, provider, connection_id, statement_id)
  WHERE statement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS financial_transactions_unsettled_idx
  ON workspace_financial_transactions
  (workspace_id, provider, connection_id, occurred_at)
  WHERE settlement_state = 'unsettled';

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_transactions_order_fk'
    AND conrelid = 'workspace_financial_transactions'::regclass) THEN
    ALTER TABLE workspace_financial_transactions
      ADD CONSTRAINT financial_transactions_order_fk
      FOREIGN KEY (workspace_id, provider, connection_id, order_id)
      REFERENCES workspace_channel_orders
        (workspace_id, provider, connection_id, external_order_id)
      DEFERRABLE INITIALLY DEFERRED NOT VALID;
  END IF;
END
$migration$;

-- Pagamentos conciliam repasse bancario. Deliberadamente nao sao componentes
-- de lucro: nenhum FK ou coluna os mistura ao ledger de transacoes.
CREATE TABLE IF NOT EXISTS workspace_financial_payments (
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  statement_id TEXT,
  status TEXT NOT NULL,
  amount NUMERIC(18,2),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  paid_at TIMESTAMPTZ,
  expected_at TIMESTAMPTZ,
  is_estimated BOOLEAN NOT NULL DEFAULT FALSE,
  source_observed_at TIMESTAMPTZ NOT NULL,
  raw_sha256 BYTEA NOT NULL CHECK (octet_length(raw_sha256) = 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider, connection_id, payment_id),
  CHECK (NOT is_estimated OR paid_at IS NULL)
);
CREATE INDEX IF NOT EXISTS financial_payments_statement_idx
  ON workspace_financial_payments
  (workspace_id, provider, connection_id, statement_id)
  WHERE statement_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS workspace_financial_sync_checkpoints (
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  window_from TIMESTAMPTZ NOT NULL,
  window_to TIMESTAMPTZ NOT NULL,
  cursor_token TEXT,
  cursor_hash_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  page_number INTEGER NOT NULL DEFAULT 0 CHECK (page_number >= 0),
  terminal_cursor BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  owner_token UUID,
  fencing_token BIGINT NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  lease_until TIMESTAMPTZ,
  rows_seen BIGINT NOT NULL DEFAULT 0 CHECK (rows_seen >= 0),
  rows_written BIGINT NOT NULL DEFAULT 0 CHECK (rows_written >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  last_error_code TEXT,
  last_error_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider, connection_id, resource, window_from, window_to),
  CHECK (window_from < window_to),
  CHECK (completed_at IS NULL OR (terminal_cursor AND cursor_token IS NULL)),
  CONSTRAINT financial_checkpoint_cursor_history_check CHECK (
    pg_column_size(cursor_hash_history) <= 20480 AND
    jsonb_path_match(cursor_hash_history,
      '$.type() == "array" && $.size() <= 256 && !exists($[*] ? (@.type() != "string" || !(@ like_regex "^[0-9a-f]{64}$")))')
  ),
  CHECK ((owner_token IS NULL) = (lease_until IS NULL))
);
CREATE INDEX IF NOT EXISTS financial_checkpoints_due_idx
  ON workspace_financial_sync_checkpoints (provider, resource, lease_until, updated_at)
  WHERE completed_at IS NULL;

CREATE OR REPLACE FUNCTION financial_checkpoint_claim(
  p_workspace_id TEXT, p_provider TEXT, p_connection_id TEXT, p_resource TEXT,
  p_window_from TIMESTAMPTZ, p_window_to TIMESTAMPTZ,
  p_owner_token UUID, p_lease_ms INTEGER
) RETURNS TABLE (acquired BOOLEAN, fencing_token BIGINT, db_now TIMESTAMPTZ)
LANGUAGE plpgsql AS $function$
DECLARE v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_lease_ms < 1000 OR p_window_from >= p_window_to THEN RAISE EXCEPTION 'invalid checkpoint claim'; END IF;
  INSERT INTO workspace_financial_sync_checkpoints
    (workspace_id, provider, connection_id, resource, window_from, window_to,
     owner_token, fencing_token, lease_until, updated_at)
  VALUES (p_workspace_id, p_provider, p_connection_id, p_resource, p_window_from,
          p_window_to, p_owner_token, 1, v_now + p_lease_ms * interval '1 millisecond', v_now)
  ON CONFLICT (workspace_id, provider, connection_id, resource, window_from, window_to)
  DO UPDATE SET owner_token = EXCLUDED.owner_token,
    fencing_token = workspace_financial_sync_checkpoints.fencing_token + 1,
    lease_until = EXCLUDED.lease_until, updated_at = v_now
  WHERE workspace_financial_sync_checkpoints.completed_at IS NULL
    AND (workspace_financial_sync_checkpoints.lease_until IS NULL
      OR workspace_financial_sync_checkpoints.lease_until <= v_now);
  RETURN QUERY SELECT c.owner_token = p_owner_token AND c.lease_until > v_now,
    c.fencing_token, v_now FROM workspace_financial_sync_checkpoints c
  WHERE c.workspace_id=p_workspace_id AND c.provider=p_provider
    AND c.connection_id=p_connection_id AND c.resource=p_resource
    AND c.window_from=p_window_from AND c.window_to=p_window_to;
END $function$;

CREATE OR REPLACE FUNCTION financial_checkpoint_advance(
  p_workspace_id TEXT, p_provider TEXT, p_connection_id TEXT, p_resource TEXT,
  p_window_from TIMESTAMPTZ, p_window_to TIMESTAMPTZ, p_owner_token UUID,
  p_fencing_token BIGINT, p_cursor_token TEXT, p_cursor_sha256 BYTEA, p_page_number INTEGER,
  p_terminal_cursor BOOLEAN, p_rows_seen BIGINT, p_rows_written BIGINT
) RETURNS BOOLEAN LANGUAGE sql AS $function$
  UPDATE workspace_financial_sync_checkpoints SET
    cursor_token = CASE WHEN p_terminal_cursor THEN NULL ELSE p_cursor_token END,
    cursor_hash_history = CASE WHEN p_terminal_cursor THEN '[]'::jsonb
      ELSE cursor_hash_history || jsonb_build_array(encode(p_cursor_sha256, 'hex')) END,
    page_number = p_page_number, terminal_cursor = p_terminal_cursor,
    completed_at = CASE WHEN p_terminal_cursor THEN clock_timestamp() ELSE NULL END,
    rows_seen = p_rows_seen, rows_written = p_rows_written,
    updated_at = clock_timestamp()
  WHERE workspace_id=p_workspace_id AND provider=p_provider
    AND connection_id=p_connection_id AND resource=p_resource
    AND window_from=p_window_from AND window_to=p_window_to
    AND owner_token=p_owner_token AND fencing_token=p_fencing_token
    AND lease_until > clock_timestamp()
    AND ((p_terminal_cursor AND p_cursor_token IS NULL AND p_cursor_sha256 IS NULL)
      OR (NOT p_terminal_cursor AND p_cursor_token IS NOT NULL
        AND octet_length(p_cursor_sha256) = 32
        AND jsonb_array_length(cursor_hash_history) < 256
        AND NOT cursor_hash_history @> jsonb_build_array(encode(p_cursor_sha256, 'hex'))))
  RETURNING TRUE
$function$;

REVOKE ALL ON TABLE workspace_financial_transactions FROM PUBLIC;
REVOKE ALL ON TABLE workspace_financial_payments FROM PUBLIC;
REVOKE ALL ON TABLE workspace_financial_sync_checkpoints FROM PUBLIC;
REVOKE ALL ON FUNCTION financial_checkpoint_claim(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,UUID,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION financial_checkpoint_advance(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,UUID,BIGINT,TEXT,BYTEA,INTEGER,BOOLEAN,BIGINT,BIGINT) FROM PUBLIC;
ALTER TABLE workspace_financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_financial_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_financial_sync_checkpoints ENABLE ROW LEVEL SECURITY;

-- Sem policy: clientes Supabase ficam fail-closed. O owner PostgreSQL ignora RLS;
-- o runtime deve usar a role dedicada fornecida e validada pelo runner.
DO $grants$
DECLARE runtime_role name := current_setting('sellercore.runtime_role', true);
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE workspace_financial_transactions, workspace_financial_payments, workspace_financial_sync_checkpoints FROM anon;
    REVOKE ALL ON FUNCTION financial_checkpoint_claim(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,UUID,INTEGER), financial_checkpoint_advance(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,UUID,BIGINT,TEXT,BYTEA,INTEGER,BOOLEAN,BIGINT,BIGINT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE workspace_financial_transactions, workspace_financial_payments, workspace_financial_sync_checkpoints FROM authenticated;
    REVOKE ALL ON FUNCTION financial_checkpoint_claim(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,UUID,INTEGER), financial_checkpoint_advance(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,UUID,BIGINT,TEXT,BYTEA,INTEGER,BOOLEAN,BIGINT,BIGINT) FROM authenticated;
  END IF;
  IF runtime_role IS NULL OR runtime_role = '' OR runtime_role IN ('public','anon','authenticated')
     OR runtime_role = current_user
     OR NOT EXISTS (SELECT 1 FROM pg_roles r WHERE rolname=runtime_role AND NOT rolsuper AND NOT rolbypassrls
       AND r.oid <> (SELECT nspowner FROM pg_namespace WHERE nspname=current_schema())
       AND r.oid <> (SELECT datdba FROM pg_database WHERE datname=current_database())) THEN
    RAISE EXCEPTION 'runtime role ausente ou insegura';
  END IF;
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE workspace_financial_transactions, workspace_financial_payments, workspace_financial_sync_checkpoints TO %I', runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION financial_checkpoint_claim(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,UUID,INTEGER), financial_checkpoint_advance(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,UUID,BIGINT,TEXT,BYTEA,INTEGER,BOOLEAN,BIGINT,BIGINT) TO %I', runtime_role);
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=current_schema() AND tablename='workspace_financial_transactions' AND policyname='financial_transactions_runtime'
    AND NOT (cmd='ALL' AND roles=ARRAY[runtime_role]::name[] AND regexp_replace(qual,'[() ]','','g')='true' AND regexp_replace(with_check,'[() ]','','g')='true')) THEN
    RAISE EXCEPTION 'policy financial_transactions_runtime preexistente diverge';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=current_schema() AND tablename='workspace_financial_transactions' AND policyname='financial_transactions_runtime') THEN
    EXECUTE format('CREATE POLICY financial_transactions_runtime ON workspace_financial_transactions FOR ALL TO %I USING (true) WITH CHECK (true)', runtime_role);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=current_schema() AND tablename='workspace_financial_payments' AND policyname='financial_payments_runtime'
    AND NOT (cmd='ALL' AND roles=ARRAY[runtime_role]::name[] AND regexp_replace(qual,'[() ]','','g')='true' AND regexp_replace(with_check,'[() ]','','g')='true')) THEN
    RAISE EXCEPTION 'policy financial_payments_runtime preexistente diverge';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=current_schema() AND tablename='workspace_financial_payments' AND policyname='financial_payments_runtime') THEN
    EXECUTE format('CREATE POLICY financial_payments_runtime ON workspace_financial_payments FOR ALL TO %I USING (true) WITH CHECK (true)', runtime_role);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=current_schema() AND tablename='workspace_financial_sync_checkpoints' AND policyname='financial_checkpoints_runtime'
    AND NOT (cmd='ALL' AND roles=ARRAY[runtime_role]::name[] AND regexp_replace(qual,'[() ]','','g')='true' AND regexp_replace(with_check,'[() ]','','g')='true')) THEN
    RAISE EXCEPTION 'policy financial_checkpoints_runtime preexistente diverge';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=current_schema() AND tablename='workspace_financial_sync_checkpoints' AND policyname='financial_checkpoints_runtime') THEN
    EXECUTE format('CREATE POLICY financial_checkpoints_runtime ON workspace_financial_sync_checkpoints FOR ALL TO %I USING (true) WITH CHECK (true)', runtime_role);
  END IF;
END $grants$;

-- Marker included in the exact canonical bytes hashed by the runner:
-- __CALCULATED_0005_CONTRACT_HASH__
