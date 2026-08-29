import crypto from "crypto";
import { registrarChamada } from "./integrations/contadorDeChamadas";

// Cliente TikTok Shop Partner API v2.
// - Token endpoints (get/refresh): usam app_key+app_secret direto, SEM assinatura.
// - Endpoints de negócio: exigem assinatura HMAC-SHA256 + app_key + timestamp +
//   access_token (header) + shop_cipher.
// Credenciais vêm do ambiente (TIKTOK_APP_KEY / TIKTOK_APP_SECRET) — nunca no código.
//
// ⚠️ Algoritmo de assinatura conforme a doc oficial; validar contra o Postman
// do Partner Center se algum endpoint retornar erro de sign (code de auth).

const TOKEN_BASE = "https://auth.tiktok-shops.com/api/v2/token"; // confirmado no smoke-test
const API_BASE = "https://open-api.tiktokglobalshop.com";
const AUTH_BASE = "https://services.tiktokshop.com/open/authorize";
export const TIKTOK_OAUTH_STATE_COOKIE = "sellercore_tiktok_oauth_state";

export function tiktokConfigured(): boolean {
  return !!(
    process.env.TIKTOK_APP_KEY &&
    process.env.TIKTOK_APP_SECRET &&
    (process.env.TIKTOK_SERVICE_ID || process.env.TIKTOK_AUTH_URL)
  );
}

/** Monta a autorização ROW (inclui Brasil) e sempre injeta um state novo. */
export function tiktokAuthorizationUrl(state: string): string {
  const configuredUrl = process.env.TIKTOK_AUTH_URL;
  const serviceId = process.env.TIKTOK_SERVICE_ID;

  if (!configuredUrl && !serviceId) {
    throw new Error("Configure TIKTOK_SERVICE_ID no ambiente.");
  }

  const url = configuredUrl ? new URL(configuredUrl) : new URL(AUTH_BASE);
  if (serviceId) url.searchParams.set("service_id", serviceId);
  if (!url.searchParams.get("service_id")) {
    throw new Error("A autorização do TikTok Shop precisa conter service_id.");
  }
  url.searchParams.set("state", state);
  return url.toString();
}

function creds(): { key: string; secret: string } {
  const key = process.env.TIKTOK_APP_KEY;
  const secret = process.env.TIKTOK_APP_SECRET;
  if (!key || !secret) {
    throw new Error("Configure TIKTOK_APP_KEY e TIKTOK_APP_SECRET no ambiente.");
  }
  return { key, secret };
}

/**
 * Assinatura HMAC-SHA256 da TikTok Shop.
 * base = path + concat(sort(params sem sign/access_token)) + body; embrulhado
 * pelo app_secret nas duas pontas; HMAC-SHA256 com o secret → hex.
 */
function sign(
  path: string,
  query: Record<string, string>,
  body: string,
  secret: string
): string {
  const keys = Object.keys(query)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort();
  let base = path;
  for (const k of keys) base += k + query[k];
  base += body;
  base = secret + base + secret;
  return crypto.createHmac("sha256", secret).update(base).digest("hex");
}

interface TokenData {
  access_token: string;
  refresh_token: string;
  access_token_expire_in?: number; // epoch (segundos)
  refresh_token_expire_in?: number; // epoch (segundos)
  open_id?: string;
  seller_name?: string;
  seller_base_region?: string;
}

async function tokenCall(op: "get" | "refresh", extra: Record<string, string>, signal?: AbortSignal): Promise<TokenData> {
  const { key, secret } = creds();
  const url = new URL(`${TOKEN_BASE}/${op}`);
  url.searchParams.set("app_key", key);
  url.searchParams.set("app_secret", secret);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { "Content-Type": "application/json" },
    signal: signal ?? AbortSignal.timeout(30_000),
  });
  const json = await res.json();
  // Mesmo que o corpo de um 5xx mencione credenciais, o provedor pode ter
  // consumido o refresh token antes de falhar. Não o classifique como grant
  // definitivamente inválido: o coordenador precisa interditar o token antigo.
  if (res.status >= 500) {
    throw new Error(`TikTok token/${op} temporariamente indisponível (${res.status}).`);
  }
  if (!res.ok || json.code !== 0 || !json.data) {
    throw classifyTiktokApiError({ httpStatus: res.status, code: json.code, message: json.message });
  }
  return json.data as TokenData;
}

/** Troca o auth_code (do consentimento) por access_token + refresh_token. */
export function exchangeAuthCode(authCode: string): Promise<TokenData> {
  return tokenCall("get", { auth_code: authCode, grant_type: "authorized_code" });
}

/** Renova o access_token usando o refresh_token. */
export function refreshAccessToken(refreshToken: string, signal?: AbortSignal): Promise<TokenData> {
  return tokenCall("refresh", { refresh_token: refreshToken, grant_type: "refresh_token" }, signal);
}

export interface TiktokFetchOpts {
  method?: "GET" | "POST" | "PUT";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  accessToken: string;
  shopCipher?: string;
}

/** Converte somente falhas inequívocas de credencial em um erro operacional
 * seguro. Mensagens do provedor nunca são propagadas para a UI neste caso. */
export function classifyTiktokApiError(input: {
  httpStatus?: number;
  code?: unknown;
  message?: unknown;
}): Error {
  const message = typeof input.message === "string" ? input.message : "";
  const normalized = message.toLowerCase();
  const authFailure = input.httpStatus === 401 || [
    "access token is invalid", "access token has expired", "invalid access_token",
    "invalid access token", "refresh token is invalid", "refresh token has expired",
  ].some((fragment) => normalized.includes(fragment));
  if (authFailure) {
    const error = new Error("A autorização da TikTok Shop expirou ou foi revogada. Reconecte a loja.") as Error & { code: "REAUTH_REQUIRED" };
    error.name = "TiktokApiAuthError";
    error.code = "REAUTH_REQUIRED";
    return error;
  }
  if (input.httpStatus === 429 || String(input.code) === "36009002") {
    const error = new Error("A TikTok Shop limitou temporariamente as solicitacoes.") as Error & { code: "RATE_LIMITED" };
    error.name = "TiktokApiRateLimitError";
    error.code = "RATE_LIMITED";
    return error;
  }
  const code = String(input.code ?? "desconhecido").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  return new Error(`A TikTok Shop recusou a solicitação (code ${code || "desconhecido"}).`);
}

/** Chamada autenticada+assinada a um endpoint de negócio da TikTok Shop. */
export async function tiktokFetch<T = unknown>(path: string, opts: TiktokFetchOpts): Promise<T> {
  const { key, secret } = creds();
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const q: Record<string, string> = { app_key: key, timestamp };
  if (opts.shopCipher) q.shop_cipher = opts.shopCipher;
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== "") q[k] = String(v);
    }
  }

  const bodyStr = opts.body ? JSON.stringify(opts.body) : "";
  q.sign = sign(path, q, bodyStr, secret);

  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      "x-tts-access-token": opts.accessToken,
    },
    body: bodyStr || undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json();
  // Contagem no funil unico: e o unico lugar por onde TODA chamada passa.
  // Ver `contadorDeChamadas.ts` — o alerta da Shopee de 29/08/2026 chegou e a
  // pergunta "quantas chamadas por endpoint e por hora" nao tinha resposta.
  registrarChamada("tiktok_shop", path, {
    status: res.status,
    limite: res.headers.get("x-ratelimit-remaining"),
    erro: !res.ok || json.code !== 0,
  });
  if (!res.ok || json.code !== 0) {
    throw classifyTiktokApiError({ httpStatus: res.status, code: json.code, message: json.message });
  }
  return json.data as T;
}

export interface TiktokShopInfo {
  id: string;
  name?: string;
  region?: string;
  seller_type?: string;
  cipher?: string;
}

/** Lojas autorizadas pelo vendedor (contém o shop_cipher usado nas demais chamadas). */
export async function getAuthorizedShops(accessToken: string): Promise<TiktokShopInfo[]> {
  const data = await tiktokFetch<{ shops?: TiktokShopInfo[] }>("/authorization/202309/shops", {
    accessToken,
  });
  return data.shops ?? [];
}

/** Converte epoch (segundos) em ISO, ou undefined. */
export function epochToIso(sec?: number): string | undefined {
  return sec ? new Date(sec * 1000).toISOString() : undefined;
}

// ---------------------------------------------------------------------------
// Endpoints de negócio
//
// Versões escolhidas pela regra "maior versão aplicável" do OAS oficial, em
// 07/08 (ver docs/tiktok-shop-integracao.md). Os parâmetros abaixo vêm do
// schema, não de suposição.
// ---------------------------------------------------------------------------

/** Máximo de pedidos por página no search. O schema exige page_size; 50 é o
 *  valor que a doc usa nos exemplos. ⚠️ Confirmar o teto na primeira resposta. */
export const ORDER_PAGE_SIZE = 50;
/** Pedidos por chamada de detalhe. ⚠️ O OAS declara `ids` como array sem
 *  informar o teto — 50 é conservador e alinhado ao page size. */
export const ORDER_DETAIL_BATCH = 50;
export const PRODUCT_PAGE_SIZE = 50;

export interface TiktokShopRef {
  accessToken: string;
  shopCipher?: string;
}

interface Paginado<T> {
  items: T[];
  nextPageToken?: string;
  total?: number;
}

/**
 * Lista pedidos por janela de criação.
 * `POST /order/202309/orders/search` — única versão com search.
 * Janela vai no corpo (`create_time_ge` / `create_time_lt`, epoch em segundos);
 * paginação vai na query.
 */
export async function getTiktokOrderList(
  shop: TiktokShopRef,
  opts: { createTimeGe: number; createTimeLt: number; pageToken?: string }
): Promise<Paginado<{ id: string }>> {
  const data = await tiktokFetch<{
    orders?: Array<{ id: string }>;
    next_page_token?: string;
    total_count?: number;
  }>("/order/202309/orders/search", {
    method: "POST",
    accessToken: shop.accessToken,
    shopCipher: shop.shopCipher,
    query: { page_size: ORDER_PAGE_SIZE, page_token: opts.pageToken },
    body: { create_time_ge: opts.createTimeGe, create_time_lt: opts.createTimeLt },
  });
  return {
    items: data.orders ?? [],
    nextPageToken: data.next_page_token,
    total: data.total_count,
  };
}

/**
 * Detalhe dos pedidos. `GET /order/202507/orders` (mais nova que a 202309).
 * ⚠️ `ids` é array no schema; enviamos separado por vírgula, que é a convenção
 * da TikTok — confirmar na primeira chamada real.
 */
export async function getTiktokOrderDetail(
  shop: TiktokShopRef,
  ids: string[]
): Promise<unknown[]> {
  if (!ids.length) return [];
  const data = await tiktokFetch<{ orders?: unknown[] }>("/order/202507/orders", {
    accessToken: shop.accessToken,
    shopCipher: shop.shopCipher,
    query: { ids: ids.join(",") },
  });
  return data.orders ?? [];
}

/**
 * Extrato financeiro de UM pedido — o equivalente ao escrow da Shopee, e a
 * única fonte de taxa real. `GET /finance/202501/orders/{order_id}/statement_transactions`.
 */
export async function getTiktokOrderStatement(
  shop: TiktokShopRef,
  orderId: string
): Promise<unknown> {
  return tiktokFetch(`/finance/202501/orders/${encodeURIComponent(orderId)}/statement_transactions`, {
    accessToken: shop.accessToken,
    shopCipher: shop.shopCipher,
  });
}

/** Catálogo. `POST /product/202502/products/search` (mais nova que 202309/202312). */
export async function getTiktokProducts(
  shop: TiktokShopRef,
  opts: { pageToken?: string } = {}
): Promise<Paginado<unknown>> {
  const data = await tiktokFetch<{ products?: unknown[]; next_page_token?: string; total_count?: number }>(
    "/product/202502/products/search",
    {
      method: "POST",
      accessToken: shop.accessToken,
      shopCipher: shop.shopCipher,
      query: { page_size: PRODUCT_PAGE_SIZE, page_token: opts.pageToken },
      body: {},
    }
  );
  return {
    items: data.products ?? [],
    nextPageToken: data.next_page_token,
    total: data.total_count,
  };
}
