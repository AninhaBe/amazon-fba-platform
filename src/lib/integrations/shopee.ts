// Shopee Open Platform API v2 — ESQUELETO (não conectado ainda).
//
// A usuária ainda não tem loja Shopee; este adapter está *engatilhado* para quando
// for implementado. O canal permanece `availability: "planned"` em registry.ts, então
// nada aqui está ligado à UI/OAuth/sync — não quebra nada.
//
// Mapa completo (host BR, assinatura, OAuth, pedidos, escrow, mapeamento canônico e o
// roteiro de arquivos) em `docs/api-shopee.md`. Padrão de referência: `mercadoLivre.ts`.

import { createHmac } from "crypto";

export const SHOPEE_HOSTS = {
  production: "https://partner.shopeemobile.com",
  // ⚠️ confirmar host/região do Brasil na doc oficial antes de usar
  sandbox: "https://partner.test-stable.shopeemobile.com",
} as const;

export function shopeeConfigured(): boolean {
  return Boolean(process.env.SHOPEE_PARTNER_ID && process.env.SHOPEE_PARTNER_KEY);
}

export function credentials(): { partnerId: string; partnerKey: string } {
  const partnerId = process.env.SHOPEE_PARTNER_ID;
  const partnerKey = process.env.SHOPEE_PARTNER_KEY;
  if (!partnerId || !partnerKey) {
    throw new Error("Shopee não configurado (defina SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY).");
  }
  return { partnerId, partnerKey };
}

// Assinatura HMAC-SHA256. A base string muda por tipo de endpoint (público vs shop).
// ⚠️ Confirmar a composição exata da base string por endpoint em docs/api-shopee.md.
export function sign(partnerKey: string, baseString: string): string {
  return createHmac("sha256", partnerKey).update(baseString).digest("hex");
}

// TODO (quando houver loja) — implementar seguindo docs/api-shopee.md e o padrão do
// mercadoLivre.ts:
//   - shopeeFetch(path, { shopId, accessToken, params }) — monta sign + query e chama.
//   - authorizationUrl(redirect)  → GET  /api/v2/shop/auth_partner
//   - exchangeCode(code, shopId)  → POST /api/v2/auth/token/get
//   - refreshConnection(conn)     → POST /api/v2/auth/access_token/get  (refresh ROTACIONA!)
//   - getOrders / getOrderDetail / getEscrowDetail / getItems
