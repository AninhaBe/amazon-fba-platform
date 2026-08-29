import { dbQuery, dbTransaction, hasDb } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { getIntegrations } from "./integrationStore";
import { getShopeeOverviewFromCanonical, shopeeCostId } from "./shopeeOverviewCanonical";
import { getCosts, setCost } from "../costStore";
import { invalidateCostDerivedCaches } from "../costInvalidation";
import type { IntegrationConnection } from "./types";
import { shopeeAbcClass, shopeePageRequest, shopeePeriodRequest, ShopeeModuleError } from "./shopeeModuleContract";
import { withShopeeIntegrationWriteFence } from "./shopeeWriteFence";
import { escolherConexaoPadrao } from "./conexaoPadrao";
import { condicaoDeAtividade, filtroDeAtividadeRequest, ocultadosPeloFiltro, STATUS_ATIVO } from "./filtroDeAtividade";

const PROVIDER = "shopee";
type Row = Record<string, unknown>;

export async function requireShopeeConnection(params: URLSearchParams): Promise<IntegrationConnection> {
  const requested = params.get("connection_id") ?? params.get("connectionId");
  return selectShopeeConnection(await getIntegrations(PROVIDER), requested);
}

export function selectShopeeConnection(connections: IntegrationConnection[], requested?: string | null): IntegrationConnection {
  // ⚠️ A escolha vem de `escolherConexaoPadrao`, a MESMA função que o seletor da
  // tela usa. Ter duas cópias da regra (era o caso até 28/08/2026) é como o
  // servidor acaba pintando a loja A enquanto o seletor diz loja B.
  const connection = escolherConexaoPadrao(
    connections.filter((item) => item.provider === PROVIDER),
    requested,
  );
  if (!connection) {
    throw new ShopeeModuleError(404, "CONNECTION_NOT_FOUND", "Nenhuma loja Shopee conectada.");
  }
  return connection;
}

export async function readShopeeCatalog(connection: IntegrationConnection, params: URLSearchParams) {
  const page = shopeePageRequest(params), q = (params.get("q") ?? "").trim();
  if (q.length > 120) throw new ShopeeModuleError(400, "INVALID_SEARCH", "Busca muito longa.");
  // Anúncio inativo sai da frente por padrão — 265 de 372 nesta loja. Ver
  // `filtroDeAtividade.ts`: o inativo não some, só deixa de ser o padrão.
  const atividade = filtroDeAtividadeRequest(params);
  if (!hasDb()) return { items: [], page: { ...page, total: 0, hasMore: false }, atividade, ordenacao: "volume" as const, totalNoCanal: 0, ocultados: 0, semEstoqueInformado: { anuncios: 0, varreduraEm: null }, availability: "NOT_AVAILABLE" as const };
  const escopo = [currentWorkspaceId(), PROVIDER, connection.id];
  // ORDENAÇÃO PADRÃO: mais vendido nos últimos 30 dias primeiro.
  //
  // Pedido da dona, nas palavras dela: "preciso que na tela de produtos tenha um
  // filtro de selecionar em ordem de maior pro menor por volume de vendas nos
  // últimos 30 dias pra ficarem no topo todos os SKUs que eu preciso cadastrar
  // custo". Entregar isso escondido atrás de um seletor resolveria pela metade —
  // então é o padrão. A ordem anterior (alfabética) continua no seletor.
  //
  // ⚠️ Sem venda no período é ZERO, que é fato, e vai para o fim naturalmente —
  // não é `null` e não some da lista.
  const ordenacao = params.get("ordenacao") === "titulo" ? "titulo" : "volume";
  const ordem = ordenacao === "titulo"
    ? "ORDER BY p.title,COALESCE(p.sku,''),p.external_product_id"
    // ⚠️ COALESCE no ORDER BY, não só no SELECT. `ORDER BY x DESC` no Postgres
    // é NULLS FIRST — e sem venda no período a junção devolve NULL, então os
    // anúncios que NÃO venderam iam para o TOPO, o exato oposto do pedido.
    // Pego ao rodar contra a loja real antes de subir; a consulta "funcionava".
    : "ORDER BY unidades_30d DESC,p.title,p.external_product_id";
  const rows = await dbQuery<Row>(
    // ⚠️ A VENDA SE PRENDE AO SKU, NÃO AO ID DO ANÚNCIO (29/08/2026).
    //
    // Este número era juntado por `external_product_id`. Depois que o catálogo
    // passou a ter uma linha por variação, com id composto (`123::sku:456`), a
    // conta quebrou: o item de pedido antigo foi gravado com o id BASE. Medido
    // na loja dela: 401 de 22.589 itens estão no formato novo — **1,8%**. Então
    // a linha de variação enxergava só a ponta recente da venda.
    //
    // MESA-INFANTIL-ROSA mostrava 13 unidades quando o real são 576. E como
    // este é o número que ORDENA a tela, a função central dela estava invertida:
    // o pedido literal foi "os SKUs que eu preciso cadastrar custo no topo", e o
    // TAPETE de 62 aparecia acima da VERDE de 747.
    //
    // O item de pedido antigo JÁ TEM o SKU certo gravado — então juntar por SKU
    // acerta hoje, sem depender do backfill da ADR-029. E o SKU é a unidade
    // certa para ESTA tela de qualquer forma: o custo é por SKU.
    //
    // Linha sem SKU (o "anúncio-pai" de um conjunto de variações; 96 na loja
    // dela, todos `closed`) cai no id — cada linha continua afirmando um fato
    // sobre si mesma, e essas ficam fora da lista padrão.
    //
    // Agregação em UMA passada, não um LATERAL por linha: sem índice em `sku`,
    // o LATERAL varreria os itens uma vez por anúncio da página.
    `WITH vendas AS (
       SELECT i.external_product_id, NULLIF(TRIM(i.sku),'') sku, i.qty
         FROM workspace_channel_order_items i
         JOIN workspace_channel_orders o
           ON o.workspace_id=i.workspace_id AND o.provider=i.provider
          AND o.connection_id=i.connection_id AND o.external_order_id=i.external_order_id
        WHERE i.workspace_id=$1 AND i.provider=$2 AND i.connection_id=$3
          AND o.occurred_at > now() - interval '30 days'
          AND o.status = ANY(ARRAY['paid','shipped','delivered'])
     ), por_sku AS (
       SELECT sku, SUM(qty)::int unidades FROM vendas WHERE sku IS NOT NULL GROUP BY sku
     ), por_anuncio AS (
       SELECT external_product_id, SUM(qty)::int unidades,
              COUNT(DISTINCT sku)::int variacoes
         FROM vendas GROUP BY external_product_id
     )
     SELECT p.external_product_id,p.sku,p.title,p.status,p.provider_status,p.price,p.currency,p.available_qty,p.thumbnail,p.permalink,p.synced_at,
            COALESCE(CASE WHEN NULLIF(TRIM(p.sku),'') IS NOT NULL THEN s.unidades ELSE a.unidades END,0)::int unidades_30d,
            -- "N variações neste anúncio" só faz sentido na linha que É o
            -- anúncio inteiro. Na linha de uma variação, ela é uma só.
            CASE WHEN NULLIF(TRIM(p.sku),'') IS NOT NULL THEN 0
                 ELSE COALESCE(a.variacoes,0) END::int variacoes_vendidas,
            COUNT(*) OVER()::int total
       FROM workspace_channel_products p
       LEFT JOIN por_sku s ON s.sku = NULLIF(TRIM(p.sku),'')
       LEFT JOIN por_anuncio a ON a.external_product_id = p.external_product_id
      WHERE p.workspace_id=$1 AND p.provider=$2 AND p.connection_id=$3
        AND ($4='' OR p.title ILIKE '%'||$4||'%' OR COALESCE(p.sku,'') ILIKE '%'||$4||'%' OR p.external_product_id ILIKE '%'||$4||'%')${condicaoDeAtividade("p.status", 7, atividade)}
      ${ordem} LIMIT $5 OFFSET $6`,
    atividade === "todos" ? [...escopo, q, page.limit, page.offset] : [...escopo, q, page.limit, page.offset, STATUS_ATIVO]);
  const items = rows.map(r => ({ productId: String(r.external_product_id), sku: r.sku == null ? null : String(r.sku), title: String(r.title), status: String(r.status), providerStatus: String(r.provider_status), price: r.price == null ? null : Number(r.price), currency: String(r.currency), availableQty: r.available_qty == null ? null : Number(r.available_qty), thumbnail: r.thumbnail == null ? null : String(r.thumbnail), permalink: r.permalink == null ? null : String(r.permalink), updatedAt: new Date(String(r.synced_at)).toISOString(),
    unidades30d: Number(r.unidades_30d ?? 0),
    // Quantas VARIAÇÕES distintas venderam sob este anúncio. Enquanto o custo
    // for por anúncio (até a ADR-029), isto é a informação que diz à pessoa que
    // um campo só está cobrindo várias coisas. É AVISO, não bloqueio: bloquear
    // frustraria quem pediu facilidade; esconder seria pior.
    variacoesVendidas: Number(r.variacoes_vendidas ?? 0) }));
  const total = Number(rows[0]?.total ?? 0);
  // O total do canal (sem o filtro, com a busca) é o que permite dizer QUANTOS
  // ficaram de fora. Sem esse número a tela esconderia sem avisar.
  // ⚠️ O QUE NAO ESTA NA LISTA PRECISA SER DITO, COM NUMERO E DATA (ADR-033).
  // Anuncio que a varredura nao devolveu tem `available_qty` NULL — antes ele
  // vinha como 0 e a tela afirmava "estoque zero" sobre o que ninguem informou.
  // Some-lo em silencio seria trocar um defeito por outro.
  const [semEstoque] = await dbQuery<{ anuncios: number; varredura: string | null }>(
    `SELECT COUNT(*) FILTER (WHERE p.available_qty IS NULL)::int AS anuncios,
            MAX(s.products_synced_at)::text AS varredura
       FROM workspace_channel_products p
       LEFT JOIN workspace_marketplace_syncs s
         ON s.workspace_id = p.workspace_id AND s.provider = p.provider
        AND s.connection_id = p.connection_id
      WHERE p.workspace_id=$1 AND p.provider=$2 AND p.connection_id=$3`,
    escopo
  );

  const totalNoCanal = atividade === "todos" ? total : Number((await dbQuery<Row>(
    `SELECT COUNT(*)::int total FROM workspace_channel_products WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3 AND ($4='' OR title ILIKE '%'||$4||'%' OR COALESCE(sku,'') ILIKE '%'||$4||'%' OR external_product_id ILIKE '%'||$4||'%')`,
    [...escopo, q]
  ))[0]?.total ?? 0);
  return {
    items,
    page: { ...page, total, hasMore: page.offset + items.length < total },
    atividade,
    ordenacao,
    totalNoCanal,
    ocultados: ocultadosPeloFiltro(totalNoCanal, total),
    semEstoqueInformado: {
      anuncios: Number(semEstoque?.anuncios ?? 0),
      varreduraEm: semEstoque?.varredura ?? null,
    },
    availability: "AVAILABLE" as const,
  };
}

export async function readShopeeInventory(connection: IntegrationConnection, params: URLSearchParams) {
  const period = shopeePeriodRequest(params), catalog = await readShopeeCatalog(connection, params);
  if (!hasDb()) return { ...catalog, period: { from: period.from.toISOString(), to: period.to.toISOString() } };
  const sold = await dbQuery<Row>(`SELECT i.external_product_id,i.sku,SUM(i.qty)::int units FROM workspace_channel_order_items i JOIN workspace_channel_orders o USING(workspace_id,provider,connection_id,external_order_id) WHERE i.workspace_id=$1 AND i.provider=$2 AND i.connection_id=$3 AND o.occurred_at BETWEEN $4 AND $5 AND o.status=ANY($6::text[]) GROUP BY i.external_product_id,i.sku`, [currentWorkspaceId(), PROVIDER, connection.id, period.from, period.to, ["paid","shipped","delivered"]]);
  const units = new Map(sold.map(r => [`${r.external_product_id}\0${r.sku ?? ""}`, Number(r.units)]));
  const days = Math.max(1, (period.to.getTime() - period.from.getTime()) / 86_400_000);
  return { ...catalog, items: catalog.items.map(p => { const unitsSold = units.get(`${p.productId}\0${p.sku ?? ""}`) ?? 0; const averagePerDay = unitsSold / days; return { ...p, unitsSold, averagePerDay: +averagePerDay.toFixed(4), daysRemaining: p.availableQty != null && averagePerDay > 0 ? +(p.availableQty / averagePerDay).toFixed(1) : null }; }), period: { from: period.from.toISOString(), to: period.to.toISOString() } };
}

export async function readShopeeFinance(connection: IntegrationConnection, params: URLSearchParams) {
  const period = shopeePeriodRequest(params), page = shopeePageRequest(params);
  // Busca do monitor (E3): pedido, SKU ou título — filtrada no servidor, junto
  // da paginação, para nunca buscar só na página carregada.
  const q = (params.get("q") ?? "").trim();
  if (q.length > 120) throw new ShopeeModuleError(400, "INVALID_FILTER", "Busca muito longa.");
  const overview = await getShopeeOverviewFromCanonical(connection, period, { detailPage: page, detailQuery: q });
  if (!overview) return { availability: "NOT_AVAILABLE" as const, profit: null, orders: [], page: { ...page, total: 0, hasMore: false, complete: true } };
  return {
    availability: "AVAILABLE" as const,
    period: overview.period,
    currency: overview.metrics.currency,
    profit: overview.profit,
    orders: overview.profitabilityLines,
    page: {
      limit: overview.profitabilityPage.limit,
      offset: overview.profitabilityPage.offset,
      total: overview.profitabilityPage.totalOrders,
      returned: overview.profitabilityPage.returnedOrders,
      hasMore: overview.profitabilityPage.hasMore,
      complete: overview.profitabilityPage.complete,
    },
  };
}

export async function readShopeeAbc(connection: IntegrationConnection, params: URLSearchParams) {
  const period = shopeePeriodRequest(params), overview = await getShopeeOverviewFromCanonical(connection, period);
  if (!overview) return { items: [], coverage: null, availability: "NOT_AVAILABLE" as const };
  const rows = await dbQuery<Row>(`SELECT i.external_product_id,i.sku,MAX(i.title) title,SUM(i.qty*i.unit_price)::numeric revenue,SUM(i.qty)::int units FROM workspace_channel_order_items i JOIN workspace_channel_orders o USING(workspace_id,provider,connection_id,external_order_id) WHERE i.workspace_id=$1 AND i.provider=$2 AND i.connection_id=$3 AND o.occurred_at BETWEEN $4 AND $5 AND o.status=ANY($6::text[]) GROUP BY i.external_product_id,i.sku ORDER BY revenue DESC,i.external_product_id,i.sku`, [currentWorkspaceId(), PROVIDER, connection.id, period.from, period.to, ["paid","shipped","delivered"]]);
  const total = rows.reduce((sum, item) => sum + Number(item.revenue), 0); let cumulative = 0;
  return { items: rows.map(item => { const revenue = Number(item.revenue); cumulative += revenue; const share = total > 0 ? revenue / total : 0; return { productId: String(item.external_product_id), sku: item.sku == null ? null : String(item.sku), title: String(item.title), revenue, units: Number(item.units), revenueShare: +(share * 100).toFixed(2), class: shopeeAbcClass(total > 0 ? cumulative / total : 0), profit: null, profitAvailable: false }; }), coverage: overview.metrics.revenueCoverage, profitSubset: { profitAvailable: false, reason: "Lucro por SKU não é derivável com segurança do contrato canônico atual." }, availability: "AVAILABLE" as const };
}

export async function readShopeeCosts(connection: IntegrationConnection, params: URLSearchParams) {
  const [catalog, costs] = await Promise.all([readShopeeCatalog(connection, params), getCosts()]);
  return { ...catalog, items: catalog.items.map(product => { const id = shopeeCostId(connection.id, product.productId, product.sku); return { ...product, id, cost: costs[id]?.cost ?? null, costUpdatedAt: costs[id]?.updatedAt ?? null }; }) };
}

export async function writeShopeeCost(connection: IntegrationConnection, body: unknown) {
  const value = body as Record<string, unknown>; const productId = typeof value?.productId === "string" ? value.productId.trim() : ""; const sku = typeof value?.sku === "string" ? value.sku.trim() : null; const cost = typeof value?.cost === "number" ? value.cost : Number.NaN;
  if (!productId || productId.length > 160 || (sku?.length ?? 0) > 160 || !Number.isFinite(cost) || cost < 0) throw new ShopeeModuleError(400, "INVALID_COST", "Produto, SKU ou custo inválido.");
  const entry = { id: shopeeCostId(connection.id, productId, sku), sku: sku ?? undefined, title: typeof value.title === "string" ? value.title.slice(0, 300) : undefined, cost };
  if (!hasDb()) { const salvo = await setCost(entry); await invalidateCostDerivedCaches(); return salvo; }
  const fenced = await withShopeeIntegrationWriteFence(
    dbTransaction,
    currentWorkspaceId(),
    connection.id,
    (query) => setCost(entry, query),
  );
  if (!fenced.owned) throw new ShopeeModuleError(404, "CONNECTION_NOT_FOUND", "Nenhuma loja Shopee conectada.");
  // Depois do commit: invalidar antes deixaria a janela em que um leitor
  // recacheia o valor velho e a troca some de novo.
  await invalidateCostDerivedCaches();
  return fenced.value;
}
