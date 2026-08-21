import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { assertLocalTarget, buildPlan, classify, inspectTarget, safeTarget, validateApply, verifyPlan } from "../scripts/migration-safety.mjs";

const target = safeTarget("postgres://secret:secret@db.example.com:5432/seller");
const identity = { database: "seller", schema: "public", role: "migrator" };
const git = { commit: "abc123", dirty: false };
const migration = { name: "0001.sql", hash: "sha256:abc", operations: ["DDL"] };
const runtimeRole = "sellercore_runtime";
const plan = buildPlan({ environment: "production", target, identity, migrations: [migration], applied: [], git, runtimeRole });
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const key = publicKey.export({ type: "spki", format: "pem" });

function auth(overrides = {}) {
  const value = { nonce: "random-one-time-nonce", reference: "INC-123", actor: "release-owner", environment: "production", targetFingerprint: target.fingerprint, planHash: plan.planHash, expiresAt: new Date(Date.now() + 60_000).toISOString(), ...overrides };
  const payload = [value.nonce, value.reference, value.actor, value.environment, value.targetFingerprint, value.planHash, value.expiresAt].join("\n");
  return { ...value, signature: sign(null, Buffer.from(payload), privateKey).toString("base64") };
}
const base = () => ({ args: { apply: true, "expected-target": target.fingerprint, "runtime-role": runtimeRole }, environment: "production", target, identity, plan, authorization: auth(), git, publicKey: key });

test("target sanitizado não contém usuário ou senha", () => assert.deepEqual(Object.keys(target).sort(), ["database", "fingerprint", "host", "port"]));
test("local recusa .env apontando remoto", () => assert.throws(() => assertLocalTarget("local", target), /somente localhost/));
test("classifica DDL, dados e destrutivo", () => assert.deepEqual(classify("ALTER TABLE x DROP COLUMN y; UPDATE x SET y=1"), ["DESTRUCTIVE", "DATA_CHANGE", "DDL"]));
test("apply exige flag", () => assert.throws(() => validateApply({ ...base(), args: {} }), /--apply/));
test("apply exige ambiente explícito", () => assert.throws(() => validateApply({ ...base(), environment: "" }), /environment/));
test("apply exige identidade esperada", () => assert.throws(() => validateApply({ ...base(), args: { apply: true } }), /identidade esperada/));
test("manifesto adulterado falha", () => assert.throws(() => verifyPlan({ ...plan, environment: "staging" }), /alterado/));
test("apply recusa runtime role diferente do manifesto assinado", () => assert.throws(() => validateApply({ ...base(), args: { ...base().args, "runtime-role": "outra_role" } }), /runtime role/));
test("hash drift falha", () => assert.throws(() => validateApply({ ...base(), plan: { ...plan, migrations: [{ ...plan.migrations[0], drift: true }] } }), /manifesto|hashes/));
test("produção dirty falha", () => assert.throws(() => validateApply({ ...base(), git: { ...git, dirty: true } }), /worktree limpo/));
test("autorização ausente falha", () => assert.throws(() => validateApply({ ...base(), authorization: {} }), /autorização/));
test("CONFIRM=SIM não tem efeito e assinatura inválida falha", () => assert.throws(() => validateApply({ ...base(), authorization: { ...auth(), signature: Buffer.from("SIM").toString("base64") } }), /assinatura/));
test("autorização expirada falha", () => assert.throws(() => validateApply({ ...base(), authorization: auth({ expiresAt: new Date(Date.now() - 1).toISOString() }) }), /expirada/));
test("apply válido passa validação", () => assert.doesNotThrow(() => validateApply(base())));
test("plan com fake usa somente SELECT e nunca executa DDL", async () => {
  const queries = [];
  const responses = [
    { rows: [identity], rowCount: 1 }, { rows: [{ exists: true }], rowCount: 1 },
    { rows: [{}], rowCount: 1 }, { rows: [{ exists: true, has_hash: true }], rowCount: 1 }, { rows: [], rowCount: 0 },
  ];
  await inspectTarget(async (sql) => { queries.push(sql); return responses.shift(); });
  assert.ok(queries.every((sql) => /^SELECT\b/i.test(sql.trim())));
  assert.ok(queries.every((sql) => !/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(sql)));
});
test("metadata legado bloqueia e nao tenta autorreparo", async () => {
  const queries = [];
  const responses = [{ rows: [identity], rowCount: 1 }, { rows: [{ exists: true }], rowCount: 1 }, { rows: [{}], rowCount: 1 }, { rows: [{ exists: true, has_hash: false }], rowCount: 1 }];
  await assert.rejects(() => inspectTarget(async (sql) => { queries.push(sql); return responses.shift(); }), /metadata de contratos/);
  assert.ok(queries.every((sql) => /^SELECT\b/i.test(sql.trim())));
});
// ── ADR-021: runner destravado. A role virou opcional; o que ela protegia, não.
const semRole = buildPlan({ environment: "production", target, identity, migrations: [migration], applied: [], git });
function authDe(plano, overrides = {}) {
  const value = { nonce: "n2", reference: "ADR-021", actor: "release-owner", environment: "production", targetFingerprint: target.fingerprint, planHash: plano.planHash, expiresAt: new Date(Date.now() + 60_000).toISOString(), ...overrides };
  const payload = [value.nonce, value.reference, value.actor, value.environment, value.targetFingerprint, value.planHash, value.expiresAt].join("\n");
  return { ...value, signature: sign(null, Buffer.from(payload), privateKey).toString("base64") };
}
const semRoleBase = () => ({ args: { apply: true, "expected-target": target.fingerprint }, environment: "production", target, identity, plan: semRole, authorization: authDe(semRole), git, publicKey: key });

test("plano sem runtime role grava null, nao undefined (senao JSON.stringify some com a chave e o verifyPlan acusa manifesto intacto)", () => {
  assert.equal(semRole.runtimeRole, null);
  assert.doesNotThrow(() => verifyPlan(JSON.parse(JSON.stringify(semRole))));
});
test("apply sem runtime role passa quando o manifesto tambem nao tem", () => assert.doesNotThrow(() => validateApply(semRoleBase())));
test("apply recusa role que a assinatura nao cobre", () => assert.throws(() => validateApply({ ...semRoleBase(), args: { ...semRoleBase().args, "runtime-role": "sellercore_runtime" } }), /runtime role/));
test("apply recusa omitir a role que a assinatura cobre", () => assert.throws(() => validateApply({ ...base(), args: { apply: true, "expected-target": target.fingerprint } }), /runtime role/));
test("classify marca DROP de tabela como destrutivo antes de rodar", () => assert.ok(classify("DROP TABLE IF EXISTS accounts;").includes("DESTRUCTIVE")));

test("comando migrate legado aborta sem importar executor de banco", () => {
  const result = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    cwd: new URL("..", import.meta.url), encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "postgres://would-connect.invalid/prod" },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /BLOCKED/);
});
