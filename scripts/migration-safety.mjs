import { createHash, randomUUID, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
export const AUTH_MAX_AGE_MS = 15 * 60 * 1000;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const authorizationPayload = (authorization) => [authorization.nonce, authorization.reference, authorization.actor, authorization.environment, authorization.targetFingerprint, authorization.planHash, authorization.expiresAt].join("\n");

export function parseArgs(argv) {
  const result = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") result.apply = true;
    else if (arg.startsWith("--") && arg.includes("=")) result[arg.slice(2, arg.indexOf("="))] = arg.slice(arg.indexOf("=") + 1);
    else if (arg.startsWith("--")) result[arg.slice(2)] = argv[++i];
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }
  return result;
}

export function safeTarget(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: url.port || "5432",
    database: url.pathname.replace(/^\//, ""),
    fingerprint: sha256(`${url.hostname.toLowerCase()}:${url.port || "5432"}/${url.pathname.replace(/^\//, "")}`).slice(0, 20),
  };
}

export function classify(sql) {
  const kinds = [];
  for (const [kind, pattern] of [
    ["DESTRUCTIVE", /\b(DROP|TRUNCATE)\b|\bALTER\s+TABLE\b[^;]*\bDROP\b/i],
    ["DATA_CHANGE", /\b(INSERT|UPDATE|DELETE)\b/i],
    ["DDL", /\b(CREATE|ALTER|RENAME|GRANT|REVOKE)\b/i],
  ]) if (pattern.test(sql)) kinds.push(kind);
  return kinds.length ? kinds : ["OTHER"];
}

export async function loadMigrations(dir) {
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  return Promise.all(files.map(async (name) => {
    const sql = await readFile(path.join(dir, name), "utf8");
    return { name, sql, hash: `sha256:${sha256(sql)}`, operations: classify(sql) };
  }));
}

export async function inspectTarget(query) {
  const identityResult = await query("SELECT current_database() AS database, current_schema() AS schema, current_user AS role");
  const ledgerResult = await query("SELECT to_regclass(current_schema() || '.schema_migrations') IS NOT NULL AS exists");
  if (!ledgerResult.rows[0]?.exists) throw new Error("BLOCKED: schema_migrations ausente; bootstrap exige procedimento separado e aprovado.");
  const hashColumn = await query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='schema_migrations' AND column_name='migration_hash'");
  if (!hashColumn.rowCount) throw new Error("BLOCKED: ledger legado sem hashes; não será corrigido automaticamente.");
  const contractLedger = await query("SELECT to_regclass(current_schema() || '.migration_contract_versions') IS NOT NULL AS exists, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='migration_contract_versions' AND column_name='contract_hash') AS has_hash");
  if (!contractLedger.rows[0]?.exists || !contractLedger.rows[0]?.has_hash) throw new Error("BLOCKED: metadata de contratos ausente ou legada; remediacao exige migration versionada e plano autorizado.");
  const applied = await query("SELECT name, migration_hash AS hash FROM schema_migrations ORDER BY name");
  return { identity: identityResult.rows[0], applied: applied.rows };
}

export async function inspectFinancialLedgerContract(query, contractSql) {
  const result = await query(contractSql);
  if (result.rowCount !== 1) throw new Error("BLOCKED: introspeccao do contrato 0005 nao retornou uma linha.");
  const metadataShape = await query("SELECT to_regclass(current_schema() || '.migration_contract_versions') IS NOT NULL AS has_table, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='migration_contract_versions' AND column_name='contract_hash') AS has_hash");
  let metadata = { contract_version: 0, contract_hash: null };
  if (metadataShape.rows[0]?.has_table && metadataShape.rows[0]?.has_hash) {
    const found = await query("SELECT contract_version, contract_hash FROM migration_contract_versions WHERE migration_name='0005_workspace_financial_ledger.sql'");
    if (found.rowCount) metadata = found.rows[0];
  }
  return { ...result.rows[0], ...metadata };
}

/**
 * O ARQUIVO EM DISCO TEM DE SER O ARQUIVO COMMITADO — em staging e produção.
 *
 * ⚠️ POR QUE ISTO EXISTE (incidente de 01/09/2026, ver `docs/migrations.md` →
 * "Fim de linha e hash"). `loadMigrations` faz o SHA-256 do arquivo em DISCO, e
 * é esse hash que vira registro de auditoria em `schema_migrations`. Três
 * migrations tinham sido aplicadas a partir de bytes que **não existiam no
 * repositório** — CRLF no disco, LF no commit — e `git status` não avisa, porque
 * trata diferença de fim de linha como igual. O efeito: de qualquer checkout
 * limpo o runner recusava aplicar qualquer coisa, e o fluxo ficou preso a uma
 * cópia de trabalho, numa máquina.
 *
 * O `.gitattributes` removeu a causa mais provável. Isto fecha a que sobra, e é
 * a perigosa: divergência de **conteúdo**. Se um `.sql` no disco não for o que
 * está commitado, o apply para — porque a alternativa é gravar na auditoria o
 * hash de um SQL que ninguém revisou.
 *
 * ⚠️ SEM GIT, FALHA — NÃO RELEVA. Portão que se desliga sozinho quando não
 * consegue medir é pior que não ter portão: dá sensação de cobertura sem
 * cobertura. Se `git` não existir no ambiente, ou o objeto não puder ser lido, a
 * mensagem diz que a VERIFICAÇÃO não pôde ser feita — e barra.
 *
 * ⚠️ NÃO VALE PARA `local`, DE PROPÓSITO. `migrate:local` é onde se testa
 * migration ainda não commitada, e esse fluxo é legítimo. Exigir commit antes de
 * testar empurraria as pessoas a commitar SQL não testado — portão que torna o
 * caminho certo mais caro que o errado vira desvio. Mesma regra do "worktree
 * limpo", que já é assim.
 */
export function assertMigrationsMatchCommit({ environment, migrations, dir = "migrations" }) {
  if (environment === "local") return;
  for (const { name, sql } of migrations) {
    let commitado;
    try {
      commitado = execFileSync("git", ["show", `HEAD:${dir}/${name}`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    } catch (erro) {
      throw new Error(
        `BLOCKED: nao foi possivel LER a versao commitada de ${name} para comparar com o disco ` +
        `(${erro instanceof Error ? erro.message.slice(0, 120) : "erro desconhecido"}). ` +
        "Sem git nao da para verificar, e verificacao que nao acontece nao pode virar aprovacao.",
      );
    }
    if (commitado !== sql) {
      throw new Error(
        `BLOCKED: ${name} em disco difere da versao commitada ` +
        `(disco sha256:${sha256(sql).slice(0, 16)}… / commit sha256:${sha256(commitado).slice(0, 16)}…). ` +
        "O hash gravado na auditoria seria de um SQL que nao esta no repositorio. " +
        "Commite a mudanca, ou desfaca a edicao, e rode de novo.",
      );
    }
  }
}

export function buildPlan({ environment, target, identity, migrations, applied, git, runtimeRole }) {
  // Aqui, e não só em `validateApply`, porque o PLAN também precisa barrar: um
  // plano gerado sobre bytes não commitados assinaria conteúdo que o repositório
  // não tem, e a assinatura passaria a cobrir o que ninguém revisou.
  assertMigrationsMatchCommit({ environment, migrations });
  const appliedMap = new Map(applied.map((item) => [item.name, item.hash]));
  const entries = migrations.map(({ name, hash, operations }) => ({
    name, hash, operations, status: appliedMap.has(name) ? "applied" : "pending",
    ...(appliedMap.has(name) && appliedMap.get(name) !== hash ? { drift: true } : {}),
  }));
  const body = {
    version: 1, createdAt: new Date().toISOString(), environment,
    // `?? null` obrigatório: sem role, `runtimeRole` seria `undefined`, e
    // `JSON.stringify` DESCARTA chave undefined ao gravar o manifesto. O plano
    // relido do disco viria sem o campo e o `verifyPlan` acusaria "manifesto
    // alterado" num plano intacto — falha silenciosa que só aparece no apply.
    target: { fingerprint: target.fingerprint, database: identity.database, schema: identity.schema, role: identity.role }, runtimeRole: runtimeRole ?? null,
    git, migrations: entries,
  };
  return { ...body, planHash: `sha256:${sha256(stable(body))}` };
}

export function verifyPlan(plan) {
  const { planHash, ...body } = plan;
  if (planHash !== `sha256:${sha256(stable(body))}`) throw new Error("BLOCKED: manifesto foi alterado após sua criação.");
}

export function validateApply({ args, environment, target, identity, plan, authorization, git, publicKey, now = Date.now() }) {
  if (!args.apply) throw new Error("BLOCKED: migrate:apply exige --apply.");
  if (!environment) throw new Error("BLOCKED: informe --environment explicitamente.");
  if (!args["expected-target"] || args["expected-target"] !== target.fingerprint) throw new Error("BLOCKED: identidade esperada do banco ausente ou divergente.");
  if (!plan || plan.environment !== environment || plan.target?.fingerprint !== target.fingerprint) throw new Error("BLOCKED: plano prévio não corresponde ao ambiente/target.");
  verifyPlan(plan);
  // A role é opcional desde a ADR-021 (motivo na ADR-012), mas o que ela protege
  // continua: o apply recusa role diferente da que foi assinada no manifesto.
  // Comparação normalizada nos dois lados — "nenhuma role" só casa com "nenhuma
  // role", então um apply não pode introduzir uma role que a assinatura não cobre,
  // nem omitir a que ela cobre.
  if ((plan.runtimeRole ?? null) !== (args["runtime-role"] ?? null)) throw new Error("BLOCKED: runtime role diverge do manifesto autorizado.");
  if (plan.target.database !== identity.database || plan.target.schema !== identity.schema || plan.target.role !== identity.role) throw new Error("BLOCKED: identidade database/schema/role divergiu desde o plano.");
  if (plan.migrations.some((m) => m.drift)) throw new Error("BLOCKED: hashes de migrations aplicadas divergem.");
  if (environment !== "local" && (git.dirty || git.commit === "untracked")) throw new Error("BLOCKED: remoto/produção exige commit rastreado e worktree limpo.");
  if (!authorization?.reference || !authorization.actor || !authorization.nonce || !authorization.expiresAt || !authorization.signature) throw new Error("BLOCKED: autorização auditável incompleta.");
  if (authorization.environment !== environment || authorization.targetFingerprint !== target.fingerprint || authorization.planHash !== plan.planHash) throw new Error("BLOCKED: autorização não corresponde ao plano/target.");
  const expires = Date.parse(authorization.expiresAt);
  if (!Number.isFinite(expires) || expires < now || expires > now + AUTH_MAX_AGE_MS) throw new Error("BLOCKED: autorização expirada ou com validade excessiva.");
  if (!publicKey) throw new Error("BLOCKED: MIGRATION_AUTH_PUBLIC_KEY ausente.");
  if (!verify(null, Buffer.from(authorizationPayload(authorization)), publicKey, Buffer.from(authorization.signature, "base64"))) throw new Error("BLOCKED: nonce/assinatura da autorização inválido.");
}

export function assertLocalTarget(environment, target) {
  if (environment === "local" && !LOCAL_HOSTS.has(target.host)) throw new Error("BLOCKED: migrate:local aceita somente localhost/127.0.0.1/::1; .env.local remoto foi recusado.");
}

export async function savePlan(file, plan) { await writeFile(file, `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" }); }
export function newRunId() { return randomUUID(); }
