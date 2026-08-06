// Shopee Open Platform API v2 — adapter.
//
// Estado: a camada de credenciais, assinatura e OAuth está IMPLEMENTADA e a assinatura
// pública foi validada contra o sandbox em 05/08/2026 (get_shops_by_partner → HTTP 200).
// As leituras de negócio (pedidos, escrow, itens) estão aqui com os contratos da doc,
// mas ainda NÃO foram exercitadas contra uma loja real — ver docs/api-shopee.md.
//
// Padrão de referência: `mercadoLivre.ts`. Mapa da API: `docs/api-shopee.md`.

import { createHmac } from "crypto";
import { saveIntegration } from "./integrationStore";
import type { IntegrationConnection } from "./types";

// Hosts verificados em 05/08/2026 com chamada real. O host antigo
// `partner.test-stable.shopeemobile.com` responde error_sign mesmo com assinatura
// correta — não usar (a mensagem despista: parece chave errada, é host errado).
export const SHOPEE_HOSTS = {
  production: "https://partner.shopeemobile.com",
  sandbox: "https://openplatform.sandbox.test-stable.shopee.sg",
} as const;

// A tela de autorização do sandbox tem formato próprio e exige conta de teste do
// console; em produção o fluxo é o /api/v2/shop/auth_partner assinado.
const SANDBOX_AUTH_BASE = "https://open.sandbox.test-stable.shopee.com/auth";

/** Janela de validade do timestamp na assinatura; renovar tokens antes disso. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

const refreshes = new Map<string, Promise<IntegrationConnection>>();

export function shopeeSandbox(): boolean {
  return (process.env.SHOPEE_ENV ?? "sandbox").toLowerCase() !== "live";
}

export function shopeeHost(): string {
  return shopeeSandbox() ? SHOPEE_HOSTS.sandbox : SHOPEE_HOSTS.production;
}

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

function hmac(partnerKey: string, baseString: string): string {
  return createHmac("sha256", partnerKey).update(baseString).digest("hex");
}

/**
 * Assinatura de endpoint público (auth/token): partner_id + api_path + timestamp.
 * Validado contra o sandbox em 05/08/2026.
 */
export function signPublic(apiPath: string, timestamp: number): string {
  const { partnerId, partnerKey } = credentials();
  return hmac(partnerKey, `${partnerId}${apiPath}${timestamp}`);
}

/**
 * Assinatura de endpoint de loja: partner_id + api_path + timestamp + access_token + shop_id.
 * ⚠️ Ainda não exercitado contra loja real — validar na primeira autorização.
 */
export function signShop(apiPath: string, timestamp: number, accessToken: string, shopId: string): string {
  const { partnerId, partnerKey } = credentials();
  return hmac(partnerKey, `${partnerId}${apiPath}${timestamp}${accessToken}${shopId}`);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Erro de API da Shopee com o request_id, que o suporte deles exige para investigar. */
export class ShopeeApiError extends Error {
  constructor(readonly code: string, message: string, readonly requestId?: string) {
    super(message);
    this.name = "ShopeeApiError";
  }
}

interface ShopeeEnvelope {
  error?: string;
  message?: string;
  request_id?: string;
  response?: unknown;
  [key: string]: unknown;
}

function unwrap<T>(payload: ShopeeEnvelope): T {
  if (payload.error) {
    throw new ShopeeApiError(payload.error, payload.message || payload.error, payload.request_id);
  }
  // Endpoints novos devolvem os dados em `response`; os públicos, na raiz.
  return (payload.response !== undefined ? payload.response : payload) as T;
}

async function requestJson(url: string, init?: RequestInit): Promise<ShopeeEnvelope> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 350 * 2 ** attempt));
        continue;
      }
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error("A Shopee demorou para responder. Tente novamente em instantes.");
      }
      throw error;
    }
    const transient = response.status === 429 || response.status >= 500;
    if (transient && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      continue;
    }
    return (await response.json().catch(() => ({}))) as ShopeeEnvelope;
  }
  throw new Error("Falha ao falar com a Shopee.");
}

/** Chamada a endpoint público (não exige loja autorizada). */
export async function shopeePublicFetch<T>(apiPath: string, params: Record<string, string> = {}): Promise<T> {
  const { partnerId } = credentials();
  const timestamp = nowSeconds();
  const query = new URLSearchParams({
    partner_id: partnerId,
    timestamp: String(timestamp),
    sign: signPublic(apiPath, timestamp),
    ...params,
  });
  return unwrap<T>(await requestJson(`${shopeeHost()}${apiPath}?${query}`));
}

// ----- OAuth ---------------------------------------------------------------

/**
 * URL que o vendedor abre para autorizar a loja.
 * Em produção é o auth_partner assinado; no sandbox, a tela fixa com conta de teste.
 */
export function authorizationUrl(redirectUri: string): string {
  const { partnerId } = credentials();
  if (shopeeSandbox()) {
    const url = new URL(SANDBOX_AUTH_BASE);
    url.searchParams.set("auth_type", "seller");
    url.searchParams.set("partner_id", partnerId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    return url.toString();
  }
  const apiPath = "/api/v2/shop/auth_partner";
  const timestamp = nowSeconds();
  const query = new URLSearchParams({
    partner_id: partnerId,
    timestamp: String(timestamp),
    sign: signPublic(apiPath, timestamp),
    redirect: redirectUri,
  });
  return `${SHOPEE_HOSTS.production}${apiPath}?${query}`;
}

interface ShopeeTokenResponse {
  access_token: string;
  refresh_token: string;
  expire_in: number;
  shop_id?: number;
  merchant_id?: number;
}

/** Troca o `code` do callback pelo par de tokens da loja. */
export async function exchangeShopeeCode(code: string, shopId: string): Promise<ShopeeTokenResponse> {
  const { partnerId } = credentials();
  const apiPath = "/api/v2/auth/token/get";
  const timestamp = nowSeconds();
  const query = new URLSearchParams({
    partner_id: partnerId,
    timestamp: String(timestamp),
    sign: signPublic(apiPath, timestamp),
  });
  const payload = await requestJson(`${shopeeHost()}${apiPath}?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, shop_id: Number(shopId), partner_id: Number(partnerId) }),
  });
  return unwrap<ShopeeTokenResponse>(payload);
}

/**
 * Renova o access_token. ATENÇÃO: o refresh_token ROTACIONA a cada uso — o novo
 * precisa ser persistido, senão a conexão morre no ciclo seguinte (mesma pegadinha
 * do Mercado Livre).
 */
export async function refreshShopeeConnection(connection: IntegrationConnection): Promise<IntegrationConnection> {
  const pending = refreshes.get(connection.id);
  if (pending) return pending;

  const task = (async () => {
    const { partnerId } = credentials();
    const shopId = connection.externalAccountId;
    const apiPath = "/api/v2/auth/access_token/get";
    const timestamp = nowSeconds();
    const query = new URLSearchParams({
      partner_id: partnerId,
      timestamp: String(timestamp),
      sign: signPublic(apiPath, timestamp),
    });
    const payload = await requestJson(`${shopeeHost()}${apiPath}?${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refresh_token: connection.refreshToken,
        shop_id: Number(shopId),
        partner_id: Number(partnerId),
      }),
    });
    const token = unwrap<ShopeeTokenResponse>(payload);
    return saveIntegration({
      ...connection,
      accessToken: token.access_token,
      refreshToken: token.refresh_token, // rotacionou: persistir o novo
      accessExpiresAt: new Date(Date.now() + token.expire_in * 1000).toISOString(),
      status: "connected",
      updatedAt: new Date().toISOString(),
    });
  })().finally(() => refreshes.delete(connection.id));

  refreshes.set(connection.id, task);
  return task;
}

async function validConnection(connection: IntegrationConnection): Promise<IntegrationConnection> {
  const expiresAt = connection.accessExpiresAt ? Date.parse(connection.accessExpiresAt) : 0;
  if (expiresAt && expiresAt - REFRESH_SKEW_MS > Date.now()) return connection;
  return refreshShopeeConnection(connection);
}

/** Chamada autenticada a um endpoint de loja. */
export async function shopeeFetch<T>(
  connection: IntegrationConnection,
  apiPath: string,
  params: Record<string, string> = {},
  init?: RequestInit
): Promise<T> {
  let current = await validConnection(connection);
  const { partnerId } = credentials();

  for (let attempt = 0; attempt < 2; attempt++) {
    const shopId = current.externalAccountId;
    const accessToken = current.accessToken ?? "";
    const timestamp = nowSeconds();
    const query = new URLSearchParams({
      partner_id: partnerId,
      timestamp: String(timestamp),
      access_token: accessToken,
      shop_id: shopId,
      sign: signShop(apiPath, timestamp, accessToken, shopId),
      ...params,
    });
    const payload = await requestJson(`${shopeeHost()}${apiPath}?${query}`, init);

    // Token expirado antes do previsto: renova uma vez e repete.
    if ((payload.error === "error_auth" || payload.error === "invalid_access_token") && attempt === 0) {
      current = await refreshShopeeConnection(current);
      continue;
    }
    return unwrap<T>(payload);
  }
  throw new Error("Não foi possível autenticar na Shopee.");
}

// ----- Leituras de negócio -------------------------------------------------
// ⚠️ Contratos vindos da doc; validar contra loja real antes de ligar no sync.

export interface ShopeeShopInfo {
  shop_name?: string;
  region?: string;
  status?: string;
  merchant_id?: number;
}

export async function getShopeeShopInfo(connection: IntegrationConnection): Promise<ShopeeShopInfo> {
  return shopeeFetch<ShopeeShopInfo>(connection, "/api/v2/shop/get_shop_info");
}

/** Lojas que autorizaram este app (endpoint público — usado no diagnóstico). */
export async function getAuthorizedShops(): Promise<{ authed_shop_list?: Array<{ shop_id: number }> }> {
  return shopeePublicFetch("/api/v2/public/get_shops_by_partner", { page_no: "1", page_size: "100" });
}

// ----- Limites da API (confirmados na doc oficial em 05/08/2026) ------------

/** Janela máxima de time_from/time_to em get_order_list. */
export const ORDER_WINDOW_DAYS = 15;
/** page_size de get_order_list aceita de 1 a 100. */
export const ORDER_PAGE_SIZE = 100;
/** get_order_detail aceita no máximo 50 order_sn por chamada. */
export const ORDER_DETAIL_BATCH = 50;

interface OrderListResponse {
  order_list?: Array<{ order_sn: string; order_status?: string }>;
  more?: boolean;
  next_cursor?: string;
}

/**
 * Lista os `order_sn` de uma janela de tempo. A janela NÃO pode passar de 15
 * dias — quem chama é responsável por fatiar (ver shopeeSync).
 */
export async function getShopeeOrderList(
  connection: IntegrationConnection,
  input: { from: Date; to: Date; cursor?: string; timeField?: "create_time" | "update_time" }
): Promise<OrderListResponse> {
  const params: Record<string, string> = {
    time_range_field: input.timeField ?? "create_time",
    time_from: String(Math.floor(input.from.getTime() / 1000)),
    time_to: String(Math.floor(input.to.getTime() / 1000)),
    page_size: String(ORDER_PAGE_SIZE),
    response_optional_fields: "order_status",
  };
  if (input.cursor) params.cursor = input.cursor;
  return shopeeFetch<OrderListResponse>(connection, "/api/v2/order/get_order_list", params);
}

/** Detalhe de até 50 pedidos por chamada. */
export async function getShopeeOrderDetail(
  connection: IntegrationConnection,
  orderSns: string[]
): Promise<{ order_list?: unknown[] }> {
  if (orderSns.length > ORDER_DETAIL_BATCH) {
    throw new Error(`get_order_detail aceita no máximo ${ORDER_DETAIL_BATCH} pedidos por chamada.`);
  }
  return shopeeFetch(connection, "/api/v2/order/get_order_detail", {
    order_sn_list: orderSns.join(","),
    response_optional_fields: [
      "item_list",
      "total_amount",
      "actual_shipping_fee",
      "estimated_shipping_fee",
      "reverse_shipping_fee",
      "pay_time",
      "update_time",
      "package_list",
    ].join(","),
  });
}

/** Escrow (taxas reais) de um pedido — só existe após o pagamento. */
export async function getShopeeEscrowDetail(
  connection: IntegrationConnection,
  orderSn: string
): Promise<unknown> {
  return shopeeFetch(connection, "/api/v2/payment/get_escrow_detail", { order_sn: orderSn });
}

/** Lista de itens do catálogo (paginada por offset). */
export async function getShopeeItemList(
  connection: IntegrationConnection,
  input: { offset?: number; pageSize?: number; status?: string }
): Promise<{ item?: Array<{ item_id: number }>; total_count?: number; has_next_page?: boolean; next_offset?: number }> {
  return shopeeFetch(connection, "/api/v2/product/get_item_list", {
    offset: String(input.offset ?? 0),
    page_size: String(input.pageSize ?? 50),
    item_status: input.status ?? "NORMAL",
  });
}

/** Informações base de até 50 itens. */
export async function getShopeeItemBaseInfo(
  connection: IntegrationConnection,
  itemIds: number[]
): Promise<{ item_list?: unknown[] }> {
  return shopeeFetch(connection, "/api/v2/product/get_item_base_info", {
    item_id_list: itemIds.join(","),
  });
}

/** `connection_id` canônico do canal: uma conexão por loja. */
export function shopeeConnectionId(shopId: string): string {
  return `shopee:${shopId}`;
}
