import crypto from "crypto";

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

async function tokenCall(op: "get" | "refresh", extra: Record<string, string>): Promise<TokenData> {
  const { key, secret } = creds();
  const url = new URL(`${TOKEN_BASE}/${op}`);
  url.searchParams.set("app_key", key);
  url.searchParams.set("app_secret", secret);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), { headers: { "Content-Type": "application/json" } });
  const json = await res.json();
  if (json.code !== 0 || !json.data) {
    throw new Error(`TikTok token/${op}: ${json.message || "erro"} (code ${json.code})`);
  }
  return json.data as TokenData;
}

/** Troca o auth_code (do consentimento) por access_token + refresh_token. */
export function exchangeAuthCode(authCode: string): Promise<TokenData> {
  return tokenCall("get", { auth_code: authCode, grant_type: "authorized_code" });
}

/** Renova o access_token usando o refresh_token. */
export function refreshAccessToken(refreshToken: string): Promise<TokenData> {
  return tokenCall("refresh", { refresh_token: refreshToken, grant_type: "refresh_token" });
}

export interface TiktokFetchOpts {
  method?: "GET" | "POST" | "PUT";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  accessToken: string;
  shopCipher?: string;
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
  });
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`TikTok ${path}: ${json.message || "erro"} (code ${json.code})`);
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
