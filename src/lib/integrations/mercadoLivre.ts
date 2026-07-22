import crypto from "crypto";
import { getIntegration, saveIntegration } from "./integrationStore";
import type { IntegrationConnection } from "./types";
import { costAt, getCosts } from "../costStore";
import { allocateByWeight, calculateContribution, type ProfitabilityLine } from "../profitability";
import { collectMercadoLivreOrders } from "./mercadoLivreOrders";

const API_BASE = "https://api.mercadolibre.com";
const AUTH_BASE = "https://auth.mercadolivre.com.br/authorization";
const TOKEN_URL = `${API_BASE}/oauth/token`;
const refreshes = new Map<string, Promise<IntegrationConnection>>();

interface MercadoLivreToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  user_id: number | string;
  refresh_token: string;
}

export interface MercadoLivreUser {
  id: number | string;
  nickname: string;
  first_name?: string;
  last_name?: string;
  country_id?: string;
  site_id?: string;
  permalink?: string;
  seller_reputation?: { level_id?: string; power_seller_status?: string };
}

export interface MercadoLivreItem {
  id: string;
  user_product_id?: string;
  title: string;
  price: number;
  currency_id: string;
  available_quantity: number;
  sold_quantity: number;
  status: string;
  start_time?: string;
  last_updated?: string;
  category_id?: string;
  listing_type_id?: string;
  catalog_listing?: boolean;
  catalog_product_id?: string | null;
  shipping?: { mode?: string; logistic_type?: string; free_shipping?: boolean };
  seller_id?: number | string;
  permalink?: string;
  pictures?: Array<{ secure_url?: string; url?: string }>;
  thumbnail?: string;
  seller_custom_field?: string | null;
  attributes?: Array<{ id: string; value_name?: string | null }>;
}

export interface MercadoLivreOrder {
  id: number | string;
  status: string;
  date_created: string;
  date_closed?: string;
  total_amount: number;
  currency_id: string;
  pack_id?: number | string | null;
  shipping?: { id?: number | string | null };
  tags?: string[];
  order_items: Array<{
    item: { id: string; title: string; seller_sku?: string | null };
    quantity: number;
    unit_price: number;
    sale_fee?: number | null;
  }>;
}

export interface MercadoLivreShipmentCosts {
  receiver?: { cost?: number | null };
  senders?: Array<{ user_id?: number | string; cost?: number | null }>;
}

export interface MercadoLivreProduct {
  id: string;
  costId: string;
  sku: string | null;
  title: string;
  price: number;
  currency: string;
  availableQuantity: number;
  soldQuantity: number;
  status: string;
  activeSince: string | null;
  lastUpdated: string | null;
  thumbnail: string | null;
  permalink: string | null;
  userProductId: string | null;
  listingTypeId: string | null;
  logisticType: string | null;
  shippingMode: string | null;
  freeShipping: boolean;
  catalogListing: boolean;
  catalogProductId: string | null;
  cost: number | null;
}

export function mercadoLivreCostId(connectionId: string, productId: string, sku?: string | null): string {
  return `mercado_livre:${connectionId}:${sku ? `sku:${sku}` : `item:${productId}`}`;
}

export function mercadoLivreCostEntry(
  costs: Awaited<ReturnType<typeof getCosts>>,
  connectionId: string,
  productId: string,
  sku?: string | null
) {
  const preferred = costs[mercadoLivreCostId(connectionId, productId, sku)];
  if (preferred) return preferred;
  const legacy = costs[`mercado_livre:${connectionId}:${productId}`];
  if (legacy) return legacy;
  if (!sku) return undefined;
  return Object.values(costs).find((entry) => entry.sku === sku && entry.id.startsWith(`mercado_livre:${connectionId}:`));
}

export function mercadoLivreTaxRate(connection: IntegrationConnection): number {
  const value = Number(connection.metadata.taxRate ?? 0);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

function sellerSku(item: MercadoLivreItem): string | null {
  return item.seller_custom_field
    || item.attributes?.find((attribute) => attribute.id === "SELLER_SKU")?.value_name
    || null;
}

export function brazilDateKey(date: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof date === "string" ? new Date(date) : date);
}

export async function getMercadoLivreProducts(connection: IntegrationConnection): Promise<{
  products: MercadoLivreProduct[];
  total: number;
  activeTotal: number;
  complete: boolean;
}> {
  const accountId = encodeURIComponent(connection.externalAccountId);
  const [search, activeSearch] = await Promise.all([
    mercadoLivreFetch<{ paging?: { total?: number }; results?: string[] }>(connection, `/users/${accountId}/items/search?limit=200`),
    mercadoLivreFetch<{ paging?: { total?: number } }>(connection, `/users/${accountId}/items/search?status=active&limit=1`),
  ]);
  const ids = (search.results ?? []).slice(0, 200);
  const batches = Array.from({ length: Math.ceil(ids.length / 20) }, (_, index) => ids.slice(index * 20, index * 20 + 20));
  const responses = await Promise.all(batches.map((batch) =>
    mercadoLivreFetch<Array<{ code: number; body: MercadoLivreItem }>>(
      connection,
      `/items?ids=${batch.map(encodeURIComponent).join(",")}`
    )
  ));
  const costs = await getCosts();
  const products = responses.flat()
    .filter((result) => result.code === 200 && result.body)
    .map(({ body }) => {
      const sku = sellerSku(body);
      const costId = mercadoLivreCostId(connection.id, body.id, sku);
      const costEntry = mercadoLivreCostEntry(costs, connection.id, body.id, sku);
      return {
        id: body.id,
        costId,
        sku,
        title: body.title,
        price: body.price,
        currency: body.currency_id,
        availableQuantity: body.available_quantity,
        soldQuantity: body.sold_quantity,
        status: body.status,
        activeSince: body.start_time ?? null,
        lastUpdated: body.last_updated ?? null,
        thumbnail: body.thumbnail ?? null,
        permalink: body.permalink ?? null,
        userProductId: body.user_product_id ?? null,
        listingTypeId: body.listing_type_id ?? null,
        logisticType: body.shipping?.logistic_type ?? null,
        shippingMode: body.shipping?.mode ?? null,
        freeShipping: body.shipping?.free_shipping ?? false,
        catalogListing: body.catalog_listing ?? false,
        catalogProductId: body.catalog_product_id ?? null,
        cost: costEntry?.cost && costEntry.cost > 0 ? costEntry.cost : null,
      };
    });
  const total = search.paging?.total ?? products.length;
  return { products, total, activeTotal: activeSearch.paging?.total ?? products.filter((product) => product.status === "active").length, complete: products.length >= total };
}

function credentials() {
  const id = process.env.MELI_CLIENT_ID;
  const secret = process.env.MELI_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Configure MELI_CLIENT_ID e MELI_CLIENT_SECRET.");
  return { id, secret };
}

export function mercadoLivreConfigured(): boolean {
  return !!(process.env.MELI_CLIENT_ID && process.env.MELI_CLIENT_SECRET);
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizationUrl(input: {
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const { id } = credentials();
  const url = new URL(AUTH_BASE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", id);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function tokenRequest(body: URLSearchParams): Promise<MercadoLivreToken> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok || !data.access_token || !data.refresh_token) {
    throw new Error(data.message || data.error_description || data.error || "Falha ao obter token do Mercado Livre.");
  }
  return data as MercadoLivreToken;
}

export function exchangeMercadoLivreCode(input: {
  code: string;
  redirectUri: string;
  verifier: string;
}): Promise<MercadoLivreToken> {
  const { id, secret } = credentials();
  return tokenRequest(new URLSearchParams({
    grant_type: "authorization_code",
    client_id: id,
    client_secret: secret,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
  }));
}

async function refreshConnection(connection: IntegrationConnection): Promise<IntegrationConnection> {
  if (!connection.refreshToken) throw new Error("Conexão do Mercado Livre sem refresh token.");
  const existing = refreshes.get(connection.id);
  if (existing) return existing;

  const task = (async () => {
    const latest = await getIntegration(connection.id) ?? connection;
    if (latest.accessExpiresAt && new Date(latest.accessExpiresAt).getTime() > Date.now() + 60_000) return latest;
    if (!latest.refreshToken) throw new Error("Conexão do Mercado Livre sem refresh token.");
    const { id, secret } = credentials();
    const token = await tokenRequest(new URLSearchParams({
      grant_type: "refresh_token",
      client_id: id,
      client_secret: secret,
      refresh_token: latest.refreshToken,
    }));
    return saveIntegration({
      ...latest,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      accessExpiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      scopes: token.scope?.split(/\s+/).filter(Boolean) ?? latest.scopes,
      status: "connected",
    });
  })().finally(() => refreshes.delete(connection.id));

  refreshes.set(connection.id, task);
  return task;
}

async function validConnection(connection: IntegrationConnection): Promise<IntegrationConnection> {
  if (!connection.accessToken || !connection.accessExpiresAt || new Date(connection.accessExpiresAt).getTime() <= Date.now() + 60_000) {
    return refreshConnection(connection);
  }
  return connection;
}

export async function mercadoLivreFetch<T>(connection: IntegrationConnection, resource: string): Promise<T> {
  let current = await validConnection(connection);
  let refreshed = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${resource}`, {
        headers: { Authorization: `Bearer ${current.accessToken}`, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 350 * 2 ** attempt));
        continue;
      }
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error("O Mercado Livre demorou para responder. Tente novamente em instantes.");
      }
      throw error;
    }
    if (response.status === 401 && !refreshed) {
      current = await refreshConnection({ ...current, accessExpiresAt: new Date(0).toISOString() });
      refreshed = true;
      continue;
    }

    const contentType = response.headers.get("content-type") || "";
    const transient = response.status === 429 || response.status >= 500 || !contentType.includes("json");
    if (transient && attempt < 2) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 350 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    const text = await response.text();
    let data: { message?: string; error?: string } & T;
    try {
      data = (text ? JSON.parse(text) : {}) as { message?: string; error?: string } & T;
    } catch {
      throw new Error("O Mercado Livre respondeu temporariamente em um formato inesperado. Tente novamente em instantes.");
    }
    if (!response.ok && response.status !== 206) {
      throw new Error(data.message || data.error || `Mercado Livre respondeu ${response.status}.`);
    }
    return data as T;
  }
  throw new Error("O Mercado Livre está temporariamente indisponível. Tente novamente em instantes.");
}

interface MercadoLivreListingPrice {
  currency_id?: string;
  listing_type_id?: string;
  listing_type_name?: string;
  sale_fee_amount?: number;
  sale_fee_details?: {
    financing_add_on_fee?: number;
    fixed_fee?: number;
    gross_amount?: number;
    percentage_fee?: number;
  };
}

export interface MercadoLivreSaleFee {
  itemId: string;
  currency: string;
  listingTypeId: string;
  listingTypeName: string;
  categoryId: string;
  shippingMode: string | null;
  logisticType: string | null;
  total: number;
  fixed: number;
  percentage: number;
  financing: number;
}

export interface MercadoLivrePublicListing {
  id: string;
  title: string;
  price: number;
  currency: string;
  thumbnail: string | null;
  permalink: string | null;
  categoryId: string;
  listingTypeId: string;
  shippingMode: string | null;
  logisticType: string | null;
  catalogProduct: boolean;
  estimatedSellerShipping: number | null;
}

function mercadoLivreReferenceId(reference: string): { kind: "item" | "product" | "user_product"; id: string } {
  const normalized = decodeURIComponent(reference.trim()).toUpperCase();
  const userProductMatch = normalized.match(/MLBU[-_ ]?(\d{6,})/);
  if (userProductMatch) {
    return {
      kind: "user_product",
      id: `MLBU${userProductMatch[1]}`,
    };
  }
  const match = normalized.match(/MLB[-_ ]?(\d{6,})/);
  if (!match) throw new Error("Não encontrei um código MLB ou MLBU nesse link. Cole a URL completa do anúncio ou o código.");
  return {
    kind: /\/P\/MLB[-_ ]?\d{6,}/.test(normalized) ? "product" : "item",
    id: `MLB${match[1]}`,
  };
}

export async function getMercadoLivrePublicListing(
  connection: IntegrationConnection,
  reference: string
): Promise<MercadoLivrePublicListing> {
  const parsed = mercadoLivreReferenceId(reference);
  let itemId = parsed.id;
  let catalogFallback: MercadoLivrePublicListing | null = null;
  if (parsed.kind === "user_product") {
    let userProduct: {
      id?: string;
      name?: string;
      user_id?: number;
      domain_id?: string;
      pictures?: Array<{ secure_url?: string; url?: string }>;
    };
    try {
      userProduct = await mercadoLivreFetch(connection, `/user-products/${encodeURIComponent(parsed.id)}`);
    } catch (error) {
      throw new Error(`Não foi possível consultar esse produto: ${error instanceof Error ? error.message : "acesso negado"}`);
    }

    catalogFallback = {
      id: parsed.id,
      title: userProduct.name || "Produto do Mercado Livre",
      price: 0,
      currency: "BRL",
      thumbnail: userProduct.pictures?.[0]?.secure_url || userProduct.pictures?.[0]?.url || null,
      permalink: reference.startsWith("http") ? reference : null,
      categoryId: "",
      listingTypeId: "gold_special",
      shippingMode: null,
      logisticType: null,
      catalogProduct: false,
      estimatedSellerShipping: null,
    };

    if (userProduct.domain_id) {
      const categoriesResource = `/catalog_domains/${encodeURIComponent(userProduct.domain_id)}/categories`;
      try {
        const categories = await mercadoLivreFetch<Array<{ id?: string }>>(connection, categoriesResource);
        catalogFallback.categoryId = categories[0]?.id || "";
      } catch {
        try {
          const publicResponse = await fetch(`${API_BASE}${categoriesResource}`, {
            headers: { Accept: "application/json" },
            cache: "no-store",
          });
          if (publicResponse.ok) {
            const categories = await publicResponse.json() as Array<{ id?: string }>;
            catalogFallback.categoryId = categories[0]?.id || "";
          }
        } catch {
          // A publicação vinculada ainda pode fornecer a categoria.
        }
      }
    }

    if (userProduct.user_id) {
      const userProductItemsResource = `/users/${encodeURIComponent(String(userProduct.user_id))}/items/search?user_product_id=${encodeURIComponent(parsed.id)}&limit=50`;
      try {
        const search = await mercadoLivreFetch<{ results?: string[] }>(
          connection,
          userProductItemsResource
        );
        itemId = search.results?.[0] ?? "";
      } catch {
        try {
          const publicResponse = await fetch(`${API_BASE}${userProductItemsResource}`, {
            headers: { Accept: "application/json" },
            cache: "no-store",
          });
          const publicSearch = publicResponse.ok
            ? await publicResponse.json() as { results?: string[] }
            : {};
          itemId = publicSearch.results?.[0] ?? "";
        } catch {
          itemId = "";
        }
      }
    } else {
      itemId = "";
    }

    if (!itemId && userProduct.user_id) {
      type SellerListings = { results?: MercadoLivreItem[] };
      const sellerSearchParams = new URLSearchParams({
        seller_id: String(userProduct.user_id),
        limit: "100",
      });
      if (catalogFallback.categoryId) sellerSearchParams.set("category", catalogFallback.categoryId);
      const sellerSearchResource = `/sites/MLB/search?${sellerSearchParams}`;
      let sellerListings: SellerListings = {};
      try {
        sellerListings = await mercadoLivreFetch<SellerListings>(connection, sellerSearchResource);
      } catch {
        try {
          const publicResponse = await fetch(`${API_BASE}${sellerSearchResource}`, {
            headers: { Accept: "application/json" },
            cache: "no-store",
          });
          if (publicResponse.ok) sellerListings = await publicResponse.json() as SellerListings;
        } catch {
          // O produto continua utilizável como fallback se a busca de listagens estiver indisponível.
        }
      }
      const normalizedTitle = userProduct.name?.trim().toLocaleLowerCase("pt-BR");
      const matchingItem = (sellerListings.results ?? []).find((candidate) =>
        candidate.user_product_id === parsed.id
      ) ?? (sellerListings.results ?? []).find((candidate) =>
        normalizedTitle && candidate.title.trim().toLocaleLowerCase("pt-BR") === normalizedTitle
      );
      if (matchingItem) {
        itemId = matchingItem.id;
        catalogFallback.price = Number(matchingItem.price) || 0;
        catalogFallback.currency = matchingItem.currency_id || "BRL";
        catalogFallback.categoryId = matchingItem.category_id || catalogFallback.categoryId;
        catalogFallback.listingTypeId = matchingItem.listing_type_id || catalogFallback.listingTypeId;
        catalogFallback.shippingMode = matchingItem.shipping?.mode || null;
        catalogFallback.logisticType = matchingItem.shipping?.logistic_type || null;
        catalogFallback.thumbnail = matchingItem.thumbnail || matchingItem.pictures?.[0]?.secure_url
          || matchingItem.pictures?.[0]?.url || catalogFallback.thumbnail;
        catalogFallback.permalink = matchingItem.permalink || catalogFallback.permalink;
      }
    }

    if (!itemId) return catalogFallback;
  }
  if (parsed.kind === "product") {
    let product: {
      name?: string;
      domain_id?: string;
      pictures?: Array<{ secure_url?: string; url?: string }>;
      buy_box_winner?: { item_id?: string } | null;
      buy_box_winner_price_range?: { min_amount?: number; max_amount?: number } | null;
    };
    try {
      product = await mercadoLivreFetch(connection, `/products/${encodeURIComponent(parsed.id)}`);
    } catch (error) {
      throw new Error(`Não foi possível consultar essa página de produto: ${error instanceof Error ? error.message : "acesso negado"}`);
    }
    catalogFallback = {
      id: parsed.id,
      title: product.name || "Produto de catálogo",
      price: Number(product.buy_box_winner_price_range?.min_amount) || 0,
      currency: "BRL",
      thumbnail: product.pictures?.[0]?.secure_url || product.pictures?.[0]?.url || null,
      permalink: reference.startsWith("http") ? reference : null,
      categoryId: "",
      listingTypeId: "gold_special",
      shippingMode: null,
      logisticType: null,
      catalogProduct: true,
      estimatedSellerShipping: null,
    };
    if (product.domain_id) {
      const categoriesResource = `/catalog_domains/${encodeURIComponent(product.domain_id)}/categories`;
      try {
        const categories = await mercadoLivreFetch<Array<{ id?: string }>>(connection, categoriesResource);
        catalogFallback.categoryId = categories[0]?.id || "";
      } catch {
        try {
          const publicResponse = await fetch(`${API_BASE}${categoriesResource}`, {
            headers: { Accept: "application/json" },
            cache: "no-store",
          });
          if (publicResponse.ok) {
            const categories = await publicResponse.json() as Array<{ id?: string }>;
            catalogFallback.categoryId = categories[0]?.id || "";
          }
        } catch {
          // A tarifa geral continua disponível mesmo quando o domínio não expõe a categoria.
        }
      }
    }
    itemId = product.buy_box_winner?.item_id ?? "";
    if (!itemId) {
      type CatalogOffers = { results?: Array<{
        item_id?: string;
        category_id?: string;
        price?: number;
        currency_id?: string;
        listing_type_id?: string;
        available_quantity?: number;
        shipping?: { mode?: string; logistic_type?: string };
      }> };
      let offers: CatalogOffers;
      try {
        offers = await mercadoLivreFetch<CatalogOffers>(connection, `/products/${encodeURIComponent(parsed.id)}/items?limit=100`);
      } catch (authorizedError) {
        try {
          const publicResponse = await fetch(`${API_BASE}/products/${encodeURIComponent(parsed.id)}/items?limit=100`, {
            headers: { Accept: "application/json" },
            cache: "no-store",
          });
          offers = publicResponse.ok ? await publicResponse.json() as CatalogOffers : {};
        } catch {
          void authorizedError;
          offers = {};
        }
      }
      const availableOffers = (offers.results ?? [])
        .filter((offer) => offer.item_id && (offer.available_quantity ?? 1) > 0)
        .sort((left, right) => (Number(left.price) || Number.MAX_SAFE_INTEGER) - (Number(right.price) || Number.MAX_SAFE_INTEGER));
      itemId = availableOffers[0]?.item_id ?? "";
      const referenceOffer = availableOffers[0];
      if (referenceOffer) {
        catalogFallback.price = Number(referenceOffer.price) || catalogFallback.price;
        catalogFallback.currency = referenceOffer.currency_id || catalogFallback.currency;
        catalogFallback.categoryId = referenceOffer.category_id || catalogFallback.categoryId;
        catalogFallback.listingTypeId = referenceOffer.listing_type_id || catalogFallback.listingTypeId;
        catalogFallback.shippingMode = referenceOffer.shipping?.mode || null;
        catalogFallback.logisticType = referenceOffer.shipping?.logistic_type || null;
        const shippingParams = new URLSearchParams({
          item_id: referenceOffer.item_id || "",
          item_price: String(catalogFallback.price),
          listing_type_id: catalogFallback.listingTypeId,
          mode: catalogFallback.shippingMode || "me2",
          condition: "new",
          logistic_type: catalogFallback.logisticType || "drop_off",
          free_shipping: "true",
          verbose: "true",
        });
        try {
          const shippingQuote = await mercadoLivreFetch<{
            coverage?: { all_country?: { list_cost?: number } };
          }>(
            connection,
            `/users/${encodeURIComponent(connection.externalAccountId)}/shipping_options/free?${shippingParams}`
          );
          const listCost = Number(shippingQuote.coverage?.all_country?.list_cost);
          if (Number.isFinite(listCost)) catalogFallback.estimatedSellerShipping = listCost;
        } catch {
          // A simulação continua utilizável com o frete editável quando não houver cotação.
        }
      }
    }
    if (!itemId) {
      return catalogFallback;
    }
  }
  let item: MercadoLivreItem;
  try {
    item = await mercadoLivreFetch<MercadoLivreItem>(connection, `/items/${encodeURIComponent(itemId)}`);
  } catch (error) {
    try {
      const publicResponse = await fetch(`${API_BASE}/items/${encodeURIComponent(itemId)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!publicResponse.ok) throw error;
      item = await publicResponse.json() as MercadoLivreItem;
    } catch {
      if (catalogFallback) return catalogFallback;
      throw error;
    }
  }
  if (!item.category_id || !item.listing_type_id) {
    throw new Error("O anúncio não possui dados suficientes para simular os custos de venda.");
  }
  let currentPrice = item.price;
  try {
    const salePrice = await mercadoLivreFetch<{ amount?: number; currency_id?: string }>(
      connection,
      `/items/${encodeURIComponent(itemId)}/sale_price?context=channel_marketplace`
    );
    if (Number.isFinite(Number(salePrice.amount)) && Number(salePrice.amount) > 0) currentPrice = Number(salePrice.amount);
  } catch {
    // Alguns anúncios não expõem o recurso de preço atual; o detalhe público continua sendo o fallback.
  }
  return {
    id: item.id,
    title: item.title,
    price: currentPrice,
    currency: item.currency_id || "BRL",
    thumbnail: item.pictures?.[0]?.secure_url || item.pictures?.[0]?.url || item.thumbnail || null,
    permalink: item.permalink ?? null,
    categoryId: item.category_id,
    listingTypeId: item.listing_type_id,
    shippingMode: item.shipping?.mode ?? null,
    logisticType: item.shipping?.logistic_type ?? null,
    catalogProduct: false,
    estimatedSellerShipping: null,
  };
}

export async function getMercadoLivreSaleFee(
  connection: IntegrationConnection,
  itemId: string,
  price: number
): Promise<MercadoLivreSaleFee> {
  const item = await mercadoLivreFetch<MercadoLivreItem>(connection, `/items/${encodeURIComponent(itemId)}`);
  if (!item.category_id || !item.listing_type_id) {
    throw new Error("O anúncio não possui categoria ou modalidade de publicação para calcular a tarifa.");
  }
  return getMercadoLivreSaleFeeForContext(connection, {
    itemId: item.id,
    price,
    categoryId: item.category_id,
    listingTypeId: item.listing_type_id,
    currency: item.currency_id || "BRL",
    shippingMode: item.shipping?.mode ?? null,
    logisticType: item.shipping?.logistic_type ?? null,
  });
}

export async function getMercadoLivreSaleFeeForContext(
  connection: IntegrationConnection,
  input: {
    itemId: string;
    price: number;
    categoryId: string;
    listingTypeId: string;
    currency?: string;
    shippingMode?: string | null;
    logisticType?: string | null;
  }
): Promise<MercadoLivreSaleFee> {
  const siteId = String(connection.metadata.siteId || connection.region || "MLB");
  const params = new URLSearchParams({
    price: input.price.toFixed(2),
    currency_id: input.currency || "BRL",
    listing_type_id: input.listingTypeId,
  });
  if (input.categoryId) params.set("category_id", input.categoryId);
  if (input.logisticType) params.set("logistic_type", input.logisticType);
  if (input.shippingMode) params.set("shipping_modes", input.shippingMode);
  const response = await mercadoLivreFetch<MercadoLivreListingPrice | MercadoLivreListingPrice[] | MercadoLivreListingPrice[][]>(
    connection,
    `/sites/${encodeURIComponent(siteId)}/listing_prices?${params}`
  );
  const candidates = (Array.isArray(response) ? response.flat(2) : [response]) as MercadoLivreListingPrice[];
  const fee = candidates.find((entry) => entry.listing_type_id === input.listingTypeId) ?? candidates[0];
  if (!fee || !Number.isFinite(Number(fee.sale_fee_amount))) {
    throw new Error("O Mercado Livre não retornou a tarifa deste anúncio para o preço informado.");
  }
  const details = fee.sale_fee_details ?? {};
  return {
    itemId: input.itemId,
    currency: fee.currency_id || input.currency || "BRL",
    listingTypeId: fee.listing_type_id || input.listingTypeId,
    listingTypeName: fee.listing_type_name || input.listingTypeId,
    categoryId: input.categoryId,
    shippingMode: input.shippingMode ?? null,
    logisticType: input.logisticType ?? null,
    total: Number(fee.sale_fee_amount) || 0,
    fixed: Number(details.fixed_fee) || 0,
    percentage: Number(details.percentage_fee) || 0,
    financing: Number(details.financing_add_on_fee) || 0,
  };
}

async function getShipmentCosts(
  connection: IntegrationConnection,
  shipmentIds: string[]
): Promise<Map<string, MercadoLivreShipmentCosts | null>> {
  const result = new Map<string, MercadoLivreShipmentCosts | null>();
  for (let index = 0; index < shipmentIds.length; index += 20) {
    const batch = shipmentIds.slice(index, index + 20);
    const responses = await Promise.all(batch.map(async (shipmentId) => {
      try {
        const costs = await mercadoLivreFetch<MercadoLivreShipmentCosts>(
          connection,
          `/shipments/${encodeURIComponent(shipmentId)}/costs`
        );
        return [shipmentId, costs] as const;
      } catch {
        return [shipmentId, null] as const;
      }
    }));
    for (const [shipmentId, costs] of responses) result.set(shipmentId, costs);
  }
  return result;
}

export interface MercadoLivrePeriod {
  from: Date;
  to: Date;
  label: string;
}

export interface MercadoLivreOverviewSource {
  user: MercadoLivreUser;
  productsData: Awaited<ReturnType<typeof getMercadoLivreProducts>>;
  orders: MercadoLivreOrder[];
  totalOrders: number;
  ordersComplete: boolean;
  shipmentCosts: Map<string, MercadoLivreShipmentCosts | null>;
}

export async function getMercadoLivreOverview(
  connection: IntegrationConnection,
  period?: MercadoLivrePeriod,
  source?: MercadoLivreOverviewSource
) {
  const accountId = encodeURIComponent(connection.externalAccountId);
  const to = period?.to ?? new Date();
  const from = period?.from ?? new Date(to.getTime() - 30 * 86_400_000);
  const fetchOrderPage = (rangeFrom: Date, rangeTo: Date, offset: number, limit: number) =>
    mercadoLivreFetch<{ paging?: { total?: number }; results?: MercadoLivreOrder[] }>(
      connection,
      `/orders/search?seller=${accountId}&order.date_created.from=${encodeURIComponent(rangeFrom.toISOString())}&order.date_created.to=${encodeURIComponent(rangeTo.toISOString())}&sort=date_desc&limit=${limit}&offset=${offset}`
    );
  const [user, productsData, collectedOrders] = source
    ? [
        source.user,
        source.productsData,
        { orders: source.orders, total: source.totalOrders, complete: source.ordersComplete },
      ] as const
    : await Promise.all([
        mercadoLivreFetch<MercadoLivreUser>(connection, "/users/me"),
        getMercadoLivreProducts(connection),
        collectMercadoLivreOrders({ from, to, fetchPage: fetchOrderPage }),
      ]);
  const totalOrders = collectedOrders.total;
  const orders = collectedOrders.orders.sort((a, b) => b.date_created.localeCompare(a.date_created));
  const paidOrders = orders.filter((order) => order.status === "paid");
  const detailedPaidOrders = paidOrders.slice(0, 1_000);
  const shipmentIds = [...new Set(detailedPaidOrders
    .map((order) => order.shipping?.id == null ? null : String(order.shipping.id))
    .filter((shipmentId): shipmentId is string => shipmentId !== null))];
  const shipmentCosts = source?.shipmentCosts ?? await getShipmentCosts(connection, shipmentIds);
  const costs = await getCosts();
  if (source) {
    for (const product of productsData.products) {
      const entry = mercadoLivreCostEntry(costs, connection.id, product.id, product.sku);
      product.cost = entry?.cost && entry.cost > 0 ? entry.cost : null;
    }
  }
  const taxRate = mercadoLivreTaxRate(connection);
  let fees = 0;
  let cogs = 0;
  let sellerShipping = 0;
  let buyerShipping = 0;
  let unitsWithoutCost = 0;
  const productTotals = new Map<string, { id: string; sku: string | null; title: string; units: number; revenue: number; processedRevenue: number; cost: number; contribution: number; calculationsComplete: boolean }>();
  const unitsByItem = new Map<string, number>();
  const profitabilityLines: ProfitabilityLine[] = [];

  for (const order of paidOrders) {
    for (const line of order.order_items) {
      const productKey = line.item.seller_sku || line.item.id;
      const current = productTotals.get(productKey) ?? { id: line.item.id, sku: line.item.seller_sku ?? null, title: line.item.title, units: 0, revenue: 0, processedRevenue: 0, cost: 0, contribution: 0, calculationsComplete: true };
      current.units += line.quantity;
      current.revenue += line.unit_price * line.quantity;
      productTotals.set(productKey, current);
      unitsByItem.set(line.item.id, (unitsByItem.get(line.item.id) ?? 0) + line.quantity);
    }
  }

  type LineReference = { key: string; order: MercadoLivreOrder; line: MercadoLivreOrder["order_items"][number]; revenue: number; shipmentId: string | null };
  const lineReferences: LineReference[] = detailedPaidOrders.flatMap((order) => order.order_items.map((line, index) => ({
    key: `${order.id}:${line.item.id}:${index}`,
    order,
    line,
    revenue: line.unit_price * line.quantity,
    shipmentId: order.shipping?.id == null ? null : String(order.shipping.id),
  })));
  const sellerShippingByLine = new Map<string, number | null>();
  const buyerShippingByLine = new Map<string, number | null>();
  const linesByShipment = new Map<string, LineReference[]>();
  for (const reference of lineReferences) {
    if (!reference.shipmentId) {
      sellerShippingByLine.set(reference.key, 0);
      buyerShippingByLine.set(reference.key, 0);
      continue;
    }
    const group = linesByShipment.get(reference.shipmentId) ?? [];
    group.push(reference);
    linesByShipment.set(reference.shipmentId, group);
  }
  for (const [shipmentId, references] of linesByShipment) {
    const shipment = shipmentCosts.get(shipmentId);
    if (!shipment) {
      for (const reference of references) {
        sellerShippingByLine.set(reference.key, null);
        buyerShippingByLine.set(reference.key, null);
      }
      continue;
    }
    const accountSender = shipment.senders?.find((sender) => String(sender.user_id) === connection.externalAccountId);
    const sellerCost = Number(accountSender?.cost ?? shipment.senders?.reduce((sum, sender) => sum + Number(sender.cost ?? 0), 0) ?? 0);
    const buyerCost = Number(shipment.receiver?.cost ?? 0);
    const weights = references.map((reference) => reference.revenue);
    const sellerShares = allocateByWeight(sellerCost, weights);
    const buyerShares = allocateByWeight(buyerCost, weights);
    references.forEach((reference, index) => {
      sellerShippingByLine.set(reference.key, sellerShares[index]);
      buyerShippingByLine.set(reference.key, buyerShares[index]);
    });
    sellerShipping += sellerCost;
    buyerShipping += buyerCost;
  }

  for (const reference of lineReferences) {
      const { order, line } = reference;
      const productKey = line.item.seller_sku || line.item.id;
      const entry = mercadoLivreCostEntry(costs, connection.id, line.item.id, line.item.seller_sku);
      const unitCost = entry ? costAt(entry, order.date_created) : 0;
      const lineFees = (line.sale_fee ?? 0) * line.quantity;
      const lineRevenue = line.unit_price * line.quantity;
      const lineTax = lineRevenue * taxRate / 100;
      const lineProductCost = unitCost > 0 ? unitCost * line.quantity : null;
      const lineSellerShipping = sellerShippingByLine.get(reference.key) ?? null;
      const lineBuyerShipping = buyerShippingByLine.get(reference.key) ?? null;
      const shippingComplete = lineSellerShipping != null && lineBuyerShipping != null;
      const lineResult = shippingComplete
        ? calculateContribution({ revenue: lineRevenue, productCost: lineProductCost, marketplaceFees: line.sale_fee == null ? null : lineFees, sellerShipping: lineSellerShipping, tax: lineTax })
        : { contribution: null, marginPct: null, complete: false };
      fees += lineFees;
      if (unitCost > 0) cogs += unitCost * line.quantity;
      else unitsWithoutCost += line.quantity;
      const current = productTotals.get(productKey) ?? { id: line.item.id, sku: line.item.seller_sku ?? null, title: line.item.title, units: line.quantity, revenue: lineRevenue, processedRevenue: 0, cost: 0, contribution: 0, calculationsComplete: true };
      current.processedRevenue += lineRevenue;
      current.cost += unitCost * line.quantity;
      current.contribution += lineResult.contribution ?? 0;
      current.calculationsComplete = current.calculationsComplete && lineResult.complete;
      productTotals.set(productKey, current);
      profitabilityLines.push({
        id: reference.key,
        orderId: String(order.id),
        product: line.item.title,
        sku: line.item.seller_sku ?? null,
        date: order.date_created,
        status: order.status,
        fulfillment: order.tags?.includes("fulfilled") ? "Full" : null,
        unitPrice: line.unit_price,
        quantity: line.quantity,
        revenue: lineRevenue,
        currency: order.currency_id,
        productCost: lineProductCost,
        marketplaceFees: line.sale_fee == null ? null : lineFees,
        buyerShipping: lineBuyerShipping,
        buyerShippingIsRevenue: false,
        sellerShipping: lineSellerShipping,
        netReceived: lineSellerShipping != null && line.sale_fee != null ? +(lineRevenue - lineFees - lineSellerShipping).toFixed(2) : null,
        tax: lineTax,
        contribution: lineResult.contribution,
        marginPct: lineResult.marginPct,
        complete: lineResult.complete,
      });
  }
  const revenue = paidOrders.reduce((total, order) => total + (order.total_amount || 0), 0);
  const processedRevenue = detailedPaidOrders.reduce((total, order) => total + (order.total_amount || 0), 0);
  const taxes = processedRevenue * taxRate / 100;
  sellerShipping = +sellerShipping.toFixed(2);
  buyerShipping = +buyerShipping.toFixed(2);
  const estimatedProfit = processedRevenue - fees - cogs - taxes - sellerShipping;
  const daily = new Map<string, { date: string; revenue: number; orders: number; units: number }>();
  for (const order of paidOrders) {
    const date = brazilDateKey(order.date_created);
    const point = daily.get(date) ?? { date, revenue: 0, orders: 0, units: 0 };
    point.revenue += order.total_amount || 0;
    point.orders += 1;
    point.units += order.order_items.reduce((total, item) => total + item.quantity, 0);
    daily.set(date, point);
  }
  const dailySales: Array<{ date: string; revenue: number; orders: number; units: number }> = [];
  const cursor = new Date(`${brazilDateKey(from)}T12:00:00Z`);
  const lastDate = brazilDateKey(to);
  while (cursor.toISOString().slice(0, 10) <= lastDate) {
    const date = cursor.toISOString().slice(0, 10);
    dailySales.push(daily.get(date) ?? { date, revenue: 0, orders: 0, units: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const periodDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
  const stockRadar = productsData.products.filter((product) => product.status === "active" || product.status === "paused").map((product) => {
    const unitsSold = unitsByItem.get(product.id) ?? 0;
    const listingStart = product.activeSince ? new Date(product.activeSince).getTime() : Number.NaN;
    const effectiveStart = Number.isFinite(listingStart) ? Math.max(from.getTime(), listingStart) : from.getTime();
    const calculationDays = Math.max(1, Math.min(periodDays, Math.ceil((to.getTime() - effectiveStart) / 86_400_000)));
    const perDay = unitsSold / calculationDays;
    const daysRemaining = perDay > 0 ? Math.floor(product.availableQuantity / perDay) : null;
    const status = product.availableQuantity <= 0 ? "out" : daysRemaining != null && daysRemaining <= 10 ? "critical" : "ok";
    return { id: product.id, sku: product.sku, title: product.title, availableQuantity: product.availableQuantity, unitsSold, calculationDays, daysRemaining, status };
  }).sort((a, b) => {
    const rank = (status: string) => status === "out" ? 0 : status === "critical" ? 1 : 2;
    return rank(a.status) - rank(b.status) || (a.daysRemaining ?? Infinity) - (b.daysRemaining ?? Infinity);
  });
  return {
    account: { id: String(user.id), nickname: user.nickname, siteId: user.site_id ?? connection.region ?? "MLB" },
    period: {
      from: from.toISOString(),
      to: to.toISOString(),
      label: period?.label ?? "Últimos 30 dias",
    },
    metrics: {
      activeListings: productsData.activeTotal,
      productsWithoutCost: productsData.products.filter((product) => product.cost == null || product.cost <= 0).length,
      orders30d: totalOrders,
      paidOrders: paidOrders.length,
      revenue30d: revenue,
      currency: orders[0]?.currency_id ?? "BRL",
      revenueCoverage: { capturedOrders: orders.length, totalOrders, complete: collectedOrders.complete },
    },
    profit: {
      fees,
      cogs,
      taxes,
      taxRate,
      sellerShipping,
      buyerShipping,
      shippingCostsComplete: collectedOrders.complete && shipmentCosts.size === shipmentIds.length && [...shipmentCosts.values()].every(Boolean),
      revenueProcessed: processedRevenue,
      coverage: { processedOrders: detailedPaidOrders.length, paidOrders: paidOrders.length, complete: collectedOrders.complete && detailedPaidOrders.length >= paidOrders.length },
      estimatedProfit,
      marginPct: processedRevenue > 0 ? estimatedProfit / processedRevenue * 100 : 0,
      unitsWithoutCost,
    },
    dailySales,
    stockRadar,
    topProducts: [...productTotals.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8)
      .map((product) => {
        const complete = product.calculationsComplete && Math.abs(product.processedRevenue - product.revenue) < 0.01;
        return {
          id: product.id,
          sku: product.sku,
          title: product.title,
          units: product.units,
          revenue: product.revenue,
          cost: product.cost,
          contribution: product.contribution,
          complete,
          marginPct: complete && product.revenue > 0
            ? product.contribution / product.revenue * 100
            : null,
        };
      }),
    profitabilityLines,
    recentOrders: orders.slice(0, 10).map((order) => ({
      id: String(order.id),
      packId: order.pack_id ? String(order.pack_id) : null,
      status: order.status,
      createdAt: order.date_created,
      total: order.total_amount,
      currency: order.currency_id,
      items: order.order_items.reduce((total, item) => total + item.quantity, 0),
    })),
  };
}
