import { dbQuery, hasDb } from "../db";
import { cacheScope } from "../accountContext";
import { currentWorkspaceId } from "../workspaceScope";
import { currentAccount, currentAccountId } from "../accountContext";
import { amazonTaxAmount, getAmazonTaxRateSetting } from "./amazonSettings";
import { getIntegrations } from "./integrationStore";
import { getCosts, costAt } from "../costStore";
import { cached } from "../cache";
import { allocateByWeight, calculateContribution, type ProfitabilityLine } from "../profitability";
import { descontarAnuncio } from "../financialMath";
import { anuncioDoCanal } from "../anuncioDoCanal";
import type { Period } from "../period";
import { amazonConnectionId } from "./amazonSync";
import { brazilDateKey } from "./mercadoLivre";

// Overview da Amazon servido pelo modelo canônico (fase 5 da migração,
// docs/canonical-schema.md). Espelha o mercadoLivreOverviewCanonical: agregados
// em SQL sobre workspace_channel_orders/items/fees + linhas magras para o lucro,
// sem payload jsonb. Diferença da Amazon: sem frete do vendedor
// (sellerShipping = null); fulfillment
// platform = FBA / seller = Próprio; custo resolve por sku ?? asin.
//
// Este módulo é apenas leitura. Já serve `/api/order-profitability`, `/api/radar`
// e `/api/top-products` quando o período está coberto. O faturamento headline
// continua vindo do Sales API (orderMetrics) para manter o match ao centavo com
// o Seller Central — `/api/sales` só cai aqui quando não há **nenhuma** conta
// SP-API no workspace, e nesse caso responde `source: "canonical"` para a tela
// poder avisar que o número não é o oficial.
//
// Ler daqui não exige credencial: a chave é workspace + provider + conexão. Por
// isso `resolveConnection` aceita workspace sem conta SP-API ativa (demonstração,
// ou autorização revogada).

const PROVIDER = "amazon";
const DETAILED_ORDER_LIMIT = 1_000;
const REVENUE_STATUSES = ["paid", "shipped", "delivered"];
const COVERAGE_TOLERANCE_MS = 15 * 60_000;

export interface AmazonCanonicalTopProduct {
  sku: string;
  asin: string;
  title: string;
  units: number;
  salePrice: number | null;
  cost: number | null;
  revenue: number;
  marginPct: number | null;
}

export interface AmazonCanonicalOverview {
  sellerId: string;
  connectionId: string;
  currency: string;
  /** Período totalmente coberto pelo sync (senão, quem consome deve cair na SP-API). */
  covered: boolean;
  metrics: {
    totalOrders: number;
    paidOrders: number;
    fbaOrders: number;
    cancelledOrders: number;
    revenue: number; // gross canônico (referência; headline segue no Sales API)
    /**
     * `null` = houve cancelamento mas o valor é DESCONHECIDO, não zero.
     * A Amazon cancela a maioria dos pedidos ainda em `Pending`, e em `Pending`
     * ela não expõe `OrderTotal` — 2.078 das 2.085 canceladas não têm valor.
     * Exibir R$ 0,00 aí afirma "cancelar não custou nada" (AGENTS.md: null ≠ 0).
     */
    cancelledRevenue: number | null;
    /** Quantos dos cancelados tem valor conhecido. Menor que cancelledOrders = soma parcial. */
    cancelledOrdersWithValue: number;
    /** Quantos desses valores sao estimados pelo preco do SKU, nao medidos. */
    cancelledOrdersEstimated: number;
    lastSaleAt: string | null;
  };
  /** Unidades vendidas por SKU no período — insumo da velocidade do radar. */
  velocityBySku: Record<string, number>;
  /** Série diária contínua (dias sem venda zerados) no fuso de São Paulo. */
  dailySales: Array<{ date: string; revenue: number; orders: number; units: number }>;
  topProducts: AmazonCanonicalTopProduct[];
  profit: {
    revenueProcessed: number;
    fees: number;
    cogs: number;
    /**
     * ⚠️ JÁ COM O ANÚNCIO DENTRO (30/08/2026) — ver a fronteira em
     * `financialMath.ts`. Quem exibe não subtrai de novo. `null` quando o gasto
     * com anúncio é desconhecido.
     */
    estimatedProfit: number | null;
    /** Alíquota declarada pela vendedora. `null` = não cadastrada. */
    taxRate: number | null;
    /** Imposto do período sobre a MESMA base do lucro. `null` sem alíquota. */
    taxes: number | null;
    /**
     * Estorno do período, pela data do PEDIDO original. Já descontado do lucro.
     * `0` = não houve devolução (fato verificado, não ausência de dado).
     */
    refunds: number;
    /** Quantas devoluções compõem o valor acima — a tela avisa quando muda o passado. */
    refundCount: number;
    /**
     * A BASE, e é uma só: o faturamento do período — todo pedido não cancelado
     * pelo valor do próprio pedido, pendente ou confirmado. Lucro, margem e
     * imposto saem daqui. Ver a decisão dela de 31/08/2026 na ADR-027.
     */
    revenueDoLucro: number;
    /** Quantos pedidos compõem a base. */
    pedidosNaBase: number;
    /**
     * Pedidos que a Amazon ainda não valorizou — sem `OrderTotal` e sem preço de
     * tabela. Ficam FORA da base (não valem zero) e a tela os aponta com número.
     */
    pedidosSemValor: number;
    /** Parte de `fees` que é estimativa publicada pela Amazon (ADR-027). */
    feesEstimadas: number;
    /** Quantos pedidos têm tarifa estimada em vez de postada. */
    pedidosComTarifaEstimada: number;
    /** Anúncio já descontado acima. `null` = desconhecido; `0` = não gastou. */
    ads: number | null;
    adsDesconhecido: boolean;
    /** Último dia com métrica. Os dias que faltam não são extrapolados. */
    adsAteDia: string | null;
    unitsWithCost: number;
    unitsWithoutCost: number;
    /** SKUs distintos sem custo — a unidade de ACAO da vendedora. */
    skusWithoutCost: number;
    coverage: { processedOrders: number; paidOrders: number; complete: boolean };
  };
  profitabilityLines: ProfitabilityLine[];
  profitabilityScope: { processedOrders: number; completePeriod: boolean };
  recentOrders: Array<{
    amazonOrderId: string;
    purchaseDate: string;
    orderStatus: string;
    /**
     * Ausente = valor ainda desconhecido. É a mesma forma que a SP-API usa: ela
     * omite `OrderTotal` enquanto o pedido está `Pending`. A tela deve dizer
     * "aguardando valor", nunca R$ 0,00 — zero seria afirmar que a venda não teve
     * receita (AGENTS.md: `null` ≠ `0`).
     */
    orderTotal?: { CurrencyCode: string; Amount: string };
  }>;
}

interface SyncMetaRow {
  covered_from: Date | string | null;
  covered_to: Date | string | null;
}

/**
 * Descobre de qual conexão ler. Com conta SP-API no contexto, é a dela. Sem
 * conta — workspace de demonstração, ou leitura fora do fluxo autenticado da
 * Amazon — cai na conexão registrada no workspace: o canônico é chaveado por
 * workspace + provider + connection e não depende de credencial para ser lido.
 */
async function resolveConnection(): Promise<{ sellerId: string; connectionId: string } | null> {
  // `currentAccountId()` devolve a string "default" fora de contexto, então não
  // serve para detectar ausência de conta — só `currentAccount()` distingue.
  const account = currentAccount();
  if (account) return { sellerId: account.sellerId, connectionId: amazonConnectionId(account.sellerId) };

  const connections = (await getIntegrations(PROVIDER)).filter((item) => item.status === "connected");
  const connection = connections[0];
  if (!connection) return null;
  return { sellerId: connection.externalAccountId, connectionId: connection.id };
}

interface TotalsRow {
  total_orders: number;
  paid_orders: number;
  fba_orders: number;
  paid_revenue: string | null;
  cancelled_revenue: string | null;
  cancelled_orders: number;
  cancelled_with_value: number;
  cancelled_estimated: number;
  currency: string | null;
  last_sale_at: Date | string | null;
}

interface VelocityRow { sku: string | null; external_product_id: string; units: number }

interface DailyRow { date: string; revenue: string | null; orders: number; units: number }

interface ProductTotalsRow {
  external_product_id: string;
  sku: string | null;
  title: string;
  units: number;
  revenue: string;
}

interface RecentRow {
  external_order_id: string;
  provider_status: string;
  occurred_at: Date | string;
  /** `null` = valor ainda desconhecido (pedido `Pending`), nunca zero. */
  gross: string | null;
  currency: string;
}

interface DetailedLineRow {
  external_order_id: string;
  occurred_at: Date | string;
  provider_status: string;
  currency: string;
  buyer_shipping: string | null;
  fulfillment: string | null;
  line_no: number;
  external_product_id: string;
  sku: string | null;
  title: string;
  qty: number;
  /** `null` = preço ainda não exposto pela Amazon (pedido `Pending`, migration 0021). */
  unit_price: string | null;
  fees: string | null;
}

function scopeParams(connectionId: string, period: Period): unknown[] {
  return [currentWorkspaceId(), PROVIDER, connectionId, new Date(period.startISO), new Date(period.endISO)];
}

export async function getAmazonOverviewFromCanonical(period: Period): Promise<AmazonCanonicalOverview | null> {
  if (!hasDb()) return null;
  const resolved = await resolveConnection();
  if (!resolved) return null;
  const { sellerId, connectionId } = resolved;
  const workspaceId = currentWorkspaceId();

  const [syncRows, totalsRows] = await Promise.all([
    dbQuery<SyncMetaRow>(
      `SELECT covered_from, covered_to
         FROM workspace_marketplace_syncs
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
      [workspaceId, PROVIDER, connectionId]
    ),
    dbQuery<TotalsRow>(
      `SELECT COUNT(*)::int AS total_orders,
              COUNT(*) FILTER (WHERE status = ANY($6::text[]))::int AS paid_orders,
              COUNT(*) FILTER (WHERE status = ANY($6::text[]) AND fulfillment = 'platform')::int AS fba_orders,
              SUM(gross) FILTER (WHERE status = ANY($6::text[])) AS paid_revenue,
              -- COALESCE com ordered_gross: pedido cancelado nunca tem gross,
              -- porque a Amazon zera o OrderTotal ao cancelar. O valor de tabela
              -- capturado antes do cancelamento (migrations/0010) é a única fonte.
              SUM(COALESCE(gross, ordered_gross)) FILTER (WHERE status = 'cancelled') AS cancelled_revenue,
              COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_orders,
              -- Quantos cancelados tem valor conhecido. Sem esta contagem a tela
              -- soma o que capturou e apresenta como se fosse o total: medido em
              -- 22/08/2026, uma conta tinha 160 cancelados e 1 com valor, e a soma
              -- de R$ 89,70 seria lida como o valor dos 160. AGENTS.md: mostrar o
              -- que foi capturado E dizer que esta parcial.
              COUNT(COALESCE(gross, ordered_gross)) FILTER (WHERE status = 'cancelled')::int AS cancelled_with_value,
              -- Quantos desses valores sao ESTIMADOS (migrations/0011). A tela
              -- precisa dizer: soma com estimativa dentro nao pode se passar por
              -- medicao, e a estimativa erra para baixo (presume 1 unidade).
              COUNT(*) FILTER (WHERE status = 'cancelled' AND ordered_gross_source = 'estimado')::int AS cancelled_estimated,
              MAX(occurred_at) FILTER (WHERE status = ANY($6::text[])) AS last_sale_at,
              MAX(currency) AS currency
         FROM workspace_channel_orders
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND occurred_at >= $4 AND occurred_at <= $5`,
      [...scopeParams(connectionId, period), REVENUE_STATUSES]
    ),
  ]);
  const syncRow = syncRows[0];
  const totals = totalsRows[0];
  // Sem sync algum e sem pedidos no período → nada canônico para servir.
  if (!syncRow && (!totals || totals.total_orders === 0)) return null;

  const [velocityRows, productTotalsRows, recentRows, lineRows, costs, dailyRows] = await Promise.all([
    dbQuery<VelocityRow>(
      `SELECT i.sku, i.external_product_id, SUM(i.qty)::int AS units
         FROM workspace_channel_order_items i
         JOIN workspace_channel_orders o
           ON o.workspace_id = i.workspace_id AND o.provider = i.provider
          AND o.connection_id = i.connection_id AND o.external_order_id = i.external_order_id
        WHERE i.workspace_id = $1 AND i.provider = $2 AND i.connection_id = $3
          AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status = ANY($6::text[])
        GROUP BY i.sku, i.external_product_id`,
      [...scopeParams(connectionId, period), REVENUE_STATUSES]
    ),
    dbQuery<ProductTotalsRow>(
      `SELECT i.external_product_id, i.sku, MIN(i.title) AS title,
              SUM(i.qty)::int AS units, SUM(i.qty * i.unit_price) AS revenue
         FROM workspace_channel_order_items i
         JOIN workspace_channel_orders o
           ON o.workspace_id = i.workspace_id AND o.provider = i.provider
          AND o.connection_id = i.connection_id AND o.external_order_id = i.external_order_id
        WHERE i.workspace_id = $1 AND i.provider = $2 AND i.connection_id = $3
          AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status = ANY($6::text[])
        GROUP BY i.external_product_id, i.sku`,
      [...scopeParams(connectionId, period), REVENUE_STATUSES]
    ),
    dbQuery<RecentRow>(
      `SELECT external_order_id, provider_status, occurred_at, gross, currency
         FROM workspace_channel_orders
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND occurred_at >= $4 AND occurred_at <= $5
        ORDER BY occurred_at DESC
        LIMIT 10`,
      scopeParams(connectionId, period)
    ),
    dbQuery<DetailedLineRow>(
      `WITH detailed AS (
         SELECT external_order_id, occurred_at, provider_status, currency, buyer_shipping, fulfillment
           FROM workspace_channel_orders
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
            AND occurred_at >= $4 AND occurred_at <= $5 AND status = ANY($6::text[])
          ORDER BY occurred_at DESC
          LIMIT $7
       )
       SELECT d.external_order_id, d.occurred_at, d.provider_status, d.currency,
              d.buyer_shipping, d.fulfillment,
              i.line_no, i.external_product_id, i.sku, i.title, i.qty, i.unit_price,
              ff.amount AS fees
         FROM detailed d
         JOIN workspace_channel_order_items i
           ON i.workspace_id = $1 AND i.provider = $2 AND i.connection_id = $3
          AND i.external_order_id = d.external_order_id
         LEFT JOIN LATERAL (
           SELECT SUM(amount) AS amount FROM workspace_channel_order_fees f
            WHERE f.workspace_id = $1 AND f.provider = $2 AND f.connection_id = $3
              AND f.external_order_id = d.external_order_id AND f.fee_type NOT IN ('refund', 'estimated')
         ) ff ON true
        ORDER BY d.occurred_at DESC, d.external_order_id, i.line_no`,
      [...scopeParams(connectionId, period), REVENUE_STATUSES, DETAILED_ORDER_LIMIT]
    ),
    getCosts(),
    dbQuery<DailyRow>(
      `SELECT to_char(o.occurred_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS date,
              SUM(o.gross) AS revenue,
              COUNT(*)::int AS orders,
              COALESCE(SUM(u.units), 0)::int AS units
         FROM workspace_channel_orders o
         LEFT JOIN LATERAL (
           SELECT SUM(i.qty)::int AS units FROM workspace_channel_order_items i
            WHERE i.workspace_id = o.workspace_id AND i.provider = o.provider
              AND i.connection_id = o.connection_id AND i.external_order_id = o.external_order_id
         ) u ON true
        WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
          AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status = ANY($6::text[])
        GROUP BY 1`,
      [...scopeParams(connectionId, period), REVENUE_STATUSES]
    ),
  ]);

  const currency = totals.currency ?? "BRL";

  // Cobertura: o período está dentro da janela já importada pelo sync.
  const coveredFrom = syncRow?.covered_from ? new Date(syncRow.covered_from).getTime() : Number.POSITIVE_INFINITY;
  const coveredTo = syncRow?.covered_to ? new Date(syncRow.covered_to).getTime() : 0;
  const periodCovered =
    coveredFrom <= new Date(period.startISO).getTime() &&
    coveredTo + COVERAGE_TOLERANCE_MS >= new Date(period.endISO).getTime();

  // Série diária contínua, com dias sem venda zerados — mesmo formato do ML e
  // da Shopee, para a central somar as três num gráfico só.
  const daily = new Map(dailyRows.map((row) => [row.date, { date: row.date, revenue: Number(row.revenue ?? 0), orders: row.orders, units: row.units }]));
  const dailySales: Array<{ date: string; revenue: number; orders: number; units: number }> = [];
  const cursor = new Date(`${brazilDateKey(new Date(period.startISO))}T12:00:00Z`);
  const lastDate = brazilDateKey(new Date(period.endISO));
  while (cursor.toISOString().slice(0, 10) <= lastDate) {
    const date = cursor.toISOString().slice(0, 10);
    dailySales.push(daily.get(date) ?? { date, revenue: 0, orders: 0, units: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const velocityBySku: Record<string, number> = {};
  for (const row of velocityRows) {
    const key = row.sku || row.external_product_id;
    velocityBySku[key] = (velocityBySku[key] ?? 0) + row.units;
  }

  const costOf = (sku: string | null, asin: string) => {
    const entry = (sku ? costs[sku] : undefined) ?? costs[asin];
    return entry && entry.cost > 0 ? entry : null;
  };

  // Detalhe por linha: rateia as fees do pedido entre as linhas por peso de
  // receita e resolve o custo por vigência (mesma regra do ML e do builder
  // ao vivo). A Amazon não tem frete do vendedor.
  //
  // ⚠️ IMPOSTO POR LINHA CONTINUA `null` DE PROPÓSITO, E ISSO NÃO É A PREMISSA
  // ANTIGA. O imposto entra no AGREGADO, sobre a receita apurada do período —
  // é assim que o `profit.ts` sempre fez e é assim que o ML faz. Ratear imposto
  // por linha aqui só teria sentido se a tabela de rentabilidade o exibisse por
  // pedido, e ela não exibe.
  const linesByOrder = new Map<string, DetailedLineRow[]>();
  for (const row of lineRows) {
    const group = linesByOrder.get(row.external_order_id) ?? [];
    group.push(row);
    linesByOrder.set(row.external_order_id, group);
  }

  let fees = 0;
  let cogs = 0;
  let unitsWithCost = 0;
  let unitsWithoutCost = 0;
  // SKU e a unidade de ACAO da vendedora (ver oQueFaltaNoResultado.ts).
  const skusSemCusto = new Set<string>();
  let processedRevenue = 0;
  const profitabilityLines: ProfitabilityLine[] = [];

  for (const [orderId, lines] of linesByOrder) {
    const head = lines[0];
    const feesKnown = head.fees != null;
    const orderFees = Number(head.fees ?? 0);
    const orderBuyerShipping = head.buyer_shipping == null ? 0 : Number(head.buyer_shipping);
    if (feesKnown) fees += orderFees;

    // ⚠️ LINHA SEM PREÇO NÃO VALE ZERO (31/08/2026).
    //
    // Desde a migration 0021 o item de um pedido `Pending` entra sem
    // `unit_price`. `Number(null)` é `0`, então tratar por omissão faria a linha
    // valer zero em três lugares: peso do rateio de tarifa, receita processada e
    // preço na tabela de rentabilidade.
    //
    // Como PESO, zero é inócuo e é o certo: `allocateByWeight` não aloca nada
    // para a linha, e não dá para ratear tarifa proporcional a receita que ainda
    // não se conhece.
    const precoDaLinha = (linha: DetailedLineRow) =>
      linha.unit_price == null ? null : Number(linha.unit_price);
    // ⚠️ `?? 0` AQUI É CORRETO E NÃO É DESCUIDO — não troque por 1 nem por média.
    // Peso zero faz `allocateByWeight` não alocar tarifa nenhuma para a linha, e
    // é exatamente o que se quer: não dá para ratear tarifa proporcional a uma
    // receita que ainda não se conhece. Peso 1 daria à linha sem preço a mesma
    // fatia de uma linha de R$ 1,00, inventando um rateio.
    const weights = lines.map((line) => line.qty * (precoDaLinha(line) ?? 0));
    const feeShares = allocateByWeight(orderFees, weights);
    const buyerShares = allocateByWeight(orderBuyerShipping, weights);

    lines.forEach((line, index) => {
      // `null` = desconhecido: fica fora da receita processada. Somar zero
      // baixaria a receita afirmando que a venda não teve valor.
      const preco = precoDaLinha(line);
      const lineRevenue = preco == null ? null : line.qty * preco;
      processedRevenue += lineRevenue ?? 0;
      const occurredAt = new Date(line.occurred_at).toISOString();
      const entry = costOf(line.sku, line.external_product_id);
      const unitCost = entry ? costAt(entry, occurredAt) : 0;
      const lineProductCost = unitCost > 0 ? unitCost * line.qty : null;
      const lineFees = feesKnown ? feeShares[index] : null;
      const lineBuyerShipping = head.buyer_shipping == null ? null : buyerShares[index];
      const result = calculateContribution({
        revenue: lineRevenue,
        buyerShipping: lineBuyerShipping,
        productCost: lineProductCost,
        marketplaceFees: lineFees,
      });
      if (unitCost > 0) { cogs += unitCost * line.qty; unitsWithCost += line.qty; }
      else { unitsWithoutCost += line.qty; skusSemCusto.add(line.sku ?? line.external_product_id ?? ""); }

      profitabilityLines.push({
        id: `${orderId}:${line.external_product_id}:${line.line_no}`,
        orderId,
        product: line.title,
        sku: line.sku,
        date: occurredAt,
        status: head.provider_status,
        fulfillment: head.fulfillment === "platform" ? "FBA" : head.fulfillment === "seller" ? "Próprio" : null,
        unitPrice: preco,
        quantity: line.qty,
        revenue: lineRevenue,
        currency: line.currency,
        productCost: lineProductCost,
        marketplaceFees: lineFees,
        buyerShipping: lineBuyerShipping,
        sellerShipping: null,
        tax: null,
        contribution: result.contribution,
        marginPct: result.marginPct,
        complete: result.complete,
      });
    });
  }

  // ⚠️ O ANÚNCIO ENTRA AQUI — fronteira em `financialMath.ts`. O dashboard da
  // Amazon subtraía o anúncio na TELA, em três lugares diferentes; agora o
  // número já sai daqui com ele dentro e a tela só lê.
  //
  // A guarda do extrato não se aplica neste caminho: aqui `fees` vem de
  // `workspace_channel_order_fees`, que é tarifa DE PEDIDO — anúncio nunca é
  // postado por pedido. O caminho que precisa da guarda é `profit.ts`, que lê o
  // extrato inteiro da Transactions API.
  // ⚠️ A AMAZON TEM, SIM, IMPOSTO DO VENDEDOR (corrigido em 31/08/2026).
  //
  // Este arquivo afirmava em três lugares que este canal não teria imposto do
  // vendedor, e o canônico foi construído sobre isso. Era
  // PREMISSA FALSA, não esquecimento — e a prova estava no próprio banco: a
  // conta A15NQMF7A6J1Y0 tem `amazon:tax_rate` cadastrado em 5%, e a tela de
  // configuração aceita o valor. A contradição era visível para a vendedora e
  // invisível para o código.
  //
  // O custo dela: `profit.ts` (MONITOR e HOME) descontava o imposto e este
  // caminho (DASHBOARD) não, então as duas telas da Amazon mostravam lucros
  // diferentes para a mesma conta no mesmo instante. Número que diverge entre
  // telas é o defeito que a vendedora detecta sozinha e depois do qual ela não
  // confia em nenhum dos dois.
  //
  // ⚠️ O IMPOSTO SAI DA MESMA BASE DO LUCRO — O FATURAMENTO (31/08/2026).
  //
  // Aqui estava `processedRevenue`, e o comentário anterior defendia isso com um
  // argumento que a decisão dela derrubou: "pedido pendente não tem receita
  // reconhecida". Passou a ter. Enquanto a receita do pendente entrava no lucro
  // e o imposto ficava só sobre o apurado, o imposto era o de um universo e a
  // receita a de outro — a mesma família de defeito que levou a margem a
  // −90,5%, só que na linha do imposto. Medido na conta A15NQMF7A6J1Y0 em
  // 31/08: 5% sobre 130,09 (R$ 6,50) descontados de uma receita de 456,86.
  //
  // A base é calculada mais abaixo (`faturamentoDoLucro`), então o imposto é
  // calculado lá junto — aqui fica só a alíquota.
  const taxRate = await getAmazonTaxRateSetting(dbQuery, workspaceId, currentAccountId()).catch(() => null);

  // ═══ ESTORNO REDUZ O RESULTADO DO PERÍODO (decisão dela, 31/08/2026) ═══════
  //
  // Palavras dela: *"estorno reduz o resultado do período"*. Até aqui os
  // estornos não entravam em lucro nenhum: `fees` os exclui de propósito
  // (devolução ao comprador não é tarifa, e somá-la como tarifa contaria a
  // devolução como custo operacional) — mas eles também não entravam em nenhum
  // outro termo. Medido no banco: R$ 3.091,33 em 123 devoluções fora da conta.
  //
  // ⚠️ PELA DATA DO PEDIDO ORIGINAL, E ISSO MUDA MÊS JÁ FECHADO. É deliberado:
  // junho já está errado hoje — ele exibe um resultado que a operação nunca
  // teve, porque nunca contou aquelas devoluções. Mudar não corrompe histórico;
  // para de publicar número que não existiu. Medido: 107 dos 123 estornos
  // (R$ 2.756,80) caem em meses fechados; junho cai R$ 1.877,31 e julho
  // R$ 879,49.
  //
  // ⚠️ E A DATA DO PEDIDO FOI ESCOLHIDA POR FALTA DE DADO, NÃO POR PREFERÊNCIA.
  // `workspace_channel_order_fees` NÃO TEM COLUNA DE DATA — o estorno não carrega
  // data própria no nosso banco, e a única disponível é a do pedido. A data real
  // do estorno existe na Transactions API (`postedDate`) e nunca foi persistida.
  // Quando existir, revisitar: ver `docs/achado-duas-bases-financeiras-da-amazon.md`.
  // ═══ O PENDENTE ENTRA NA CONTA (31/08/2026, pedido dela) ═══════════════════
  //
  // *"Já passou da hora de você entender que o lucro tem que ser em cima do
  // Faturamento e não em cima só do que foi apurado. Precisa ser do total
  // faturado."* — e ela estava certa: a tela mostrava lucro sobre R$ 76,49 de um
  // faturamento de R$ 514,43.
  //
  // ⚠️ O ATALHO PROIBIDO seria trocar só o denominador da margem. Isso daria
  // numerador apurado sobre denominador cheio — enviesado para baixo, e seria
  // trocar um número errado por outro. O numerador tem de cobrir a MESMA base.
  //
  // Por isso a receita E o custo do pendente entram juntos:
  //   receita  ← `ordered_gross`, o preço de tabela do próprio pedido, capturado
  //              do relatório All Orders (migration 0010) e marcado em
  //              `ordered_gross_source`. Não é média nossa: é número da Amazon.
  //   custo    ← itens do pendente × custo cadastrado. Os itens passaram a ser
  //              ingeridos hoje (a ausência era da NOSSA consulta, não da API).
  //
  // ⚠️ A TARIFA DO PENDENTE CONTINUA DESCONHECIDA, e isso é sinalizado, não
  // fabricado: a Amazon só posta tarifa na liquidação. Pela regra dela de 29/08
  // — *"mostra o número e sinaliza o que falta ao lado"* — o lucro aparece e a
  // tela diz de quantos pedidos falta tarifa. Estimá-la é a ADR-027, que precisa
  // de coluna própria para persistir previsto × real.
  const [faturamentoRows, pendenteLinhas] = await Promise.all([
    // ═══ A BASE, UMA SÓ: O FATURAMENTO (31/08/2026, decisão final dela) ═══════
    //
    // *"fazer dessa forma o cálculo em cima de tudo que é considerado
    // faturamento (pendentes e confirmados). Apenas isso."*
    //
    // Todo pedido não cancelado do período entra, com o valor do PRÓPRIO pedido.
    //
    // ⚠️ `NULLIF(gross, 0)` E NÃO `COALESCE(gross, ordered_gross)` — a diferença
    // vale o faturamento inteiro do pendente. O sync grava `gross = 0.00` (não
    // `NULL`) enquanto a Amazon omite `OrderTotal`, então o `COALESCE` sozinho
    // NUNCA caía para `ordered_gross`: medido em 31/08 na conta A15NQMF7A6J1Y0,
    // 32 pendentes com preço de tabela conhecido somavam zero. `NULLIF` traduz o
    // zero em ausência e deixa o preço de tabela ocupar o lugar.
    //
    // ⚠️ E PEDIDO SEM PREÇO NENHUM NÃO VALE ZERO: fica fora da base e é CONTADO
    // em `sem_valor`, que a tela exibe com número. Somá-lo como zero afirmaria
    // "vendeu e não faturou" — o `null ≠ 0` do AGENTS.md.
    dbQuery<{ receita: string | null; pedidos: number; sem_valor: number; frete: string | null }>(
      `SELECT COALESCE(SUM(COALESCE(NULLIF(o.gross, 0), o.ordered_gross)), 0)::text AS receita,
              COUNT(*)::int                                                         AS pedidos,
              COUNT(*) FILTER (WHERE COALESCE(NULLIF(o.gross, 0), o.ordered_gross) IS NULL)::int AS sem_valor,
              COALESCE(SUM(o.buyer_shipping), 0)::text                              AS frete
         FROM workspace_channel_orders o
        WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
          AND o.occurred_at >= $4 AND o.occurred_at <= $5
          AND o.status <> 'cancelled'`,
      scopeParams(connectionId, period),
    ),
    // O CUSTO COBRE EXATAMENTE O MESMO CONJUNTO DA BASE, e é por isso que este
    // filtro é o COMPLEMENTO do detalhado, não `status = 'pending'`.
    //
    // ⚠️ Numerador e denominador têm de cobrir o mesmo universo. Enquanto aqui
    // estava `'pending'` e a base somava só o apurado, o custo de um universo
    // caía sobre a receita de outro — foi assim que a margem foi a −90,5% na
    // conta A15NQMF7A6J1Y0 em 31/08/2026 (custo de 46 unidades pendentes contra
    // a receita de 13 dos 32 pedidos). Qualquer status novo que a Amazon
    // invente entra aqui sozinho, em vez de somar receita sem custo.
    dbQuery<{ sku: string | null; external_product_id: string; qty: number; occurred_at: string }>(
      `SELECT i.sku, i.external_product_id, i.qty, o.occurred_at
         FROM workspace_channel_order_items i
         JOIN workspace_channel_orders o
           ON o.workspace_id = i.workspace_id AND o.provider = i.provider
          AND o.connection_id = i.connection_id AND o.external_order_id = i.external_order_id
        WHERE i.workspace_id = $1 AND i.provider = $2 AND i.connection_id = $3
          AND o.occurred_at >= $4 AND o.occurred_at <= $5
          AND o.status <> 'cancelled' AND NOT (o.status = ANY($6))`,
      [...scopeParams(connectionId, period), REVENUE_STATUSES],
    ),
  ]);
  // Tarifa ESTIMADA do período, somada à parte da real (ADR-027). Separada de
  // propósito: a tela precisa dizer quanto do número é estimativa, e juntar as
  // duas numa coluna só apagaria essa distinção — que é a única coisa que
  // impede a estimativa de ser lida como oficial.
  //
  // ═══ A OFICIAL SUBSTITUI A ESTIMADA (ADR-027 item 3, e o que ninguém faz) ══
  //
  // ⚠️ O `NOT EXISTS` ABAIXO NÃO É ENFEITE — SEM ELE A TARIFA CONTA DUAS VEZES.
  // A linha `estimated` continua gravada depois que a Amazon posta a real (de
  // propósito: é ela que permite medir a pontaria). Mas a leitura soma as duas
  // colunas, e o detalhado já traz a REAL: o pedido liquidado entrava com
  // comissão real + comissão estimada, e o lucro caía por um custo que não
  // existe. Substituir é EXCLUIR a estimativa na LEITURA, nunca apagar a linha.
  //
  // ⚠️ E É POR ISTO QUE A ADR-027 EXISTE. Medido em 31/08/2026 na tela do
  // Gestor Seller: o concorrente calcula a tarifa no minuto do pedido e NUNCA
  // substitui — o pedido `702-9124025-9780207`, criado 31/07 e aprovado em
  // 10/08, seguia mostrando 12,01% de tabela três semanas depois. Se a Amazon
  // cobrar diferente (promoção, mudança de categoria, ajuste, reembolso), o
  // lucro deles fica errado para sempre. O nosso conserta na liquidação, e é
  // esta cláusula que faz isso acontecer. Quem remover para "simplificar"
  // reintroduz o defeito do concorrente e a dupla contagem de uma vez só.
  const estimadaRows = await dbQuery<{ total: string | null; pedidos: number }>(
    `SELECT COALESCE(SUM(f.amount), 0)::text AS total,
            COUNT(DISTINCT f.external_order_id)::int AS pedidos
       FROM workspace_channel_order_fees f
       JOIN workspace_channel_orders o
         ON o.workspace_id = f.workspace_id AND o.provider = f.provider
        AND o.connection_id = f.connection_id AND o.external_order_id = f.external_order_id
      WHERE f.workspace_id = $1 AND f.provider = $2 AND f.connection_id = $3
        AND f.fee_type = 'estimated'
        AND o.occurred_at >= $4 AND o.occurred_at <= $5
        AND NOT EXISTS (
          SELECT 1 FROM workspace_channel_order_fees real
           WHERE real.workspace_id = f.workspace_id AND real.provider = f.provider
             AND real.connection_id = f.connection_id
             AND real.external_order_id = f.external_order_id
             AND real.fee_type NOT IN ('refund', 'estimated')
        )`,
    scopeParams(connectionId, period),
  );
  const feesEstimadas = Number(estimadaRows[0]?.total ?? 0);
  const pedidosComTarifaEstimada = estimadaRows[0]?.pedidos ?? 0;

  const faturamentoDoLucro = Number(faturamentoRows[0]?.receita ?? 0);
  const pedidosNaBase = faturamentoRows[0]?.pedidos ?? 0;
  const pedidosSemValor = faturamentoRows[0]?.sem_valor ?? 0;

  // Custo do pendente pela MESMA regra do apurado: custo cadastrado vigente na
  // data da compra. Unidade sem custo cadastrado conta em `unitsWithoutCost` e
  // vira sinal na tela — o custo que falta é cadastro dela, e a regra de 29/08
  // é mostrar o número e apontar o que falta, não apagar o resultado.
  let cogsPendente = 0;
  for (const linha of pendenteLinhas) {
    const entrada = costOf(linha.sku, linha.external_product_id);
    const custoUnitario = entrada ? costAt(entrada, new Date(linha.occurred_at).toISOString()) : 0;
    if (custoUnitario > 0) {
      cogsPendente += custoUnitario * linha.qty;
      unitsWithCost += linha.qty;
    } else {
      unitsWithoutCost += linha.qty;
      skusSemCusto.add(linha.sku ?? linha.external_product_id ?? "");
    }
  }

  const [estornoRows] = await Promise.all([
    dbQuery<{ total: string | null; n: number }>(
      `SELECT SUM(f.amount)::text AS total, COUNT(*)::int AS n
         FROM workspace_channel_order_fees f
         JOIN workspace_channel_orders o
           ON o.workspace_id = f.workspace_id AND o.provider = f.provider
          AND o.connection_id = f.connection_id AND o.external_order_id = f.external_order_id
        WHERE f.workspace_id = $1 AND f.provider = $2 AND f.connection_id = $3
          AND f.fee_type = 'refund'
          AND o.occurred_at >= $4 AND o.occurred_at <= $5`,
      scopeParams(connectionId, period),
    ),
  ]);
  // `0` é fato ("não houve devolução no período"), não ausência: a Amazon expõe
  // estorno e a consulta acima cobre o período inteiro. Ausência VERIFICADA.
  const refunds = Number(estornoRows[0]?.total ?? 0);
  const refundCount = estornoRows[0]?.n ?? 0;

  const anuncio = await anuncioDoCanal("amazon", period.startISO, period.endISO);
  // `taxes ?? 0`: sem alíquota o lucro sai sem imposto, como sempre saiu — quem
  // avisa é a tela, que passa a dizer "(sem imposto)" só nesse caso.
  // ⚠️ A BASE DO LUCRO É O FATURAMENTO, NÃO O APURADO — receita E custo do
  // pendente entram JUNTOS, para o numerador cobrir o mesmo universo do
  // denominador. Descontar custo de pendente sem somar a receita dele, ou o
  // contrário, produziria um viés só que o outro.
  //
  // ⚠️ E A BASE É UMA SÓ, MEDIDA NO PEDIDO — não mais `processedRevenue` somado
  // ao pendente (31/08/2026). Aquela soma juntava duas contagens diferentes: a
  // apurada vinha das LINHAS de item (linha sem preço valia zero) e a pendente
  // vinha do PEDIDO. O resultado somava universos que não fechavam entre si.
  // Agora todo pedido não cancelado entra pelo próprio valor, uma vez só.
  const receitaDoLucro = faturamentoDoLucro;
  const cogsDoLucro = +(cogs + cogsPendente).toFixed(2);
  // O imposto acompanha a base, e não a receita apurada — ver a nota na leitura
  // da alíquota, acima.
  const taxes = amazonTaxAmount(receitaDoLucro, taxRate);
  // A tarifa da conta é a REAL mais a ESTIMADA — sem a estimada, a receita do
  // pendente entraria sem custo de canal e o lucro inflaria: medido em 31/08,
  // a margem ia a 93,2% justamente por isso. Trocar um número enviesado para
  // cima por outro enviesado para baixo é o que este passo existe para evitar.
  const tarifaDoLucro = +(fees + feesEstimadas).toFixed(2);
  const lucro = descontarAnuncio(
    +(receitaDoLucro - tarifaDoLucro - cogsDoLucro - (taxes ?? 0) - refunds).toFixed(2),
    anuncio,
  );
  const estimatedProfit = lucro.estimatedProfit;

  const topProducts: AmazonCanonicalTopProduct[] = productTotalsRows
    .map((row) => {
      const revenue = Number(row.revenue);
      const salePrice = row.units > 0 ? +(revenue / row.units).toFixed(2) : null;
      const entry = costOf(row.sku, row.external_product_id);
      const cost = entry ? entry.cost : null;
      const marginPct = cost != null && salePrice != null && salePrice > 0 ? +((salePrice - cost) / salePrice * 100).toFixed(2) : null;
      return {
        sku: row.sku ?? row.external_product_id,
        asin: row.external_product_id,
        title: row.title,
        units: row.units,
        salePrice,
        cost,
        revenue,
        marginPct,
      };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  return {
    sellerId,
    connectionId,
    currency,
    covered: periodCovered,
    metrics: {
      totalOrders: totals.total_orders,
      paidOrders: totals.paid_orders,
      fbaOrders: totals.fba_orders,
      cancelledOrders: totals.cancelled_orders,
      cancelledOrdersWithValue: totals.cancelled_with_value,
      cancelledOrdersEstimated: totals.cancelled_estimated,
      revenue: Number(totals.paid_revenue ?? 0),
      // `?? 0` aqui era a violação: SUM() sobre valores nulos devolve NULL, e o
      // zero resultante virava "cancelaram e não custou nada" na tela.
      cancelledRevenue: totals.cancelled_revenue === null ? null : Number(totals.cancelled_revenue),
      lastSaleAt: totals.last_sale_at ? new Date(totals.last_sale_at).toISOString() : null,
    },
    velocityBySku,
    dailySales,
    topProducts,
    profit: {
      revenueProcessed: +processedRevenue.toFixed(2),
      /** A base que o LUCRO usa: apurado + pendente valorizado pela Amazon. */
      revenueDoLucro: receitaDoLucro,
      pedidosNaBase,
      pedidosSemValor,
      fees: tarifaDoLucro,
      /** Quanto de `fees` é estimativa da Product Fees API, não tarifa postada. */
      feesEstimadas: +feesEstimadas.toFixed(2),
      pedidosComTarifaEstimada,
      cogs: cogsDoLucro,
      estimatedProfit,
      taxRate,
      taxes,
      refunds: +refunds.toFixed(2),
      refundCount,
      ads: lucro.ads,
      adsDesconhecido: lucro.adsDesconhecido,
      adsAteDia: lucro.ateDia,
      unitsWithCost,
      unitsWithoutCost,
      skusWithoutCost: skusSemCusto.size,
      coverage: {
        processedOrders: linesByOrder.size,
        paidOrders: totals.paid_orders,
        complete: periodCovered && linesByOrder.size >= totals.paid_orders,
      },
    },
    profitabilityLines,
    profitabilityScope: {
      processedOrders: linesByOrder.size,
      completePeriod: periodCovered,
    },
    recentOrders: recentRows.map((row) => ({
      amazonOrderId: row.external_order_id,
      purchaseDate: new Date(row.occurred_at).toISOString(),
      orderStatus: row.provider_status,
      // `gross` nulo = valor ainda desconhecido (pedido `Pending`, a Amazon omite
      // `OrderTotal`). Devolver o campo AUSENTE reproduz exatamente o sinal que a
      // própria API manda nesse caso, então quem já sabe lidar com pendente sem
      // total continua funcionando. `String(null)` viraria `"null"` e, adiante,
      // `NaN` na tela.
      orderTotal: row.gross === null ? undefined : { CurrencyCode: row.currency, Amount: String(row.gross) },
    })),
  };
}

// Deduplica a computação canônica entre as rotas do dashboard que a consomem
// no mesmo carregamento (radar + top-products + rentabilidade). Namespaced por
// conta/workspace pelo próprio `cached`.
export function getAmazonOverviewCanonicalCached(period: Period): Promise<AmazonCanonicalOverview | null> {
  return cached(`amazon-overview-canonical:${cacheScope()}:${period.key}`, 60_000, () => getAmazonOverviewFromCanonical(period));
}
