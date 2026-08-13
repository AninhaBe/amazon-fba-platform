-- Coordena refresh OAuth rotativo entre processos sem persistir o token.
-- O fingerprint e HMAC-SHA-256 domain-separated com chave secreta.
-- Esta migration e aditiva, repetivel e deliberadamente nao faz backfill.
CREATE TABLE IF NOT EXISTS migration_contract_versions (
  migration_name  TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL CHECK (contract_version > 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_oauth_refresh_leases (
  workspace_id      TEXT NOT NULL,
  provider          TEXT NOT NULL,
  grant_fingerprint BYTEA NOT NULL CHECK (octet_length(grant_fingerprint) = 32),
  owner_token       UUID NOT NULL,
  state             TEXT NOT NULL DEFAULT 'claimed'
                    CHECK (state IN ('claimed', 'in_flight', 'indeterminate')),
  lease_until       TIMESTAMPTZ NOT NULL,
  claimed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider, grant_fingerprint)
);

CREATE INDEX IF NOT EXISTS oauth_refresh_leases_lease_until_idx
  ON workspace_oauth_refresh_leases (lease_until);

-- Serializacao curta compartilhada por callback/reautorizacao e finalize.
-- Por ser xact lock, e obrigatoriamente solta no COMMIT/ROLLBACK; nunca chamar
-- esta funcao antes/durante HTTP remoto.
CREATE OR REPLACE FUNCTION oauth_refresh_grant_xact_lock(
  p_workspace_id TEXT,
  p_provider TEXT,
  p_grant_fingerprint BYTEA
) RETURNS VOID
LANGUAGE sql
AS $function$
  SELECT pg_advisory_xact_lock(
    hashtextextended(
      p_workspace_id || E'\x1f' || p_provider || E'\x1f' || encode(p_grant_fingerprint, 'hex'),
      0
    )
  )
$function$;

-- Claim atomico. Toda duracao nasce de clock_timestamp() no PostgreSQL.
-- Lease claimed expirado e recuperavel porque nenhum HTTP comecou. Lease
-- in_flight expirado vira indeterminate e permanece bloqueado ate resolucao
-- segura ou reautorizacao explicita.
CREATE OR REPLACE FUNCTION oauth_refresh_try_claim(
  p_workspace_id TEXT,
  p_provider TEXT,
  p_grant_fingerprint BYTEA,
  p_owner_token UUID,
  p_lease_ms INTEGER
) RETURNS TABLE (
  acquired BOOLEAN,
  lease_state TEXT,
  lease_remaining_ms BIGINT,
  db_now TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_lease_ms < 1000 THEN
    RAISE EXCEPTION 'OAuth refresh lease deve durar ao menos 1 segundo';
  END IF;

  INSERT INTO workspace_oauth_refresh_leases AS lease
    (workspace_id, provider, grant_fingerprint, owner_token, state, lease_until)
  VALUES
    (p_workspace_id, p_provider, p_grant_fingerprint, p_owner_token, 'claimed',
     v_now + p_lease_ms * interval '1 millisecond')
  ON CONFLICT (workspace_id, provider, grant_fingerprint) DO UPDATE
    SET state = CASE
          WHEN lease.state = 'in_flight' AND lease.lease_until <= v_now
            THEN 'indeterminate'
          ELSE lease.state
        END,
        owner_token = CASE
          WHEN lease.state = 'claimed' AND lease.lease_until <= v_now
            THEN EXCLUDED.owner_token
          ELSE lease.owner_token
        END,
        lease_until = CASE
          WHEN lease.state = 'claimed' AND lease.lease_until <= v_now
            THEN EXCLUDED.lease_until
          ELSE lease.lease_until
        END,
        claimed_at = CASE
          WHEN lease.state = 'claimed' AND lease.lease_until <= v_now
            THEN v_now
          ELSE lease.claimed_at
        END,
        updated_at = v_now;

  RETURN QUERY
  SELECT l.owner_token = p_owner_token AND l.state = 'claimed',
         l.state,
         GREATEST(0, floor(extract(epoch FROM (l.lease_until - v_now)) * 1000))::BIGINT,
         v_now
    FROM workspace_oauth_refresh_leases l
   WHERE l.workspace_id = p_workspace_id
     AND l.provider = p_provider
     AND l.grant_fingerprint = p_grant_fingerprint;
END
$function$;

-- Fence obrigatorio antes de iniciar HTTP. So o owner corrente pode avancar.
CREATE OR REPLACE FUNCTION oauth_refresh_mark_in_flight(
  p_workspace_id TEXT,
  p_provider TEXT,
  p_grant_fingerprint BYTEA,
  p_owner_token UUID
) RETURNS BOOLEAN
LANGUAGE sql
AS $function$
  UPDATE workspace_oauth_refresh_leases
     SET state = 'in_flight', updated_at = clock_timestamp()
   WHERE workspace_id = p_workspace_id
     AND provider = p_provider
     AND grant_fingerprint = p_grant_fingerprint
     AND owner_token = p_owner_token
     AND state = 'claimed'
     AND lease_until > clock_timestamp()
  RETURNING TRUE
$function$;

-- Timeout, rede e resposta possivelmente consumida usam esta transicao. O
-- refresh token antigo fica interditado ate reautorizacao/resolucao explicita.
CREATE OR REPLACE FUNCTION oauth_refresh_mark_indeterminate(
  p_workspace_id TEXT,
  p_provider TEXT,
  p_grant_fingerprint BYTEA,
  p_owner_token UUID
) RETURNS BOOLEAN
LANGUAGE sql
AS $function$
  UPDATE workspace_oauth_refresh_leases
     SET state = 'indeterminate', updated_at = clock_timestamp()
   WHERE workspace_id = p_workspace_id
     AND provider = p_provider
     AND grant_fingerprint = p_grant_fingerprint
     AND owner_token = p_owner_token
     AND state IN ('claimed', 'in_flight')
  RETURNING TRUE
$function$;

-- Toda remocao operacional e owner-token fenced. Callback/reautorizacao nao
-- apaga esta linha: grava o grant novo sob o grant xact lock; o grant antigo
-- indeterminate permanece como registro de seguranca/diagnostico.
CREATE OR REPLACE FUNCTION oauth_refresh_release_owned(
  p_workspace_id TEXT,
  p_provider TEXT,
  p_grant_fingerprint BYTEA,
  p_owner_token UUID
) RETURNS BOOLEAN
LANGUAGE sql
AS $function$
  WITH deleted AS (
    DELETE FROM workspace_oauth_refresh_leases
     WHERE workspace_id = p_workspace_id
       AND provider = p_provider
       AND grant_fingerprint = p_grant_fingerprint
       AND owner_token = p_owner_token
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM deleted)
$function$;

-- Gravado por ultimo: dentro da transacao do runner, v2 atesta que tabela,
-- constraints e todas as funcoes owner-fenced acima foram instaladas juntas.
INSERT INTO migration_contract_versions (migration_name, contract_version, updated_at)
VALUES ('0003_oauth_refresh_leases.sql', 2, clock_timestamp())
ON CONFLICT (migration_name) DO UPDATE
  SET contract_version = EXCLUDED.contract_version,
      updated_at = EXCLUDED.updated_at;
