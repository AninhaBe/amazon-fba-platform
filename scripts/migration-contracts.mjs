import { createHash } from "node:crypto";

export const OAUTH_REFRESH_LEASE_CONTRACT_VERSION = 2;
export const FINANCIAL_LEDGER_CONTRACT_VERSION = 2;
export const FINANCIAL_LEDGER_MIGRATION = "0005_workspace_financial_ledger.sql";
export const FINANCIAL_LEDGER_HASH_TOKEN = "__CALCULATED_0005_CONTRACT_HASH__";

// Canonical representation: the exact UTF-8 migration file, including the token
// above. This avoids the impossible self-hash problem while making every edit drift.
export function financialLedgerContractHash(sql) {
  if (!sql.includes(FINANCIAL_LEDGER_HASH_TOKEN)) throw new Error("0005 contract hash token ausente.");
  return `sha256:${createHash("sha256").update(sql, "utf8").digest("hex")}`;
}

export function materializeFinancialLedgerMigration(sql, contractHash) {
  if (contractHash !== financialLedgerContractHash(sql)) throw new Error("0005 contract hash nao corresponde ao arquivo canonico.");
  return sql.replaceAll(FINANCIAL_LEDGER_HASH_TOKEN, contractHash);
}

export function assertOAuthRefreshLeaseContract(contract) {
  if (!contract || Number(contract.contract_version) !== OAUTH_REFRESH_LEASE_CONTRACT_VERSION) {
    throw new Error(`Preflight: 0003 consta como aplicada, mas requer contrato seguro OAuth lease v${OAUTH_REFRESH_LEASE_CONTRACT_VERSION}.`);
  }
  const checks = Object.entries(contract).filter(([key]) => key !== "contract_version");
  if (!checks.length || checks.some(([, value]) => value !== true)) throw new Error("Preflight: 0003 consta como aplicada, mas o contrato seguro do lease OAuth esta incompleto.");
}

export function assertFinancialLedgerContract(contract, expectedHash) {
  if (!contract || Number(contract.contract_version) !== FINANCIAL_LEDGER_CONTRACT_VERSION || contract.contract_hash !== expectedHash) {
    throw new Error("SCHEMA_BLOCKED: metadata version/hash do contrato 0005 diverge.");
  }
  const checks = Object.entries(contract).filter(([key]) => !["contract_version", "contract_hash", "object_count"].includes(key));
  if (!checks.length || checks.some(([, value]) => value !== true)) throw new Error("SCHEMA_BLOCKED: contrato semantico 0005 incompleto ou inseguro.");
}

export function assertFinancialLedgerPrecheck(contract) {
  if (!contract || Number(contract.object_count) === 0) return;
  const checks = Object.entries(contract).filter(([key]) => !["contract_version", "contract_hash", "object_count"].includes(key));
  if (checks.some(([, value]) => value !== true)) throw new Error("BLOCKED: objeto IF NOT EXISTS da 0005 ja existe com contrato incompatível.");
}

// One read-only catalog query covers shape, constraints, indexes, routines,
// privileges and RLS. bool_and over expected rows makes missing/excess shape fail.
export const FINANCIAL_LEDGER_CONTRACT_SQL = String.raw`
WITH expected_columns(tbl,col,typ,nullable) AS (VALUES
 ('workspace_financial_transactions','workspace_id','text',false),('workspace_financial_transactions','provider','text',false),('workspace_financial_transactions','connection_id','text',false),('workspace_financial_transactions','transaction_id','text',false),('workspace_financial_transactions','statement_id','text',true),('workspace_financial_transactions','order_id','text',true),('workspace_financial_transactions','adjustment_order_id','text',true),('workspace_financial_transactions','transaction_type','text',false),('workspace_financial_transactions','occurred_at','timestamp with time zone',false),('workspace_financial_transactions','currency','text',false),
 ('workspace_financial_transactions','revenue','numeric',true),('workspace_financial_transactions','buyer_shipping','numeric',true),('workspace_financial_transactions','seller_shipping','numeric',true),('workspace_financial_transactions','commission','numeric',true),('workspace_financial_transactions','payment_fee','numeric',true),('workspace_financial_transactions','fulfillment_fee','numeric',true),('workspace_financial_transactions','ads','numeric',true),('workspace_financial_transactions','taxes_withheld','numeric',true),('workspace_financial_transactions','refunds','numeric',true),('workspace_financial_transactions','adjustment','numeric',true),('workspace_financial_transactions','settlement_amount','numeric',true),('workspace_financial_transactions','settlement_state','text',false),('workspace_financial_transactions','is_estimated','boolean',false),('workspace_financial_transactions','source_resource','text',false),('workspace_financial_transactions','source_record_id','text',true),('workspace_financial_transactions','source_observed_at','timestamp with time zone',false),('workspace_financial_transactions','source_rank','smallint',false),('workspace_financial_transactions','raw_allowlisted','jsonb',true),('workspace_financial_transactions','raw_sha256','bytea',false),('workspace_financial_transactions','created_at','timestamp with time zone',false),('workspace_financial_transactions','updated_at','timestamp with time zone',false),
 ('workspace_financial_payments','workspace_id','text',false),('workspace_financial_payments','provider','text',false),('workspace_financial_payments','connection_id','text',false),('workspace_financial_payments','payment_id','text',false),('workspace_financial_payments','statement_id','text',true),('workspace_financial_payments','status','text',false),('workspace_financial_payments','amount','numeric',true),('workspace_financial_payments','currency','text',false),('workspace_financial_payments','paid_at','timestamp with time zone',true),('workspace_financial_payments','expected_at','timestamp with time zone',true),('workspace_financial_payments','is_estimated','boolean',false),('workspace_financial_payments','source_observed_at','timestamp with time zone',false),('workspace_financial_payments','raw_sha256','bytea',false),('workspace_financial_payments','created_at','timestamp with time zone',false),('workspace_financial_payments','updated_at','timestamp with time zone',false),
 ('workspace_financial_sync_checkpoints','workspace_id','text',false),('workspace_financial_sync_checkpoints','provider','text',false),('workspace_financial_sync_checkpoints','connection_id','text',false),('workspace_financial_sync_checkpoints','resource','text',false),('workspace_financial_sync_checkpoints','window_from','timestamp with time zone',false),('workspace_financial_sync_checkpoints','window_to','timestamp with time zone',false),('workspace_financial_sync_checkpoints','cursor_token','text',true),('workspace_financial_sync_checkpoints','cursor_hash_history','jsonb',false),('workspace_financial_sync_checkpoints','page_number','integer',false),('workspace_financial_sync_checkpoints','terminal_cursor','boolean',false),('workspace_financial_sync_checkpoints','completed_at','timestamp with time zone',true),('workspace_financial_sync_checkpoints','owner_token','uuid',true),('workspace_financial_sync_checkpoints','fencing_token','bigint',false),('workspace_financial_sync_checkpoints','lease_until','timestamp with time zone',true),('workspace_financial_sync_checkpoints','rows_seen','bigint',false),('workspace_financial_sync_checkpoints','rows_written','bigint',false),('workspace_financial_sync_checkpoints','error_count','integer',false),('workspace_financial_sync_checkpoints','last_error_code','text',true),('workspace_financial_sync_checkpoints','last_error_at','timestamp with time zone',true),('workspace_financial_sync_checkpoints','created_at','timestamp with time zone',false),('workspace_financial_sync_checkpoints','updated_at','timestamp with time zone',false)
), actual_columns AS (SELECT table_name,col.column_name,col.data_type,(col.is_nullable='YES') nullable FROM information_schema.columns col WHERE table_schema=current_schema() AND table_name LIKE 'workspace_financial_%'),
expected_pks(tbl,cols) AS (VALUES
 ('workspace_financial_transactions',ARRAY['workspace_id','provider','connection_id','transaction_id']),
 ('workspace_financial_payments',ARRAY['workspace_id','provider','connection_id','payment_id']),
 ('workspace_financial_sync_checkpoints',ARRAY['workspace_id','provider','connection_id','resource','window_from','window_to'])),
actual_pks AS (SELECT con.conrelid::regclass::text tbl,array_agg(att.attname ORDER BY key.ord) cols FROM pg_constraint con CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY key(attnum,ord) JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=key.attnum WHERE con.contype='p' AND con.connamespace=(SELECT oid FROM pg_namespace WHERE nspname=current_schema()) GROUP BY con.oid),
expected_indexes(tbl,name,cols,predicate) AS (VALUES
 ('workspace_financial_transactions','financial_transactions_period_idx',ARRAY['workspace_id','provider','connection_id','occurred_at'],NULL),
 ('workspace_financial_transactions','financial_transactions_order_idx',ARRAY['workspace_id','provider','connection_id','order_id'],'(order_id IS NOT NULL)'),
 ('workspace_financial_transactions','financial_transactions_statement_idx',ARRAY['workspace_id','provider','connection_id','statement_id'],'(statement_id IS NOT NULL)'),
 ('workspace_financial_transactions','financial_transactions_unsettled_idx',ARRAY['workspace_id','provider','connection_id','occurred_at'],'(settlement_state = ''unsettled''::text)'),
 ('workspace_financial_payments','financial_payments_statement_idx',ARRAY['workspace_id','provider','connection_id','statement_id'],'(statement_id IS NOT NULL)'),
 ('workspace_financial_sync_checkpoints','financial_checkpoints_due_idx',ARRAY['provider','resource','lease_until','updated_at'],'(completed_at IS NULL)')),
actual_indexes AS (SELECT t.relname tbl,c.relname name,array_agg(a.attname ORDER BY key.ord) cols,pg_get_expr(i.indpred,i.indrelid) predicate FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY key(attnum,ord) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=key.attnum WHERE n.nspname=current_schema() AND NOT i.indisprimary GROUP BY t.relname,c.relname,i.indpred,i.indrelid),
runtime AS (SELECT coalesce(nullif(current_setting('sellercore.runtime_role',true),''),current_user) role, nullif(current_setting('sellercore.runtime_role',true),'') IS NOT NULL configured),
expected_policies(tbl,name) AS (VALUES ('workspace_financial_transactions','financial_transactions_runtime'),('workspace_financial_payments','financial_payments_runtime'),('workspace_financial_sync_checkpoints','financial_checkpoints_runtime'))
SELECT ((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname LIKE 'workspace_financial_%') + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname IN ('financial_checkpoint_claim','financial_checkpoint_advance'))) object_count,
 (SELECT count(*)=3 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name IN ('workspace_financial_transactions','workspace_financial_payments','workspace_financial_sync_checkpoints')) has_tables,
 (SELECT count(*)=(SELECT count(*) FROM expected_columns) AND bool_and(a.typ=e.typ AND a.nullable=e.nullable) FROM expected_columns e LEFT JOIN actual_columns a ON (a.table_name,a.column_name)=(e.tbl,e.col)) columns_match,
 (SELECT count(*)=3 AND bool_and((table_name='workspace_financial_transactions' AND n=31) OR (table_name='workspace_financial_payments' AND n=15) OR (table_name='workspace_financial_sync_checkpoints' AND n=21)) FROM (SELECT table_name,count(*) n FROM actual_columns GROUP BY table_name) s) column_counts_match,
 (SELECT count(*)=12 AND bool_and(numeric_precision=18 AND numeric_scale=2) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name IN ('workspace_financial_transactions','workspace_financial_payments') AND data_type='numeric') numeric_shapes_match,
 (SELECT count(*)=3 AND bool_and(a.cols=e.cols AND a.tbl=e.tbl) FROM expected_pks e LEFT JOIN actual_pks a USING(tbl)) pks_match,
 EXISTS(SELECT 1 FROM pg_constraint c WHERE conname='financial_transactions_order_fk' AND contype='f' AND conrelid=to_regclass('workspace_financial_transactions') AND confrelid=to_regclass('workspace_channel_orders') AND conkey=ARRAY[1,2,3,6]::smallint[] AND confkey=ARRAY[1,2,3,4]::smallint[] AND confupdtype='a' AND confdeltype='a' AND confmatchtype='s' AND NOT convalidated AND condeferrable AND condeferred) fk_match,
 (SELECT count(*)=20 AND bool_and(convalidated)
    AND bool_or(conname='financial_transactions_provenance_check' AND pg_get_constraintdef(oid) LIKE '%source_rank < 100%' AND pg_get_constraintdef(oid) LIKE '%source_rank = 100%')
    AND bool_or(conname='financial_transactions_statement_source_check' AND pg_get_constraintdef(oid) LIKE '%statement_transactions%' AND pg_get_constraintdef(oid) LIKE '%statement_id IS NOT NULL%')
    AND bool_or(conname='financial_transactions_pending_source_check' AND pg_get_constraintdef(oid) LIKE '%unsettled%' AND pg_get_constraintdef(oid) LIKE '%statement_id IS NULL%')
   FROM pg_constraint WHERE contype='c' AND conrelid IN (to_regclass('workspace_financial_transactions'),to_regclass('workspace_financial_payments'),to_regclass('workspace_financial_sync_checkpoints'))) checks_match,
 (SELECT count(*)=6 AND bool_and(a.tbl=e.tbl AND a.cols=e.cols AND a.predicate IS NOT DISTINCT FROM e.predicate) FROM expected_indexes e LEFT JOIN actual_indexes a USING(name)) indexes_match,
 EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=current_schema() AND p.proname='financial_checkpoint_claim' AND pg_get_function_identity_arguments(p.oid)='p_workspace_id text, p_provider text, p_connection_id text, p_resource text, p_window_from timestamp with time zone, p_window_to timestamp with time zone, p_owner_token uuid, p_lease_ms integer' AND pg_get_function_result(p.oid)='TABLE(acquired boolean, fencing_token bigint, db_now timestamp with time zone)' AND l.lanname='plpgsql' AND NOT p.prosecdef) claim_match,
 EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=current_schema() AND p.proname='financial_checkpoint_advance' AND pg_get_function_identity_arguments(p.oid)='p_workspace_id text, p_provider text, p_connection_id text, p_resource text, p_window_from timestamp with time zone, p_window_to timestamp with time zone, p_owner_token uuid, p_fencing_token bigint, p_cursor_token text, p_cursor_sha256 bytea, p_page_number integer, p_terminal_cursor boolean, p_rows_seen bigint, p_rows_written bigint' AND pg_get_function_result(p.oid)='boolean' AND l.lanname='sql' AND NOT p.prosecdef) advance_match,
 NOT EXISTS(SELECT 1 FROM information_schema.table_privileges p,runtime r WHERE p.table_schema=current_schema() AND p.table_name LIKE 'workspace_financial_%' AND (p.grantee NOT IN (r.role,current_user) OR (p.grantee=r.role AND p.privilege_type NOT IN ('SELECT','INSERT','UPDATE','DELETE')))) acl_tables_closed,
 NOT EXISTS(SELECT 1 FROM information_schema.routine_privileges p,runtime r WHERE p.specific_schema=current_schema() AND p.routine_name IN ('financial_checkpoint_claim','financial_checkpoint_advance') AND (p.grantee NOT IN (r.role,current_user) OR (p.grantee=r.role AND p.privilege_type<>'EXECUTE'))) acl_functions_closed,
 (SELECT role IS NOT NULL AND (SELECT count(*)=12 FROM information_schema.table_privileges WHERE table_schema=current_schema() AND table_name LIKE 'workspace_financial_%' AND grantee=role AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')) AND (SELECT count(*)=2 FROM information_schema.routine_privileges WHERE specific_schema=current_schema() AND routine_name IN ('financial_checkpoint_claim','financial_checkpoint_advance') AND grantee=role AND privilege_type='EXECUTE') FROM runtime) runtime_acl_match,
 (SELECT count(*)=3 AND bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname IN ('workspace_financial_transactions','workspace_financial_payments','workspace_financial_sync_checkpoints')) rls_enabled,
 (SELECT count(*)=3 AND bool_and(p.policyname=e.name AND p.cmd='ALL' AND p.roles=ARRAY[r.role]::name[] AND regexp_replace(p.qual,'[() ]','','g')='true' AND regexp_replace(p.with_check,'[() ]','','g')='true') FROM expected_policies e CROSS JOIN runtime r LEFT JOIN pg_policies p ON p.schemaname=current_schema() AND p.tablename=e.tbl AND p.policyname=e.name) policies_match,
 (SELECT NOT rolsuper AND NOT rolbypassrls AND (NOT configured OR rolname<>current_user) AND oid<>(SELECT nspowner FROM pg_namespace WHERE nspname=current_schema()) AND oid<>(SELECT datdba FROM pg_database WHERE datname=current_database()) FROM pg_roles,runtime WHERE rolname=role) runtime_role_safe,
 NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname=current_schema() AND tablename LIKE 'workspace_financial_%' AND (policyname NOT IN (SELECT name FROM expected_policies) OR 'public'=ANY(roles) OR 'anon'=ANY(roles) OR 'authenticated'=ANY(roles))) no_public_policies;
`;
