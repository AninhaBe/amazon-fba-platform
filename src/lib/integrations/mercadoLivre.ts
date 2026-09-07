import crypto from "crypto";
import { getIntegration, saveIntegration } from "./integrationStore";
import type { IntegrationConnection } from "./types";
import { costAt, getCosts } from "../costStore";
import { allocateByWeight, calculateContribution, type ProfitabilityLine } from "../profitability";
import { collectMercadoLivreOrders } from "./mercadoLivreOrders";
import { classificarCobertura, ORDEM_DO_RADAR, type StockStatus } from "../coberturaDeEstoque";
import { ChannelAuthExpiredError } from "./authErrors";
import { calcularSaldoML, type PagamentoMP, type SaldoMercadoLivre } from "./mercadoPagoBalance";
import { auditarFrete, type FreteEsperado, type PagamentoAuditoria, type ResultadoAuditoria } from "./mercadoLivreAuditoria";
import { dbQuery } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { registrarChamada } from "./contadorDeChamadas";
import { tacosDoPeriodo } from "./tacosDoCanal";

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
  // ⚠️ Mesma trava da Shopee (ADR-029): a varredura de resgate fica DENTRO do
  // sub-namespace `sku:`. Aceitar entrada de `item:` aqui faria a variação
  // herdar o custo do anúncio sem confirmação — a porta lateral que anularia a
  // decisão de "sugestão a confirmar". O ML ainda não expande variações, mas a
  // trava entra junto para as duas não divergirem.
  return Object.values(costs).find((entry) => entry.sku === sku && entry.id.startsWith(`mercado_livre:${connectionId}:sku:`));
}

/**
 * Alíquota declarada pela vendedora. **`null` = não configurada**, que NÃO é o
 * mesmo que 0%.
 *
 * Antes: `Number(metadata.taxRate ?? 0)`. Quem nunca configurou era tratado como
 * isento, o painel exibia "Imposto R$ 0,00" e o lucro parecia líquido de tudo —
 * "não sei" virando um fato falso, a confusão entre `null` e zero que o projeto
 * proíbe. Mesmo defeito corrigido na Amazon em 15/08/2026.
 *
 * A aritmética a jusante segue somando `?? 0` de propósito: sem alíquota o lucro
 * continua saindo sem imposto, como sempre saiu. O que muda é a tela DIZER isso
 * em vez de afirmar zero.
 */
export function mercadoLivreTaxRate(connection: IntegrationConnection): number | null {
  const bruto = connection.metadata.taxRate;
  if (bruto == null || bruto === "") return null;
  const value = Number(bruto);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
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
  const PAGE = 100; // limite por página do ML (offset)
  const OFFSET_CEIL = 1000; // teto do offset no ML — acima disso exigiria search_type=scan
  // 1ª página (com o total) + contagem de ativos.
  const [first, activeSearch] = await Promise.all([
    mercadoLivreFetch<{ paging?: { total?: number }; results?: string[] }>(connection, `/users/${accountId}/items/search?limit=${PAGE}&offset=0`),
    mercadoLivreFetch<{ paging?: { total?: number } }>(connection, `/users/${accountId}/items/search?status=active&limit=1`),
  ]);
  const total = first.paging?.total ?? (first.results?.length ?? 0);
  const ids = [...(first.results ?? [])];
  // Demais páginas em paralelo, até o total (ou o teto de 1000 do offset).
  const cap = Math.min(total, OFFSET_CEIL);
  const morePages = await Promise.all(
    Array.from({ length: Math.max(0, Math.ceil(cap / PAGE) - 1) }, (_, index) =>
      mercadoLivreFetch<{ results?: string[] }>(connection, `/users/${accountId}/items/search?limit=${PAGE}&offset=${(index + 1) * PAGE}`)
    )
  );
  for (const page of morePages) ids.push(...(page.results ?? []));
  // Detalhes dos itens em lotes de 20 (multiget).
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
    let token;
    try {
      token = await tokenRequest(new URLSearchParams({
        grant_type: "refresh_token",
        client_id: id,
        client_secret: secret,
        refresh_token: latest.refreshToken,
      }));
    } catch (error) {
      // Refresh recusado = autorização revogada/expirada. Persistir esse estado
      // é o que permite a UI oferecer "reconectar" em vez de um erro genérico.
      await saveIntegration({ ...latest, status: "disconnected" }).catch(() => {});
      throw new ChannelAuthExpiredError(
        "A conexão com o Mercado Livre expirou. Reconecte a conta para voltar a sincronizar.",
        error
      );
    }
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

/**
 * `extras` existe para a API de Product Ads (PADS), que EXIGE cabeçalho de
 * versão e usa grafias diferentes por rota: `Api-Version: 1` em
 * `/advertising/advertisers` e `api-version: 2` no resto. Sem ele, a resposta é
 * 404 — medido pelo Delta em 28/08/2026. Nenhuma chamada existente muda.
 */
/**
 * Agrupa o recurso pelo FORMATO, nao pelo valor: `/orders/123` e `/orders/456`
 * viram `/orders/:id`. Sem isso o contador criaria uma linha por pedido e
 * responderia "quantas vezes chamei ESTE pedido" em vez de "quantas vezes
 * chamei este endpoint" — que e a pergunta de um alerta de plataforma.
 */
function caminhoDoRecurso(resource: string): string {
  return resource.split("?")[0].replace(/\/\d[\w-]*/g, "/:id");
}

export async function mercadoLivreFetch<T>(
  connection: IntegrationConnection,
  resource: string,
  extras?: Record<string, string>,
): Promise<T> {
  let current = await validConnection(connection);
  let refreshed = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${resource}`, {
        headers: { Authorization: `Bearer ${current.accessToken}`, Accept: "application/json", ...extras },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      // Conta CADA tentativa, que e o que o canal ve. Ver contadorDeChamadas.ts.
      registrarChamada("mercado_livre", caminhoDoRecurso(resource), {
        status: response.status,
        limite: response.headers.get("x-ratelimit-remaining"),
        erro: !response.ok,
        connectionId: current.id,
      });
    } catch (error) {
      registrarChamada("mercado_livre", caminhoDoRecurso(resource), { status: null, erro: true, connectionId: current.id });
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
      // Só resolve para a PRÓPRIA conta — o ML restringe listar itens de outro
      // vendedor. O acesso anônimo também está bloqueado, então não existe
      // retry público que ajude aqui.
      try {
        const search = await mercadoLivreFetch<{ results?: string[] }>(
          connection,
          `/users/${encodeURIComponent(String(userProduct.user_id))}/items/search?user_product_id=${encodeURIComponent(parsed.id)}&limit=50`
        );
        itemId = search.results?.[0] ?? "";
      } catch {
        itemId = "";
      }
    } else {
      itemId = "";
    }

    // Sem fallback para descobrir o anúncio de terceiro: o ML restringe listar
    // itens de outro vendedor ("Searching another user items is restricted") e
    // fechou /sites/{site}/search — 403 forbidden em TODAS as variantes (q,
    // category, seller_id), inclusive sem token (bloqueio do PolicyAgent).
    // Para produto de catálogo de outro vendedor devolvemos o que dá para
    // saber (título, foto e categoria pelo domínio) com o preço em branco; a
    // calculadora deixa o campo de preço editável para o usuário preencher.
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

/**
 * O que a lista de rentabilidade mostra: o teto de detalhamento do canônico
 * corta a LISTA, nunca os agregados — quando corta, a tela precisa dizer
 * (mesma frase da referência Amazon do monitor).
 */
export interface MercadoLivreProfitabilityScope {
  detailedOrders: number;
  completePeriod: boolean;
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
  // Padrão: dia-calendário em São Paulo (00:00 de 30 dias atrás), como o painel do ML.
  const from = period?.from
    ?? new Date(`${new Date(to.getTime() - 3 * 60 * 60_000 - 30 * 86_400_000).toISOString().slice(0, 10)}T00:00:00-03:00`);
  const fetchOrderPage = (rangeFrom: Date, rangeTo: Date, offset: number, limit: number) =>
    mercadoLivreFetch<{ paging?: { total?: number }; results?: MercadoLivreOrder[] }>(
      connection,
      // date_asc: paginação por offset estável (ver mercadoLivreSync.ts).
      `/orders/search?seller=${accountId}&order.date_created.from=${encodeURIComponent(rangeFrom.toISOString())}&order.date_created.to=${encodeURIComponent(rangeTo.toISOString())}&sort=date_asc&limit=${limit}&offset=${offset}`
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
  // SKU e a unidade de ACAO (ver oQueFaltaNoResultado.ts).
  const skusSemCusto = new Set<string>();
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
      // `null` sem alíquota: a linha some do detalhe em vez de exibir
      // "Impostos R$ 0,00", que afirmaria isenção.
      const lineTax = taxRate == null ? 0 : lineRevenue * taxRate / 100; // ADR-038
      const lineProductCost = unitCost > 0 ? unitCost * line.quantity : null;
      const lineSellerShipping = sellerShippingByLine.get(reference.key) ?? null;
      const lineBuyerShipping = buyerShippingByLine.get(reference.key) ?? null;
      const shippingComplete = lineSellerShipping != null && lineBuyerShipping != null;
      const lineResult = shippingComplete
        ? calculateContribution({ revenue: lineRevenue, productCost: lineProductCost, marketplaceFees: line.sale_fee == null ? null : lineFees, sellerShipping: lineSellerShipping, tax: lineTax })
        : { contribution: null, marginPct: null, complete: false };
      fees += lineFees;
      if (unitCost > 0) cogs += unitCost * line.quantity;
      else { unitsWithoutCost += line.quantity; skusSemCusto.add(String(line.item.seller_sku ?? line.item.id)); }
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
  const taxes = taxRate == null ? 0 : processedRevenue * taxRate / 100; // ADR-038
  sellerShipping = +sellerShipping.toFixed(2);
  buyerShipping = +buyerShipping.toFixed(2);
  // `taxes ?? 0`: sem alíquota o lucro sai sem imposto, exatamente como saía
  // antes. Quem avisa é a tela — mudar o número aqui seria alterar o resultado
  // exibido sem a vendedora ter pedido.
  // ⚠️ O ANÚNCIO NÃO ENTRA NO LUCRO DO MERCADO LIVRE — e já entrou, por algumas
  // horas em 30/08/2026. Removido no mesmo dia, por DOIS motivos independentes,
  // cada um suficiente sozinho:
  //
  // 1) DECISÃO DA VENDEDORA: *"nem era pra puxar ads. O ads o seller desconta
  //    depois no mercado livre, quando fizer seu próprio fechamento."* No ML a
  //    conciliação do anúncio é dela, por fora — descontar aqui subtrai duas
  //    vezes. Ver a regra POR CANAL em `financialMath.ts`.
  //
  // 2) O NÚMERO NÃO ERA DEFENSÁVEL: o console de Ads do ML mostrava R$ 44 de
  //    investimento e 71 cliques em 30/08; nós tínhamos gravado R$ 768,86 e
  //    1.228 cliques no mesmo dia. Deixar na tela um desconto que a gente não
  //    consegue explicar é pior que não ter o desconto.
  //
  // A causa da divergência está sendo investigada em `mercadoLivreAdsScheduler.ts`
  // (a janela pedida ao PADS é de 7 dias e o resultado é carimbado como UM dia).
  // A coleta continua rodando — o dado segue sendo gravado e a aba de Anúncios
  // continua lendo. O que saiu daqui é o LUCRO.
  const estimatedProfit = processedRevenue - fees - cogs - (taxes ?? 0) - sellerShipping;
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
    // Mesma regra da Amazon, do mesmo lugar — ver `classificarCobertura`.
    const status = classificarCobertura({ disponivel: product.availableQuantity, porDia: unitsSold / calculationDays, diasRestantes: daysRemaining });
    return { id: product.id, sku: product.sku, title: product.title, availableQuantity: product.availableQuantity, unitsSold, calculationDays, daysRemaining, status };
  }).sort((a, b) => {
    const rank = (status: StockStatus) => ORDEM_DO_RADAR[status];
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
      approvedRevenue: revenue,
      cancelledRevenue: 0,
      cancelledOrders: 0,
      // Caminho AO VIVO: dá para contar o que não foi aprovado, mas o valor
      // desses pedidos não é somado aqui. `null` e não `0` — a legenda mostra a
      // quantidade e omite o valor em vez de afirmar que vale zero.
      pendingOrders: Math.max(0, totalOrders - paidOrders.length),
      pendingRevenue: null as number | null,
      lastSaleAt: paidOrders[0]?.date_created ? new Date(paidOrders[0].date_created).toISOString() : null,
      currency: orders[0]?.currency_id ?? "BRL",
      // `sincronizadoAte`/`historicoDesde` existem para a tela explicar a
      // cobertura em DATAS. Este builder é o caminho AO VIVO (sem canônico), que
      // não tem janela de sync registrada — daí `null`, e a tela cai na frase
      // genérica em vez de inventar um horário.
      revenueCoverage: {
        capturedOrders: orders.length,
        totalOrders,
        complete: collectedOrders.complete,
        sincronizadoAte: null as string | null,
        historicoDesde: null as string | null,
      },
    },
    profit: {
      fees,
      cogs,
      taxes,
      taxRate,
      /**
       * ⚠️ O RASTRO DA EXCECAO (ADR-038). `false` = zero porque ninguem
       * cadastrou aliquota; `true` = zero porque ela declarou 0%. As duas
       * contas sao IDENTICAS, e este booleano e a unica diferenca — a tela nao
       * pode derivar a pendencia de `taxRate == null`, que se apaga sozinho no
       * dia em que alguem cadastrar 0 de verdade.
       */
      taxRateKnown: taxRate != null,
      sellerShipping,
      buyerShipping,
      shippingCostsComplete: collectedOrders.complete && shipmentCosts.size === shipmentIds.length && [...shipmentCosts.values()].every(Boolean),
      revenueProcessed: processedRevenue,
      // ⚠️ AS FATIAS DO PAINEL, NO UNIVERSO QUE ELE DECLARA — [ADR-028].
      //
      // Este caminho ja era coerente: aqui o lucro e a margem sempre sairam da
      // receita processada, que e o proprio centro do painel. A composicao
      // existe para que a tela leia UM lugar em vez de remontar a conta, e para
      // que os dois caminhos (este e o canonico) exponham o MESMO contrato —
      // duas copias da conta e como uma fica para tras, que e o defeito que a
      // ADR-025 nasceu para matar.
      composicaoDaReceitaPaga: {
        receita: processedRevenue,
        fees,
        sellerShipping,
        cogs,
        taxes,
        lucro: +(processedRevenue - fees - sellerShipping - cogs - (taxes ?? 0)).toFixed(2),
        margemPct: processedRevenue > 0
          ? +(((processedRevenue - fees - sellerShipping - cogs - (taxes ?? 0)) / processedRevenue) * 100).toFixed(2)
          : null,
      },
      coverage: { processedOrders: detailedPaidOrders.length, paidOrders: paidOrders.length, complete: collectedOrders.complete && detailedPaidOrders.length >= paidOrders.length },
      estimatedProfit,
      // `ads: null` = "este canal não desconta anúncio", não "não sei quanto foi".
      // O gasto existe e a aba de Anúncios o mostra; ele só não entra no lucro.
      ads: null,
      adsDesconhecido: false,
      adsAteDia: null,
      // ⚠️ O caminho AO VIVO nao coleta anuncio — entao o gasto e DESCONHECIDO,
      // nao zero. O TACOS de verdade sai do produtor canonico, que le
      // `workspace_ad_product_metrics`. Aqui o campo existe para o tipo ser um
      // so; devolver 0 afirmaria que a conta nao anuncia.
      tacos: tacosDoPeriodo({ gasto: null, faturamento: null }),
      tacosAteDia: null as string | null,
      marginPct: processedRevenue > 0 ? estimatedProfit / processedRevenue * 100 : null,
      // ⚠️ ESTE CAMINHO NÃO TEM A BASE DO FATURAMENTO, E ISSO É DECLARADO EM VEZ
      // DE FINGIDO (01/09/2026).
      //
      // O canônico passou a calcular lucro e margem sobre o FATURAMENTO (todo
      // pedido não cancelado, pendente inclusive), pela decisão dela. Este
      // caminho legado lê a API ao vivo e só enxerga o conjunto que coletou — ele
      // não consegue produzir aquela base sem uma varredura que a tela não pode
      // pagar (é justamente o custo que o canônico existe para evitar).
      //
      // `null` aqui é a resposta honesta: a tela cai no comportamento anterior
      // (margem sobre o apurado, com a base declarada) em vez de receber um
      // número com o nome errado. Preencher com o apurado afirmaria que as bases
      // coincidem quando elas não coincidem — a mentira que passamos dois dias
      // tirando da tela.
      revenueDoLucro: null as number | null,
      pedidosSemApuracao: null as number | null,
      unitsWithoutCost,
      skusWithoutCost: skusSemCusto.size,
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
    // O caminho legado monta as linhas do que buscou ao vivo e não conhece o
    // teto de detalhamento do canônico; null = sem frase de escopo na tela.
    profitabilityScope: null as MercadoLivreProfitabilityScope | null,
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

// ---------- Mercado Pago: saldo e liberação ----------
// A API do MP abre com o MESMO token do ML (medido em 15/08/2026); muda só o
// host. É a única fonte de `money_release_date` e do líquido real — a API de
// pedidos do ML não expõe nenhum dos dois.

const MP_API_BASE = "https://api.mercadopago.com";

/** Teto de páginas por leitura. A conta 1191100170 tem 3.233 pagamentos com
 * liberação futura; ler tudo levaria ~40s e é o tipo de trabalho que já derrubou
 * o container. Lemos as liberações MAIS PRÓXIMAS (a busca vem ordenada por data
 * de liberação) e a tela declara que o total é parcial. */
const MP_PAGINAS = 6;
const MP_POR_PAGINA = 100;

interface MercadoPagoBusca {
  paging?: { total?: number };
  results?: PagamentoMP[];
}

async function mercadoPagoFetch<T>(connection: IntegrationConnection, resource: string): Promise<T> {
  const current = await validConnection(connection);
  const response = await fetch(`${MP_API_BASE}${resource}`, {
    headers: { Authorization: `Bearer ${current.accessToken}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Mercado Pago respondeu ${response.status} em ${resource.split("?")[0]}.`);
  }
  return await response.json() as T;
}

/**
 * Saldo e cronograma de liberação. Busca só o que ainda vai liberar
 * (`range=money_release_date` a partir de agora), o que reduziu 15.828 → 3.233
 * pagamentos na conta com mais volume.
 */
export async function getMercadoLivreBalance(
  connection: IntegrationConnection,
  now = new Date()
): Promise<SaldoMercadoLivre> {
  const de = new Date(now.getTime() - 24 * 3_600_000); // margem: liberações de hoje
  const ate = new Date(now.getTime() + 180 * 86_400_000);
  const pagamentos: Array<PagamentoMP & { external_reference?: string }> = [];
  let total = 0;

  for (let pagina = 0; pagina < MP_PAGINAS; pagina++) {
    const busca = await mercadoPagoFetch<MercadoPagoBusca>(
      connection,
      `/v1/payments/search?sort=money_release_date&criteria=asc&range=money_release_date`
      + `&begin_date=${encodeURIComponent(de.toISOString())}&end_date=${encodeURIComponent(ate.toISOString())}`
      + `&status=approved&limit=${MP_POR_PAGINA}&offset=${pagina * MP_POR_PAGINA}`
    );
    const itens = busca.results ?? [];
    total = busca.paging?.total ?? total;
    pagamentos.push(...itens);
    if (itens.length < MP_POR_PAGINA) break;
  }

  // O líquido exige a parte do VENDEDOR no frete, que só o envio informa —
  // `shp_fulfillment` do pagamento é o frete cheio e não serve (ver
  // `mercadoPagoBalance.ts`).
  const ids = [...new Set(pagamentos.map((p) => p.external_reference).filter((v): v is string => !!v))];
  const fretes = new Map((await freteEsperadoPorPedido(connection, ids)).map((f) => [f.orderId, f.custoVendedor]));
  const comFrete = pagamentos.map((p) => ({
    ...p,
    freteDoVendedor: fretes.get(p.external_reference ?? "") ?? null,
  }));

  return calcularSaldoML(comFrete, { agora: now, totalDaBusca: total });
}

// ---------- Pedidos a revisar (auditoria de frete) ----------
// Cruza o frete que o shipment do ML declara com o que o Mercado Pago descontou.
// Ver `mercadoLivreAuditoria.ts` para o caso real que originou isto e para a
// regra de produto (divergência é candidata a revisão, não erro provado).

const MP_AUDITORIA_PAGINAS = 5;

interface PagamentoBrutoMP {
  id?: number | string;
  status?: string;
  external_reference?: string | null;
  transaction_amount?: number | null;
  date_approved?: string | null;
  transaction_details?: { net_received_amount?: number | null } | null;
  charges_details?: Array<{ type?: string; name?: string; amounts?: { original?: number | null } | null }>;
}

/**
 * Frete esperado por pedido, direto do payload do shipment já sincronizado.
 * O `senders[]` do vendedor é identificado por `user_id` — em envio com mais de
 * um remetente, pegar o primeiro daria o custo de outra pessoa.
 */
async function freteEsperadoPorPedido(
  connection: IntegrationConnection,
  orderIds: readonly string[]
): Promise<FreteEsperado[]> {
  if (orderIds.length === 0) return [];
  const rows = await dbQuery<{
    external_order_id: string; shipment_id: string | null;
    custo: string | null; custo_comprador: string | null; cheio: string | null;
  }>(
    `SELECT o.external_order_id,
            s.external_shipment_id AS shipment_id,
            (SELECT sender->>'cost' FROM jsonb_array_elements(s.payload->'senders') sender
              WHERE sender->>'user_id' = $3 LIMIT 1) AS custo,
            s.payload->'receiver'->>'cost' AS custo_comprador,
            s.payload->>'gross_amount' AS cheio
       FROM workspace_marketplace_orders o
       JOIN workspace_marketplace_shipments s
         ON s.workspace_id = o.workspace_id
        AND s.external_shipment_id = (o.payload#>>'{shipping,id}')
      WHERE o.workspace_id = $1 AND o.external_order_id = ANY($2::text[])`,
    [currentWorkspaceId(), [...orderIds], connection.externalAccountId]
  );
  const saida: FreteEsperado[] = [];
  for (const row of rows) {
    const custo = Number(row.custo);
    if (!Number.isFinite(custo)) continue; // sem custo do vendedor não há comparação
    saida.push({
      orderId: row.external_order_id,
      custoVendedor: custo,
      custoComprador: Number.isFinite(Number(row.custo_comprador)) ? Number(row.custo_comprador) : 0,
      freteCheio: Number.isFinite(Number(row.cheio)) ? Number(row.cheio) : null,
      shipmentId: row.shipment_id,
    });
  }
  return saida;
}

/** Pedidos a revisar num período. */
export async function getMercadoLivreAuditoria(
  connection: IntegrationConnection,
  input: { from: Date; to: Date }
): Promise<ResultadoAuditoria> {
  const pagamentos: PagamentoAuditoria[] = [];
  let parcial = false;

  for (let pagina = 0; pagina < MP_AUDITORIA_PAGINAS; pagina++) {
    const busca = await mercadoPagoFetch<{ paging?: { total?: number }; results?: PagamentoBrutoMP[] }>(
      connection,
      `/v1/payments/search?sort=date_created&criteria=desc&range=date_created`
      + `&begin_date=${encodeURIComponent(input.from.toISOString())}&end_date=${encodeURIComponent(input.to.toISOString())}`
      + `&status=approved&limit=100&offset=${pagina * 100}`
    );
    const itens = busca.results ?? [];
    for (const p of itens) {
      pagamentos.push({
        id: p.id,
        orderId: p.external_reference ?? null,
        status: p.status,
        transactionAmount: p.transaction_amount ?? null,
        netReceived: p.transaction_details?.net_received_amount ?? null,
        charges: p.charges_details ?? [],
        paidAt: p.date_approved ?? null,
      });
    }
    if (itens.length < 100) break;
    if (pagina === MP_AUDITORIA_PAGINAS - 1 && (busca.paging?.total ?? 0) > pagamentos.length) parcial = true;
  }

  const ids = [...new Set(pagamentos.map((p) => p.orderId).filter((id): id is string => !!id))];
  const esperados = await freteEsperadoPorPedido(connection, ids);
  return auditarFrete(pagamentos, esperados, { parcial });
}
