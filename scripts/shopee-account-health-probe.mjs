// Uso: node --env-file=.env.local scripts/shopee-account-health-probe.mjs
//
// SOMENTE LEITURA: sonda os endpoints de account_health na loja Shopee real
// antes de desenhar tela (ordem do cérebro, 28/08/2026) — a categoria ERP lista
// os endpoints, mas só a chamada real prova que não respondem api_suspended.
//
// Autossuficiente de propósito: a cadeia de imports de `shopee.ts` usa
// parameter properties que o strip-only do Node não aceita (mesmo motivo do
// shopee-sandbox-probe). Replica a assinatura de loja de `shopee.ts` e o
// revealSecret de `secrets.ts`. Não imprime token nem credencial.
import { createHash, createHmac, createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire("G:/amazon-fba-platform/package.json");
const { Client } = require("pg");

const CONN = "shopee:275804987";
const HOST = "https://partner.shopeemobile.com";
const PARTNER_ID = process.env.SHOPEE_PARTNER_ID;
const PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY;
if (!PARTNER_ID || !PARTNER_KEY) throw new Error("SHOPEE_PARTNER_ID/KEY ausentes.");

// revealSecret de src/lib/integrations/secrets.ts, replicado.
function revealSecret(value) {
  if (!value) return undefined;
  if (value.startsWith("plain:")) return value.slice(6);
  if (!value.startsWith("enc:v1:")) return value;
  const keySource = process.env.INTEGRATION_TOKEN_KEY;
  if (!keySource) throw new Error("INTEGRATION_TOKEN_KEY ausente.");
  const key = createHash("sha256").update(keySource).digest();
  const payload = Buffer.from(value.slice(7), "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
}

const dbUrl = process.env.DATABASE_URL
  ?? readFileSync("G:/amazon-fba-platform/.env.local", "utf8").match(/^DATABASE_URL=(.+)$/m)?.[1];
const client = new Client({ connectionString: dbUrl.trim(), ssl: { rejectUnauthorized: false } });
await client.connect();
const [row] = (await client.query(
  `SELECT external_account_id, access_token, access_expires_at
     FROM workspace_integrations WHERE id = $1`,
  [CONN]
)).rows;
await client.end();
if (!row) throw new Error("Conexão não encontrada.");

const shopId = String(row.external_account_id);
const accessToken = revealSecret(row.access_token) ?? "";
const expiraEm = row.access_expires_at ? new Date(row.access_expires_at) : null;
console.log(`token expira em: ${expiraEm?.toISOString() ?? "?"} (${expiraEm && expiraEm.getTime() > Date.now() ? "válido" : "EXPIRADO — rode de novo após um ciclo do sync"})`);

const sondas = [
  ["/api/v2/account_health/get_shop_performance", {}],
  ["/api/v2/account_health/shop_penalty", {}],
  ["/api/v2/account_health/get_punishment_history", { page_no: "1", page_size: "20" }],
  ["/api/v2/account_health/get_late_orders", { page_no: "1", page_size: "20" }],
];
for (const [path, extra] of sondas) {
  const ts = Math.floor(Date.now() / 1000);
  // Assinatura de loja (signShop de shopee.ts): partner_id+path+ts+token+shop_id.
  const sign = createHmac("sha256", PARTNER_KEY)
    .update(`${PARTNER_ID}${path}${ts}${accessToken}${shopId}`)
    .digest("hex");
  const query = new URLSearchParams({
    partner_id: PARTNER_ID, timestamp: String(ts), access_token: accessToken,
    shop_id: shopId, sign, ...extra,
  });
  const t0 = Date.now();
  try {
    const resposta = await fetch(`${HOST}${path}?${query}`);
    const corpo = await resposta.json().catch(() => ({}));
    console.log(`\n${path} → HTTP ${resposta.status} em ${Date.now() - t0}ms  erro="${corpo.error ?? ""}" msg="${corpo.message ?? ""}"`);
    if (!corpo.error) console.log(JSON.stringify(corpo.response ?? corpo).slice(0, 2000));
  } catch (erro) {
    console.log(`\n${path} → FALHA DE REDE: ${erro.message}`);
  }
}
