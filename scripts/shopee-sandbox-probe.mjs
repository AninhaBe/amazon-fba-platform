// Uso: node --env-file=.env.local scripts/shopee-sandbox-probe.mjs
// Revalida a cadeia pública da Shopee no sandbox: assinatura HMAC + get_shops_by_partner.
// Replica a assinatura de `shopee.ts` (não importa o módulo porque a cadeia de imports
// usa parameter properties, que o strip-only mode do Node não aceita).
// Somente leitura.
import { createHmac } from "node:crypto";

const PARTNER_ID = process.env.SHOPEE_PARTNER_ID;
const PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY;
const SANDBOX = (process.env.SHOPEE_ENV ?? "sandbox").toLowerCase() !== "live";
const HOST = SANDBOX
  ? "https://openplatform.sandbox.test-stable.shopee.sg"
  : "https://partner.shopeemobile.com";

console.log("ambiente  :", SANDBOX ? "sandbox" : "LIVE");
console.log("host      :", HOST);
console.log("partner_id:", PARTNER_ID);
console.log("chave     :", PARTNER_KEY ? `${PARTNER_KEY.slice(0, 6)}… (${PARTNER_KEY.length} chars)` : "AUSENTE");

const signPublic = (apiPath, ts) =>
  createHmac("sha256", PARTNER_KEY).update(`${PARTNER_ID}${apiPath}${ts}`).digest("hex");

async function chamar(apiPath, extra = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const q = new URLSearchParams({ partner_id: PARTNER_ID, timestamp: String(ts), sign: signPublic(apiPath, ts), ...extra });
  const url = `${HOST}${apiPath}?${q}`;
  const t0 = Date.now();
  const r = await fetch(url);
  const texto = await r.text();
  let corpo;
  try { corpo = JSON.parse(texto); } catch { corpo = texto.slice(0, 200); }
  return { status: r.status, ms: Date.now() - t0, corpo };
}

for (const [path, extra, rotulo] of [
  ["/api/v2/public/get_shops_by_partner", { page_size: "100" }, "lojas autorizadas"],
  ["/api/v2/public/get_merchants_by_partner", { page_size: "100" }, "merchants (controle)"],
]) {
  const r = await chamar(path, extra);
  const c = r.corpo ?? {};
  const erro = c.error || "";
  console.log(`\n${path}  →  HTTP ${r.status} em ${r.ms}ms   [${rotulo}]`);
  if (erro) {
    console.log(`  erro: ${erro} — ${c.message ?? ""}`);
  } else {
    const lista = c.authed_shop_list ?? c.authed_merchant_list ?? [];
    console.log(`  OK — ${lista.length} item(ns)`);
    for (const x of lista.slice(0, 5)) console.log(`    ${JSON.stringify(x)}`);
    if (!lista.length) console.log("    (nenhuma loja/merchant de teste autorizou o app)");
  }
}
