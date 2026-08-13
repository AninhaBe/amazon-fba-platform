import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertOAuthRefreshLeaseContract,
  OAUTH_REFRESH_LEASE_CONTRACT_VERSION,
} from "../scripts/migration-contracts.mjs";

const migration = await readFile(new URL("../migrations/0003_oauth_refresh_leases.sql", import.meta.url), "utf8");
const runner = await readFile(new URL("../scripts/migration-safety.mjs", import.meta.url), "utf8");
const contractValidator = await readFile(new URL("../scripts/migration-contracts.mjs", import.meta.url), "utf8");
const normalized = migration.replace(/\s+/g, " ").trim();

test("0003 e aditiva, idempotente e sem backfill", () => {
  assert.match(normalized, /CREATE TABLE IF NOT EXISTS migration_contract_versions/i);
  assert.match(normalized, /CREATE TABLE IF NOT EXISTS workspace_oauth_refresh_leases/i);
  assert.match(normalized, /CREATE INDEX IF NOT EXISTS oauth_refresh_leases_lease_until_idx/i);
  assert.match(normalized, /CREATE OR REPLACE FUNCTION oauth_refresh_try_claim/i);
  const ddlPrefix = normalized.slice(0, normalized.indexOf("CREATE OR REPLACE FUNCTION"));
  assert.doesNotMatch(ddlPrefix, /ALTER TABLE|UPDATE |INSERT INTO workspace_integrations/i);
});

test("0003 publica metadata idempotente somente apos instalar o contrato seguro", () => {
  assert.equal(OAUTH_REFRESH_LEASE_CONTRACT_VERSION, 2);
  assert.match(normalized, /VALUES \('0003_oauth_refresh_leases\.sql', 2, clock_timestamp\(\)\) ON CONFLICT \(migration_name\) DO UPDATE/i);
  assert.ok(normalized.lastIndexOf("INSERT INTO migration_contract_versions") > normalized.lastIndexOf("CREATE OR REPLACE FUNCTION"));
});

test("estado ambiguo bloqueia takeover do refresh possivelmente consumido", () => {
  assert.match(normalized, /CHECK \(state IN \('claimed', 'in_flight', 'indeterminate'\)\)/i);
  assert.match(normalized, /lease\.state = 'in_flight' AND lease\.lease_until <= v_now THEN 'indeterminate'/i);
  assert.match(normalized, /lease\.state = 'claimed' AND lease\.lease_until <= v_now THEN EXCLUDED\.owner_token/i);
  assert.match(normalized, /THEN 'indeterminate' ELSE lease\.state END/i);
  assert.match(normalized, /oauth_refresh_mark_indeterminate/i);
  assert.doesNotMatch(normalized, /state = 'indeterminate'.{0,200}EXCLUDED\.owner_token/i);
});

test("lease e espera derivam exclusivamente do relogio PostgreSQL", () => {
  assert.match(normalized, /v_now TIMESTAMPTZ := clock_timestamp\(\)/i);
  assert.match(normalized, /v_now \+ p_lease_ms \* interval '1 millisecond'/i);
  assert.match(normalized, /extract\(epoch FROM \(l\.lease_until - v_now\)\) \* 1000/i);
  assert.match(normalized, /db_now TIMESTAMPTZ/i);
});

test("transicoes e delete sao fenced pelo owner token", () => {
  for (const fn of ["oauth_refresh_mark_in_flight", "oauth_refresh_mark_indeterminate", "oauth_refresh_release_owned"]) {
    const start = normalized.indexOf(`CREATE OR REPLACE FUNCTION ${fn}`);
    assert.notEqual(start, -1);
    const body = normalized.slice(start, normalized.indexOf("$function$;", start));
    assert.match(body, /p_owner_token UUID/i);
    assert.match(body, /owner_token = p_owner_token/i);
  }
  assert.doesNotMatch(normalized, /DELETE FROM workspace_oauth_refresh_leases(?:(?!owner_token = p_owner_token).)*$function\$;/i);
});

test("callback e finalize podem serializar por grant apenas na transacao curta", () => {
  assert.match(normalized, /CREATE OR REPLACE FUNCTION oauth_refresh_grant_xact_lock/i);
  assert.match(normalized, /pg_advisory_xact_lock/i);
  assert.match(normalized, /p_workspace_id.*p_provider.*encode\(p_grant_fingerprint, 'hex'\)/i);
  assert.doesNotMatch(normalized, /pg_advisory_lock\(/i);
});

test("preflight exige ledger com hash e contrato continua validado", () => {
  assert.match(runner, /migration_hash/);
  assert.match(runner, /ledger legado sem hashes/);
  assert.match(contractValidator, /contrato seguro do lease OAuth esta incompleto/);
});

const completeContract = {
  contract_version: OAUTH_REFRESH_LEASE_CONTRACT_VERSION,
  has_identity_pk: true,
  has_fingerprint_check: true,
  has_state_check: true,
  has_claim: true,
  has_in_flight: true,
  has_indeterminate: true,
  has_release: true,
  has_grant_lock: true,
};

test("ledger 0003 sem versao ou com versao antiga falha; somente a versao segura passa", () => {
  assert.throws(() => assertOAuthRefreshLeaseContract({ ...completeContract, contract_version: null }), /requer contrato seguro OAuth lease v2/);
  assert.throws(() => assertOAuthRefreshLeaseContract({ ...completeContract, contract_version: 1 }), /requer contrato seguro OAuth lease v2/);
  assert.doesNotThrow(() => assertOAuthRefreshLeaseContract(completeContract));
  assert.throws(() => assertOAuthRefreshLeaseContract({ ...completeContract, has_state_check: false }), /contrato seguro do lease OAuth esta incompleto/);
});
