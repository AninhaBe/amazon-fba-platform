// Re-valida com TOKEN REAL os endpoints que docs/api-mercado-livre.md declara
// bloqueados/abertos. O ML muda regra sem aviso e sem changelog público — este
// script existe para que a re-verificação seja um comando, não uma investigação.
//
// NÃO faz refresh de propósito: o refresh token do ML rotaciona e queimá-lo aqui
// derrubaria a conexão de produção (ver oauthRefreshLease.ts). Usa só o
// access_token já guardado, e apenas se ainda estiver válido. Somente GETs.
//
//   node --env-file=.env.local scripts/ml-endpoints-probe.mjs
import crypto from "node:crypto";
import pg from "pg";

const PREFIX = "enc:v1:";
function reveal(v) {
  if (!v) return undefined;
  if (v.startsWith("plain:")) return v.slice(6);
  if (!v.startsWith(PREFIX)) return v;
  const key = crypto.createHash("sha256").update(process.env.INTEGRATION_TOKEN_KEY).digest();
  const p = Buffer.from(v.slice(PREFIX.length), "base64url");
  const d = crypto.createDecipheriv("aes-256-gcm", key, p.subarray(0, 12));
  d.setAuthTag(p.subarray(12, 28));
  return Buffer.concat([d.update(p.subarray(28)), d.final()]).toString("utf8");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Panorama primeiro: sem isto, "0 conexões ML" e "banco errado" ficam
// indistinguíveis — foi exatamente o que aconteceu na primeira execução.
const todos = await pool.query(
  `SELECT provider, count(*)::int AS n FROM workspace_integrations GROUP BY provider ORDER BY provider`
);
console.log("Integrações no banco apontado por DATABASE_URL:");
if (!todos.rows.length) console.log("  (nenhuma)");
for (const r of todos.rows) console.log(`  ${r.provider}: ${r.n}`);

// ⚠️ CONTA. Há mais de uma conexão de ML no banco e elas são de PESSOAS DIFERENTES:
//   648425194  NEXAHUBBRASIL  → a nossa
//   1191100170 CRYSTALFANCY   → do colega/parceiro — NÃO USAR
// A sonda fica presa na nossa. Para olhar outra, passe ML_SELLER_ID explicitamente.
const SELLER_PADRAO = "648425194";
const alvoSeller = process.env.ML_SELLER_ID ?? SELLER_PADRAO;

// O provider gravado é `mercado_livre` (com underscore). Errar essa string devolve
// zero linhas e parece "não há conexão" — por isso o panorama acima vem antes.
const { rows } = await pool.query(
  `SELECT id, external_account_id, access_token, access_expires_at, status
     FROM workspace_integrations
    WHERE provider='mercado_livre' AND external_account_id = $1
    ORDER BY updated_at DESC`,
  [alvoSeller]
);
if (alvoSeller !== SELLER_PADRAO) {
  console.log(`\n⚠️  Usando seller ${alvoSeller} por ML_SELLER_ID — confirme que a conta é sua.`);
}
for (const r of rows) {
  const exp = r.access_expires_at ? new Date(r.access_expires_at) : null;
  const viva = exp && exp > new Date();
  console.log(`  ${r.id} · seller ${r.external_account_id} · status=${r.status} · expira=${exp?.toISOString() ?? "null"} ${viva ? "VÁLIDO" : "expirado"}`);
}

const c = rows.find((r) => r.access_expires_at && new Date(r.access_expires_at) > new Date() && reveal(r.access_token));
if (!c) {
  console.log("\n⚠️  Nenhum access_token de ML em cache ainda válido neste banco.");
  console.log("   Rode apontando para o DATABASE_URL de produção, ou abra o SellerCore");
  console.log("   (o cron renova o token sozinho) e rode de novo.");
  await pool.end();
  process.exit(0);
}
const token = reveal(c.access_token);
const me = c.external_account_id;
console.log(`\nToken de ${c.id} (seller ${me}). Só GETs.\n`);

const alvos = [
  ["/sites/MLB/search?q=martelo%20de%20borracha&limit=5", "★ busca por termo — é ISTO que o Mercado Turbo usa"],
  ["/sites/MLB/search?category=MLB1000&limit=5", "busca por categoria"],
  [`/sites/MLB/search?seller_id=${me}&limit=5`, "busca pelo MEU seller_id"],
  ["/trends/MLB", "termos mais buscados (doc diz: funciona com token)"],
  ["/highlights/MLB/category/MLB1648", "top 20 da categoria (doc diz: funciona)"],
  [`/users/${me}/items/search?limit=1`, "meus próprios itens (controle: tem de funcionar)"],
];

for (const [path, desc] of alvos) {
  try {
    const r = await fetch(`https://api.mercadolibre.com${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await r.text();
    let resumo = body.slice(0, 200).replace(/\s+/g, " ");
    if (r.ok) {
      try {
        const j = JSON.parse(body);
        const n = j.results?.length ?? j.content?.length ?? (Array.isArray(j) ? j.length : undefined);
        resumo = `n=${n ?? "?"} · chaves: ${Object.keys(j).slice(0, 10).join(",")}`;
      } catch {}
    }
    console.log(`${r.ok ? "OK " : "!! "} ${r.status}  ${desc}\n         ${path}\n         ${resumo}\n`);
  } catch (e) {
    console.log(`ERRO  ${desc} — ${e.message}\n`);
  }
}
await pool.end();
