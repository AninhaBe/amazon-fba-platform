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
import { anuncioDoCanal, gastoDeAnuncioPorDia } from "../anuncioDoCanal";
import { tacosDoPeriodo, type TacosDoPeriodo } from "./tacosDoCanal";
import { lucroPorDiaDaAmazon } from "./lucroPorDiaDaAmazon";
import type { Period } from "../period";
import { amazonConnectionId } from "./amazonSync";
import { brazilDateKey } from "./mercadoLivre";
import { SQL_TARIFAS_QUE_CUSTAM } from "./canonical";

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
  /**
   * Série diária contínua (dias sem venda zerados) no fuso de São Paulo.
   *
   * `profit` segue a semântica do v3 do ML (contrato fechado com a Vitrine em
   * 12/09/2026): `0` é fato, `null` é "não apurável" e vira contorno na tela.
   * O dia só é apurável quando TODOS os pedidos não cancelados dele têm valor
   * (publicado ou preço de tabela da estimativa), tarifa (real ou estimada,
   * view efetivas), custo de todas as unidades E o anúncio daquele dia é
   * conhecido — o lucro da Amazon desconta ads (decisão de 25/08), então dia
   * depois de `adsAteDia` sai `null`, coerente com o período.
   * `profitEstimated: true` = a tarifa do dia inclui estimativa ADR-027 — é a
   * marca "estimado" que a Ana aprovou para a coluna.
   * `refunds` = estorno POSTADO naquele dia (data do lançamento) — presente
   * quando > 0 para a dica explicar barra derrubada por venda antiga.
   */
  dailySales: Array<{
    date: string; revenue: number; orders: number; units: number;
    profit: number | null; profitEstimated?: boolean; refunds?: number;
  }>;
  topProducts: AmazonCanonicalTopProduct[];
  profit: {
    revenueProcessed: number;
    /** Fatias e fluxo do painel do conciliado; o lucro e o residuo, a margem sai do centro. */
    composicaoDoConciliado: {
      receita: number; custo: number; tarifa: number; pedidos: number;
      lucro: number; margemPct: number | null;
    };
    fees: number;
    cogs: number;
    /**
     * ⚠️ JÁ COM O ANÚNCIO DENTRO (30/08/2026) — ver a fronteira em
     * `financialMath.ts`. Quem exibe não subtrai de novo. `null` quando o gasto
     * com anúncio é desconhecido.
     */
    /**
     * A base do RESULTADO: soma dos pedidos com preco, tarifa E custo
     * conhecidos. `null` quando nenhum pedido fecha. Lucro, margem e imposto
     * saem DAQUI — nunca do faturamento inteiro (ver o bloco UNIVERSO COERENTE).
     */
    baseDoResultado: number | null;
    /** Quantos pedidos compoem `baseDoResultado` — a tela declara "X de N". */
    pedidosCompletos: number;
    estimatedProfit: number | null;
    /** Alíquota declarada pela vendedora. `null` = não cadastrada. */
    taxRate: number | null;
    /** `false` = zero por falta de cadastro, nao por isencao (ADR-038). */
    taxRateKnown: boolean;
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
    /**
     * A base do lucro. `null` quando o faturamento do periodo nao foi injetado —
     * ver a nota em `faturamentoDoLucro`. Nunca cai na soma do banco em silencio.
     */
    revenueDoLucro: number | null;
    /** Quantos pedidos compõem a base. */
    /** Todo pedido nao cancelado do periodo — inclusive os que a base nao valoriza. */
    pedidosDoPeriodo: number;
    /** Quantos deles a base consegue valorizar. `pedidosDoPeriodo` menos os sem valor. */
    pedidosComValor: number;
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
    /**
     * TACOS do período — mesmo shape do ML (`tacosDoCanal`). Denominador é o
     * faturamento do lucro (`revenueDoLucro`), nunca `paid_revenue`: cancelada
     * no denominador infla, e denominador inflado mente o TACOS para baixo.
     */
    tacos: TacosDoPeriodo;
    /** Último dia com gasto coletado — o dia corrente ainda soma. */
    tacosAteDia: string | null;
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

interface DailyRow { date: string | null; revenue: string | null; orders: number; units: number }

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
  /** O status CANONICO, para separar quem CONTA custo de quem so APARECE. */
  status_canonico: string;
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

export interface OpcoesDoOverview {
  /**
   * O FATURAMENTO DO PERÍODO — a base única de lucro, margem e imposto.
   *
   * ⚠️ Vem de fora porque o canônico não consegue produzi-lo: a Amazon omite
   * `OrderTotal` enquanto o pedido está `Pending` e o relatório All Orders, que
   * traz o preço de tabela, se espaça a cada ~3h. Quem tem o número é o
   * `orderMetrics` da Sales API — o mesmo que o card de Faturamento exibe e que
   * bate com o Seller Central.
   *
   * `null`/ausente = a Sales API não respondeu; caímos na soma do banco, que é
   * um PISO do faturamento. Nunca zero.
   */
  faturamentoDoPeriodo?: number | null;
}

export async function getAmazonOverviewFromCanonical(
  period: Period,
  opcoes: OpcoesDoOverview = {},
): Promise<AmazonCanonicalOverview | null> {
  if (!hasDb()) return null;
  const resolved = await resolveConnection();
  if (!resolved) return null;
  const { sellerId, connectionId } = resolved;
  const workspaceId = currentWorkspaceId();

  /**
   * A BASE COBRE TODOS OS PEDIDOS DO PERIODO, ou so os que tem valor proprio?
   *
   * `faturamentoDoPeriodo` vem do `orderMetrics` da Sales API, que e um agregado
   * da propria Amazon e JA INCLUI o pedido pendente. Quando ele existe, a receita
   * do periodo cobre todo mundo — e entao o custo e a tarifa tambem precisam
   * cobrir todo mundo, senao o resultado subtrai de um universo o que pertence a
   * outro. Sem ele, a base e a soma do que o nosso banco sabe valorizar, e o
   * custo e a tarifa acompanham esse conjunto menor.
   *
   * Um so parametro governa os dois lados de proposito: e impossivel corrigir um
   * e esquecer o outro.
   */
  const baseCobreTodosOsPedidos =
    opcoes.faturamentoDoPeriodo != null && opcoes.faturamentoDoPeriodo > 0;

  const [syncRows, totalsRows] = await Promise.all([
    dbQuery<SyncMetaRow>(
      `SELECT covered_from, covered_to
         FROM workspace_marketplace_syncs
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
      [workspaceId, PROVIDER, connectionId]
    ),
    /**
     * TOTAIS DO PERIODO **E** SERIE DIARIA NA MESMA IDA (01/09/2026).
     *
     * Eram duas consultas sobre a MESMA tabela, no MESMO recorte de periodo,
     * diferindo so no nivel de agregacao: uma sem GROUP BY, outra por dia. Isso
     * e exatamente o que `GROUPING SETS` existe para fazer — o banco varre uma
     * vez e devolve os dois niveis.
     *
     * ⚠️ NAO E UM JOIN A MAIS PARA ECONOMIZAR IDA, que e a coisa que o
     * levantamento proibiu. Nenhuma tabela nova entra: e a mesma varredura
     * respondendo duas perguntas. As linhas com `date` preenchido sao a serie;
     * a linha com `date` nulo e o total do periodo.
     *
     * 📌 O LATERAL DAS UNIDADES AGORA RODA PARA CANCELADO TAMBEM, porque o
     * `WHERE` da consulta de totais cobre todos os status. As unidades continuam
     * lidas so com `FILTER (WHERE status = ANY($6))`, entao o numero exibido nao
     * muda — verificado por medicao antes e depois, 1.886 unidades nos dois.
     *
     * 📌 E UM DIA QUE SO TEVE CANCELAMENTO agora aparece na serie com zeros, em
     * vez de faltar. E o mesmo resultado: a serie ja era preenchida com dias
     * zerados logo abaixo, para o grafico da central nao ter buraco.
     */
    dbQuery<TotalsRow & DailyRow>(
      `SELECT to_char(occurred_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS date,
              COUNT(*) FILTER (WHERE status = ANY($6::text[]))::int AS orders,
              SUM(gross) FILTER (WHERE status = ANY($6::text[])) AS revenue,
              COALESCE(SUM(u.units) FILTER (WHERE status = ANY($6::text[])), 0)::int AS units,
              COUNT(*)::int AS total_orders,
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
         FROM workspace_channel_orders o
         LEFT JOIN LATERAL (
           SELECT SUM(i.qty)::int AS units FROM workspace_channel_order_items i
            WHERE i.workspace_id = o.workspace_id AND i.provider = o.provider
              AND i.connection_id = o.connection_id AND i.external_order_id = o.external_order_id
         ) u ON true
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND occurred_at >= $4 AND occurred_at <= $5
        GROUP BY GROUPING SETS ((1), ())`,
      [...scopeParams(connectionId, period), REVENUE_STATUSES]
    ),
  ]);
  const syncRow = syncRows[0];
  // A linha SEM data e o total do periodo; as demais sao a serie diaria.
  //
  // `GROUPING SETS ((1), ())` devolve a linha do nivel total SEMPRE, inclusive
  // com zero pedidos no periodo — o nivel `()` agrega o conjunto vazio e produz
  // uma linha com contagens zeradas. Por isso ela existe por construcao, e a
  // asercao abaixo nao esconde um caso possivel.
  const totals = totalsRows.find((row) => row.date == null) as TotalsRow;
  const dailyRows = totalsRows.flatMap((row) =>
    row.date == null ? [] : [{ date: row.date, revenue: row.revenue, orders: row.orders, units: row.units }],
  );
  // Sem sync algum e sem pedidos no período → nada canônico para servir.
  if (!syncRow && (!totals || totals.total_orders === 0)) return null;

  const [productTotalsRows, recentRows, lineRows, costs] = await Promise.all([
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
         SELECT external_order_id, occurred_at, provider_status, currency, buyer_shipping,
                fulfillment, status
           FROM workspace_channel_orders
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
            AND occurred_at >= $4 AND occurred_at <= $5
            -- O PENDENTE ENTRA NA TABELA DE RENTABILIDADE (01/09/2026).
            --
            -- Antes o filtro era status = ANY($6), que exclui pendente. A
            -- consequencia, medida: das 5.317 estimativas de tarifa gravadas,
            -- UMA chegava a esta lista em 30 dias. A tarifa observada existia no
            -- banco, entrava no total de Taxas, e era invisivel na linha do
            -- pedido — que e onde a vendedora olha pedido a pedido.
            --
            -- A decisao segue a doutrina dela: faturamento inclui pendente, e a
            -- tela mostra o que existe sinalizando o que falta. Esconder o
            -- pendente aqui era a mesma supressao ja tirada do resto.
            --
            -- E a lista de status SAI DOS PARAMETROS desta consulta: quem
            -- separa "conta custo" de "so aparece" agora e o laco, pelo
            -- status_canonico de cada linha (ver a nota la). Deixar o
            -- parametro sem uso faz o Postgres recusar a consulta inteira com
            -- "could not determine data type" — nao e sobra inofensiva.
            AND status <> 'cancelled'
          ORDER BY occurred_at DESC
          LIMIT $6
       )
       SELECT d.external_order_id, d.occurred_at, d.provider_status, d.currency,
              d.buyer_shipping, d.fulfillment, d.status AS status_canonico,
              i.line_no, i.external_product_id, i.sku, i.title, i.qty, i.unit_price,
              ff.amount AS fees
         FROM detailed d
         JOIN workspace_channel_order_items i
           ON i.workspace_id = $1 AND i.provider = $2 AND i.connection_id = $3
          AND i.external_order_id = d.external_order_id
         -- ⚠️ LE A VIEW, E A LISTA NEGRA MORREU AQUI (01/09/2026, ADR-027 II).
         -- Era fee_type NOT IN ('refund','estimated'). Blacklist e modo de falha
         -- invertido: fee_type novo da Amazon entrava somado como tarifa
         -- conhecida, sem ninguem decidir isso. A lista POSITIVA agora vive
         -- dentro da view, num lugar so, e ela ja devolve o real substituindo o
         -- estimado por (pedido, fee_type). E esta troca que faz a linha do
         -- pedido pendente deixar de exibir "Tarifas nao postadas".
         --
         -- (Sem crase neste bloco de proposito: ele mora dentro de um template
         -- literal, e uma crase aqui FECHA a string — foi o que quebrou o build
         -- na primeira versao desta troca.)
         LEFT JOIN LATERAL (
           SELECT SUM(amount) AS amount FROM workspace_channel_order_fees_efetivas f
            WHERE f.workspace_id = $1 AND f.provider = $2 AND f.connection_id = $3
              AND f.external_order_id = d.external_order_id AND f.fee_type IN (${SQL_TARIFAS_QUE_CUSTAM})
         ) ff ON true
        ORDER BY d.occurred_at DESC, d.external_order_id, i.line_no`,
      [...scopeParams(connectionId, period), DETAILED_ORDER_LIMIT]
    ),
    getCosts(),
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

  // ⚠️ A VELOCIDADE SAI DO MESMO RESULTADO DOS TOTAIS POR PRODUTO (01/09/2026).
  //
  // Eram DUAS consultas idênticas — mesmas tabelas, mesmo join, mesmo WHERE,
  // mesmo par de agrupamento (`sku, external_product_id`) — que diferiam só na
  // ORDEM das colunas do GROUP BY. Uma devolvia unidades; a outra, unidades e
  // receita. A segunda já era superconjunto estrito da primeira.
  //
  // Não é consolidação com risco: nenhum join novo, nenhuma mudança de grão. É
  // parar de perguntar duas vezes a mesma coisa.
  const velocityBySku: Record<string, number> = {};
  for (const row of productTotalsRows) {
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

  // ═══ A MARCA DE ESTIMATIVA, POR LINHA DE PEDIDO ════════════════════════════
  //
  // Lida da tabela de estimativas com o grão que ela tem — (pedido, line_no,
  // fee_type). É por isso que a 0022 gravou em grão de linha em vez de pedido:
  // sem `line_no`, um pedido de dois SKUs não teria como dizer QUAL deles está
  // com tarifa estimada.
  //
  // ⚠️ `superseded_at IS NULL`: estimativa já substituída pela oficial não é
  // marca nenhuma — o número daquela linha passou a ser o real. A linha continua
  // no banco para medir pontaria, e é justamente por isso que o filtro precisa
  // estar aqui.
  // ⚠️ NAO E `await` SOLTO: esta consulta corria SOZINHA, entre a montagem das
  // linhas e o laco do lucro, somando uma ida INTEIRA ao caminho critico sem
  // precisar. Ela nao depende de nada que veio antes — so do escopo e do
  // periodo. Virou uma promessa disparada JUNTO e consumida onde e usada.
  //
  // Medido em 01/09/2026 na conta A15NQMF7A6J1Y0, 7 dias: o canonico fazia 18
  // idas e mediana de 335ms. O custo aqui nao era o round-trip em si — era a
  // SERIALIDADE: enquanto esta esperava, nenhuma outra corria.
  const estimativasPorLinhaPromise = dbQuery<{
    external_order_id: string; line_no: number; fee_type: string; amount: string;
    source: string; provider_fee_code: string; unit_price: string;
  }>(
    `SELECT e.external_order_id, e.line_no, e.fee_type, e.amount::text,
            e.source, e.provider_fee_code, e.unit_price::text
       FROM workspace_channel_order_fee_estimates e
       JOIN workspace_channel_orders o
         ON o.workspace_id = e.workspace_id AND o.provider = e.provider
        AND o.connection_id = e.connection_id AND o.external_order_id = e.external_order_id
      WHERE e.workspace_id = $1 AND e.provider = $2 AND e.connection_id = $3
        AND e.superseded_at IS NULL
        AND o.occurred_at >= $4 AND o.occurred_at <= $5`,
    scopeParams(connectionId, period),
  );
  const estimativasPorLinha = await estimativasPorLinhaPromise;
  /**
   * A PROCEDENCIA POR LINHA — o contrato que a tela consome (01/09/2026).
   *
   * `origemDaTarifa` sai da coluna `source`, que a 0022 ja criou. Os dois campos
   * que tornam cada origem VERIFICAVEL sao derivados aqui, sem coluna nova:
   *  - `observadaEm`: a data da observacao, gravada pelo estimador dentro de
   *    `provider_fee_code` como `observada:YYYY-MM-DD`;
   *  - `percentualDaCategoria`: `amount / unit_price`, que so faz sentido para a
   *    origem `tabela` — nas outras fica `null` em vez de um numero sem
   *    significado.
   */
  const marcasPorLinha = new Map<string, {
    comissao: number | null; fba: number | null; temEstimativa: boolean;
    origem: string | null; observadaEm: string | null; percentual: number | null;
  }>();
  for (const linha of estimativasPorLinha) {
    const chave = `${linha.external_order_id}:${linha.line_no}`;
    const atual = marcasPorLinha.get(chave)
      ?? { comissao: null, fba: null, temEstimativa: false, origem: null, observadaEm: null, percentual: null };
    if (linha.fee_type === "commission") atual.comissao = Number(linha.amount);
    if (linha.fee_type === "fulfillment") atual.fba = Number(linha.amount);
    // ⚠️ `temEstimativa` E SEPARADO DAS DUAS COMPONENTES DE PROPOSITO. A marca
    // acendia por `comissao != null || fba != null`, e o estimador da tarifa
    // OBSERVADA grava `fee_type = 'other'` — uma tarifa por unidade, indivisa,
    // porque a observacao vem do extrato ja somada. Resultado: a estimativa
    // existia na tabela, entrava no total de Taxas pela view, e a linha na tela
    // dizia que nao era estimada. Numero estimado sem a marca e pior que numero
    // ausente.
    atual.temEstimativa = true;
    atual.origem = linha.source;
    const observada = /^observada:(\d{4}-\d{2}-\d{2})$/.exec(linha.provider_fee_code ?? "");
    if (observada) atual.observadaEm = observada[1];
    if (linha.source === "tabela") {
      // ⚠️ FRACAO, NAO PERCENTUAL — contrato acordado com a Vitrine em
      // 01/09/2026: 0.1201 para 12,01%, e a conversao acontece num ponto so, na
      // tela. Isto ja saiu daqui como percentual uma vez; a peca dela formatava
      // cru e teria exibido "0,12%".
      //
      // `unit_price` pode ser NULL desde a 0027 (pedido sem valor publicado):
      // `Number(null)` e 0, entao o `> 0` cobre o caso sem ramo extra.
      const preco = Number(linha.unit_price);
      atual.percentual = preco > 0 ? +(Number(linha.amount) / preco).toFixed(4) : null;
    }
    marcasPorLinha.set(chave, atual);
  }
  const marcaDaLinha = (orderId: string, lineNo: number) => {
    const marca = marcasPorLinha.get(`${orderId}:${lineNo}`);
    if (!marca) {
      return {
        feesEstimadas: false, comissaoEstimada: null, fbaEstimada: null,
        origemDaTarifa: null, observadaEm: null, percentualDaCategoria: null,
      };
    }
    return {
      feesEstimadas: marca.temEstimativa,
      comissaoEstimada: marca.comissao,
      fbaEstimada: marca.fba,
      origemDaTarifa: marca.origem,
      observadaEm: marca.observadaEm,
      percentualDaCategoria: marca.percentual,
    };
  };

  let fees = 0;
  let cogs = 0;
  let unitsWithCost = 0;
  let unitsWithoutCost = 0;
  // SKU e a unidade de ACAO da vendedora (ver oQueFaltaNoResultado.ts).
  const skusSemCusto = new Set<string>();
  let processedRevenue = 0;
  /**
   * A COMPOSIÇÃO DO CONCILIADO — o universo do painel "Repasses, taxas e lucro",
   * que declara no próprio subtítulo falar de repasses por data de postagem.
   *
   * ⚠️ O DEFEITO QUE ISTO CONSERTA, no print da vendedora de 02/09/2026: o painel
   * exibia no centro "R$ 12,89 Faturamento conciliado" e, nas fatias, o custo do
   * PERÍODO (R$ 446,50), a tarifa postada e um "Lucro estimado" de R$ 731,27.
   *
   * O 731,27 não era resíduo de nada visível ali: é o lucro DO PERÍODO, e a conta
   * dele fecha noutro card — 1.665,54 (base com pendentes) − 487,77 − 446,50. A
   * subtração literal do painel dava NEGATIVA (12,89 − 58,99 − 446,50 = −492,60)
   * e a margem saía 5673%.
   *
   * É a mesma anatomia do painel da Shopee, corrigida em f88dbb9/c37a8bd: centro
   * de um universo, fatias e resultado de outro. Aqui a distância é maior, e por
   * isso o absurdo aparece — mas o defeito é o mesmo.
   *
   * 📌 E NÃO CUSTA UMA CONSULTA NOVA. A receita, o custo e a tarifa POR LINHA já
   * são calculados neste laço, para a tabela de rentabilidade. Acumular a soma
   * das MESMAS linhas que compõem `processedRevenue` deixa o painel coerente por
   * construção — a alternativa (uma consulta própria restrita aos conciliados)
   * seria uma ida a mais e um segundo lugar onde a definição pode divergir.
   */
  const conciliado = { receita: 0, custo: 0, tarifa: 0, pedidos: new Set<string>() };
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
      // ⚠️ ESTA LISTA NAO SOMA CUSTO — ELA SO EXIBE (01/09/2026).
      //
      // O custo do periodo vem de UMA consulta propria, que cobre TODOS os
      // pedidos nao cancelados do escopo. Esta lista e limitada a
      // `DETAILED_ORDER_LIMIT` pedidos, e por isso nao pode ser fonte de total:
      // seria um numero truncado em silencio.
      //
      // 📌 O DEFEITO QUE ISSO EVITA APARECEU NA HORA, medido: ao incluir o
      // pendente aqui, os pendentes passaram a disputar as vagas do LIMIT e o
      // custo do periodo CAIU R$ 229,81 sem nada ter mudado no mundo — o total
      // encolheu porque a janela de exibicao encolheu. Duas responsabilidades na
      // mesma consulta e a origem da familia inteira; agora sao duas fontes, com
      // papeis declarados: a consulta de custo responde "quanto custou o
      // periodo", esta lista responde "o que aconteceu em cada pedido".

      // O painel do conciliado soma as MESMAS linhas que formam o centro dele:
      // só entra quem tem receita conhecida. Linha sem preço fica fora dos três
      // termos ao mesmo tempo — receita, custo e tarifa —, que é o que mantém a
      // subtração fechando.
      if (lineRevenue != null) {
        conciliado.receita += lineRevenue;
        conciliado.custo += lineProductCost ?? 0;
        conciliado.tarifa += lineFees ?? 0;
        conciliado.pedidos.add(orderId);
      }
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
        // A marca por linha (ADR-027 Emenda II). Vem do grão de linha da tabela
        // de estimativas — é para isso que `line_no` existe lá.
        ...marcaDaLinha(orderId, line.line_no),
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
    dbQuery<{ sku: string | null; external_product_id: string; qty: number; occurred_at: string;
              external_order_id: string; valor_do_pedido: string | null; tarifa_do_pedido: string | null;
              tarifa_estimada_do_pedido: string | null; preco_estimado: string | null }>(
      // ⚠️ `external_order_id`, o VALOR e a TARIFA do pedido entram aqui por causa
      // do universo coerente (04/09/2026) — ver `UNIVERSO COERENTE` mais abaixo.
      // A tarifa vem por subconsulta escalar, nao por join: join com a tabela de
      // tarifas multiplicaria a linha do item e inflaria o custo.
      `SELECT i.sku, i.external_product_id, i.qty, o.occurred_at, o.external_order_id,
              COALESCE(NULLIF(o.gross, 0), o.ordered_gross)::text AS valor_do_pedido,
              (SELECT SUM(f.amount) FROM workspace_channel_order_fees_efetivas f
                WHERE f.workspace_id = o.workspace_id AND f.provider = o.provider
                  AND f.connection_id = o.connection_id AND f.external_order_id = o.external_order_id
                  AND f.fee_type IN (${SQL_TARIFAS_QUE_CUSTAM}))::text AS tarifa_do_pedido,
              -- A parte ESTIMADA da mesma tarifa, para o lucro POR DIA marcar a
              -- coluna como estimativa (ADR-027). Mesma view, mesmo grao: parte
              -- do todo por construcao, nunca soma por cima do total.
              (SELECT SUM(f.amount) FROM workspace_channel_order_fees_efetivas f
                WHERE f.workspace_id = o.workspace_id AND f.provider = o.provider
                  AND f.connection_id = o.connection_id AND f.external_order_id = o.external_order_id
                  AND f.fee_type IN (${SQL_TARIFAS_QUE_CUSTAM}) AND f.basis = 'estimated')::text AS tarifa_estimada_do_pedido,
              -- O PRECO SOBRE O QUAL A TARIFA FOI CALCULADA. E ele que serve de
              -- receita quando a Amazon ainda nao publicou valor: assim receita
              -- e tarifa saem do MESMO preco, que e o que faz a conta fechar.
              (SELECT MAX(e.unit_price) FROM workspace_channel_order_fee_estimates e
                WHERE e.workspace_id = i.workspace_id AND e.provider = i.provider
                  AND e.connection_id = i.connection_id AND e.external_order_id = i.external_order_id
                  AND e.line_no = i.line_no AND e.superseded_at IS NULL)::text AS preco_estimado
         FROM workspace_channel_order_items i
         JOIN workspace_channel_orders o
           ON o.workspace_id = i.workspace_id AND o.provider = i.provider
          AND o.connection_id = i.connection_id AND o.external_order_id = i.external_order_id
        WHERE i.workspace_id = $1 AND i.provider = $2 AND i.connection_id = $3
          AND o.occurred_at >= $4 AND o.occurred_at <= $5
          AND o.status <> 'cancelled'
          -- ⚠️ SÓ O PEDIDO QUE ESTÁ NA BASE ENTRA COM CUSTO (01/09/2026).
          --
          -- Pedido sem valor conhecido fica FORA da receita (é o null != 0 da
          -- base). Se o custo dele entrasse assim mesmo, o resultado teria
          -- subtração de um universo maior que o da receita — a quinta forma do
          -- mesmo defeito, e a mais brutal: medido na Silveiras Import com o
          -- token revogado, base de R$ 12,89 (1 pedido com valor) contra custo
          -- de R$ 222,95 (28 pedidos) dava margem de -1692,4%.
          --
          -- A regra que fecha isso e vale para os quatro canais: CUSTO E TARIFA
          -- SÓ EXISTEM PARA O PEDIDO CUJA RECEITA EXISTE. O que falta é
          -- sinalizado com número, nunca subtraído de uma receita que não tem.
          -- ⚠️ O ESCOPO DO CUSTO ACOMPANHA O ESCOPO DA BASE (01/09/2026) — e
          -- este parametro e a correcao da SETIMA forma do mesmo defeito.
          --
          -- A regra "custo e tarifa so existem para o pedido cuja receita
          -- existe" vale POR UNIVERSO, nao por pedido. Quando a base e o
          -- faturamento injetado pela Sales API, ela JA INCLUI a receita dos
          -- pendentes — o agregado da Amazon os conta. Barrar o custo deles
          -- aqui produz numerador cheio com subtraendo vazio.
          --
          -- Medido na Silveiras Import, tela de Hoje: base R$ 824,64 (31
          -- pedidos) menos tarifa e custo de UM pedido = lucro de R$ 743,76,
          -- 90% do faturamento. Obviamente falso, e foi o que a vendedora
          -- cobrou. A supressao da margem (sexta forma) escondeu o sintoma e
          -- deixou o lucro exposto.
          --
          -- 📌 E O FILTRO CONTINUA VALENDO NO OUTRO CASO. Sem injecao, a base e
          -- o piso do banco, que cobre so o pedido COM valor — e ai o custo tem
          -- de cobrir o mesmo conjunto, senao volta a QUINTA forma (base de
          -- R$ 12,89 contra custo de R$ 222,95, margem de -1692,4%).
          -- Um universo, dois lados. E o parametro que diz qual universo e.
          AND ($6::boolean OR COALESCE(NULLIF(o.gross, 0), o.ordered_gross) IS NOT NULL)`,
      [...scopeParams(connectionId, period), baseCobreTodosOsPedidos],
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
  // ⚠️ A CONSULTA INTEIRA MUDOU DE FONTE (01/09/2026, apply da 0022). Ela lia
  // `workspace_channel_order_fees` com `fee_type = 'estimated'` — linhas que a
  // migration APAGOU. Sem esta troca, `feesEstimadas` viraria 0 para sempre e a
  // marca de estimativa sumiria da tela com a estimativa existindo no banco.
  //
  // A supersessão não é mais reproduzida aqui: quem decide é a view, por
  // (pedido, fee_type). Repetir a regra em dois lugares é como as duas versões
  // divergem — e foi a versão duplicada que estava errada no dia do apply.
  // ═══ UMA IDA PARA AS DUAS PERGUNTAS SOBRE TARIFA (01/09/2026) ══════════════
  //
  // Eram DUAS consultas — o total do período e a parte estimada — na MESMA view,
  // com o MESMO join e o MESMO escopo de conexão, uma esperando a outra. Duas
  // idas ao banco para agregar as mesmas linhas.
  //
  // ⚠️ E JUNTAR EXPÔS UM DEFEITO DE ESCOPO, que é a razão de a fusão valer mais
  // que a ida economizada: as duas NÃO filtravam igual. A do total exigia pedido
  // não cancelado e COM valor na base; a da estimativa não exigia nada disso.
  // Ou seja, `feesEstimadas` contava estimativa de pedido CANCELADO e de pedido
  // fora da base — e a tela podia dizer "inclui R$ X estimados" com X MAIOR que
  // o próprio total de Taxas. Número que não fecha com o vizinho, de novo.
  //
  // Agora as duas saem do mesmo `WHERE`, e a parte é sempre parte do todo por
  // construção. `FILTER` mantém o grão: é a mesma linha contada de dois jeitos,
  // não um join a mais — nenhum risco de inflar por fan-out.
  const tarifaRows = await dbQuery<{ total: string | null; estimada: string | null; pedidos_estimados: number }>(
    `SELECT COALESCE(SUM(f.amount) FILTER (WHERE f.fee_type IN (${SQL_TARIFAS_QUE_CUSTAM})), 0)::text AS total,
            COALESCE(SUM(f.amount) FILTER (WHERE f.fee_type IN (${SQL_TARIFAS_QUE_CUSTAM}) AND f.basis = 'estimated'), 0)::text AS estimada,
            COUNT(DISTINCT f.external_order_id)
              FILTER (WHERE f.fee_type IN (${SQL_TARIFAS_QUE_CUSTAM}) AND f.basis = 'estimated')::int AS pedidos_estimados
       FROM workspace_channel_order_fees_efetivas f
       JOIN workspace_channel_orders o
         ON o.workspace_id = f.workspace_id AND o.provider = f.provider
        AND o.connection_id = f.connection_id AND o.external_order_id = f.external_order_id
      WHERE f.workspace_id = $1 AND f.provider = $2 AND f.connection_id = $3
        AND o.occurred_at >= $4 AND o.occurred_at <= $5
        AND o.status <> 'cancelled'
        -- Mesma regra do custo, e o mesmo parametro: a tarifa cobre o universo
        -- que a base cobre. Com o faturamento injetado, o pendente entra com a
        -- tarifa ESTIMADA (que a view ja substitui pela real na liquidacao);
        -- sem injecao, so entra o pedido com valor proprio.
        AND ($6::boolean OR COALESCE(NULLIF(o.gross, 0), o.ordered_gross) IS NOT NULL)`,
    [...scopeParams(connectionId, period), baseCobreTodosOsPedidos],
  );

  // ═══ O ESTORNO SAI DA TABELA REAL, NAO DA VIEW ══════════════════════════════
  //
  // ⚠️ INCIDENTE DE PRODUCAO, 02/09/2026: este recorte lia `f.posted_at` da view
  // `workspace_channel_order_fees_efetivas`. A migration 0029 adicionou
  // `posted_at` na TABELA; a view foi criada pela 0022 e ficou com a lista de
  // colunas antiga. Medido em producao: 42703 "column f.posted_at does not
  // exist" em TODAS as conexoes e TODOS os periodos — dashboard da Amazon fora
  // do ar desde a v238, inclusive na conta da vendedora e na de demonstracao.
  //
  // 📌 A LICAO, que vale alem deste caso: "quem le isso agora?" — a pergunta
  // obrigatoria antes do apply de uma migration — precisa incluir as VIEWS no
  // meio do caminho. Eu provei que o leitor exigia a coluna, acompanhei o apply,
  // e tratei "a migration foi aplicada" como "o leitor tem a coluna". VIEW NAO
  // HERDA COLUNA DE TABELA: ela congela a lista do dia em que foi criada, e nada
  // fica vermelho — a tabela tem a coluna, o teste do schema passa, e so a
  // consulta que atravessa a view morre.
  //
  // E POR QUE LER A TABELA AQUI E CORRETO, e nao um desvio para destravar:
  // este recorte filtra `fee_type = 'refund'`, e ESTORNO NUNCA E ESTIMATIVA — o
  // CHECK da 0022 recusa 'refund' como fee_type de estimativa, de proposito
  // (procedencia nao pode ocupar o lugar da natureza). A view existe para trocar
  // estimativa por tarifa oficial; sobre a linha de estorno ela nao tem nada a
  // fazer, e o numero e identico ao centavo.
  //
  // 📌 A 0030 FOI APLICADA EM 02/09/2026 e a view voltou a ter `posted_at`
  // (conferido em producao: SELECT posted_at da view responde OK). Ou seja, ler
  // da view voltou a ser POSSIVEL — e mesmo assim esta consulta FICA na tabela,
  // por decisao e nao por inercia:
  //
  //   - o numero e identico (estorno nunca e estimativa, o CHECK da 0022 recusa
  //     'refund' como fee_type de estimativa), entao a troca nao pagaria nada;
  //   - e o grao aqui e melhor: a tabela e a fonte, a view e uma camada a mais
  //     entre o dado e a conta.
  //
  // Voltar para a view seria mexer em codigo que funciona para ficar igual ao
  // que era antes do incidente. Registrado para a proxima pessoa nao achar que
  // isto aqui e resto de conserto esquecido.
  const estornoRows = await dbQuery<{ estorno: string | null; estorno_n: number; estorno_com_data: number }>(
    `SELECT COALESCE(SUM(f.amount) FILTER (
              WHERE COALESCE(f.posted_at, o.occurred_at) >= $4
                AND COALESCE(f.posted_at, o.occurred_at) <= $5), 0)::text AS estorno,
            COUNT(*) FILTER (
              WHERE COALESCE(f.posted_at, o.occurred_at) >= $4
                AND COALESCE(f.posted_at, o.occurred_at) <= $5)::int AS estorno_n,
            -- Quantos estornos JA tem data propria — e o que permite a tela
            -- dizer qual data usou, em vez de o COALESCE decidir em silencio.
            COUNT(*) FILTER (WHERE f.posted_at IS NOT NULL)::int AS estorno_com_data
       FROM workspace_channel_order_fees f
       JOIN workspace_channel_orders o
         ON o.workspace_id = f.workspace_id AND o.provider = f.provider
        AND o.connection_id = f.connection_id AND o.external_order_id = f.external_order_id
      WHERE f.workspace_id = $1 AND f.provider = $2 AND f.connection_id = $3
        AND f.fee_type = 'refund'
        AND o.occurred_at >= $4 AND o.occurred_at <= $5
        AND o.status <> 'cancelled'
        AND ($6::boolean OR COALESCE(NULLIF(o.gross, 0), o.ordered_gross) IS NOT NULL)`,
    [...scopeParams(connectionId, period), baseCobreTodosOsPedidos],
  );
  const feesEstimadas = Number(tarifaRows[0]?.estimada ?? 0);
  const pedidosComTarifaEstimada = tarifaRows[0]?.pedidos_estimados ?? 0;

  // ═══ A BASE É O FATURAMENTO, E SÓ ELE (31/08/2026, quarta vez que ela pede) ══
  //
  // *"TEM QUE ESQUECER O APURADO E LEVAR EM CONSIDERAÇÃO SOMENTE O FATURAMENTO."*
  //
  // A soma do banco é o PISO: ela só enxerga os pedidos cujo valor a Amazon já
  // publicou. O número que a tela mostra — e que bate com o Seller Central — é o
  // `orderMetrics`, injetado por quem tem credencial. Quando ele existe, é ele.
  //
  // ⚠️ Medido na conta A15NQMF7A6J1Y0 em 31/08/2026, 23:16: o piso do banco dava
  // R$ 551,13 enquanto o card exibia R$ 1.017,98. O lucro rodava sobre 551,13 e
  // as tarifas e o custo vinham dos 53 pedidos inteiros — numerador de um
  // universo com subtrações de outro, que é o defeito na sua QUARTA forma.
  // 1.017,98 − 281,95 − 282,02 é POSITIVO; a tela mostrava −40,40.
  /**
   * ⚠️ SEM O FATURAMENTO INJETADO, A BASE E `null` — NAO O PISO DO BANCO
   * (01/09/2026). Antes ela caia silenciosamente na soma do que o banco sabe
   * valorizar, e o consumidor nao tinha como distinguir "faturamento do periodo"
   * de "o pouco que conseguimos somar".
   *
   * 📌 O QUE ISSO EVITA, medido no mesmo dia: das CINCO rotas que chamam este
   * produtor, UMA injeta (a do dashboard). As outras quatro — order-profitability,
   * radar, sales, top-products — recebiam o objeto `profit` completo com a base
   * do piso: R$ 12,89 onde o faturamento real era R$ 824,64, indistinguivel da
   * base boa. Nenhuma delas RENDERIZA margem hoje, entao nao havia numero errado
   * na tela; mas a diferenca estava disponivel, esperando a primeira peca nova.
   *
   * `null` obriga quem for exibir a decidir o que fazer com a ausencia — que e a
   * regra da casa: `null` != `0`, e desconhecido nao vira numero por conveniencia.
   * O piso continua sendo medido logo abaixo, com nome proprio, para quem quiser
   * a soma do banco sabendo que e ela.
   */
  const somaDoQueOBancoValoriza = Number(faturamentoRows[0]?.receita ?? 0);
  const faturamentoDoLucro = baseCobreTodosOsPedidos
    ? (opcoes.faturamentoDoPeriodo as number)
    : null;
  /**
   * ⚠️ DOIS NOMES QUE NAO MENTEM, no lugar de um que mentia (01/09/2026).
   *
   * O campo se chamava `pedidosNaBase` e contava TODO pedido nao cancelado do
   * periodo — inclusive os que a base nao consegue valorizar. O nome afirmava
   * uma pertinencia que ninguem verificava: na conta A15NQMF7A6J1Y0 ele dizia
   * 31 enquanto UM pedido tinha valor proprio.
   *
   * Quem calculasse ticket medio como `base / pedidosNaBase` cairia na familia
   * inteira de novo — numerador de um universo, denominador de outro —, desta vez
   * com o nome do campo garantindo que estava certo. Renomear e o conserto de
   * CAUSA; a supressao da margem, que veio antes, era o do sintoma.
   */
  const pedidosDoPeriodo = faturamentoRows[0]?.pedidos ?? 0;
  const pedidosComValor = pedidosDoPeriodo - (faturamentoRows[0]?.sem_valor ?? 0);
  // Pedidos que a Amazon ainda não valorizou POR PEDIDO. Eles ENTRAM na base
  // (o `orderMetrics` já os conta) e não têm custo nem tarifa nossa — então a
  // tela SINALIZA isso ao lado, com número, e a base não encolhe. Regra dela de
  // 29/08: *"o user sabe o que está cadastrado; se tem venda e não tem custo,
  // fica apontado lá"*. Encolher a base para "proteger" o número é justamente o
  // que ela mandou parar de fazer.
  const pedidosSemValor = faturamentoRows[0]?.sem_valor ?? 0;

  // Custo do pendente pela MESMA regra do apurado: custo cadastrado vigente na
  // data da compra. Unidade sem custo cadastrado conta em `unitsWithoutCost` e
  // vira sinal na tela — o custo que falta é cadastro dela, e a regra de 29/08
  // é mostrar o número e apontar o que falta, não apagar o resultado.
  // O CUSTO DO PERIODO INTEIRO, de uma fonte so — apurado e pendente pela mesma
  // regra: custo cadastrado vigente na data da compra.
  let cogsDoPeriodo = 0;
  for (const linha of pendenteLinhas) {
    const entrada = costOf(linha.sku, linha.external_product_id);
    const custoUnitario = entrada ? costAt(entrada, new Date(linha.occurred_at).toISOString()) : 0;
    if (custoUnitario > 0) {
      cogsDoPeriodo += custoUnitario * linha.qty;
      unitsWithCost += linha.qty;
    } else {
      unitsWithoutCost += linha.qty;
      skusSemCusto.add(linha.sku ?? linha.external_product_id ?? "");
    }
  }

  // ⚠️ O ESTORNO VOLTOU A TER CONSULTA PROPRIA (02/09/2026), e nao por gosto:
  // ele precisa de `posted_at`, que existe na TABELA e nao na view. A fusao de
  // 01/09 economizava uma ida; mante-la custava o dashboard inteiro. Uma ida a
  // mais e barata, dashboard fora do ar nao e.
  //
  // ⚠️ E ELE PASSOU A OBEDECER A MESMA REGRA DE ESCOPO do custo e da tarifa:
  // estorno de pedido que NAO esta na base (cancelado, ou sem valor conhecido)
  // deixa de reduzir um lucro calculado sobre a base. Subtrair devolucao de uma
  // receita que nao esta na conta era a mesma familia do defeito das cinco
  // bases, na linha do estorno.
  //
  // ⚠️ E `refundCount` MUDOU DE GRAO, de linha de tarifa para linha da view
  // (pedido x tipo x moeda). MEDIDO ANTES DE TROCAR, 30 dias na conta
  // A15NQMF7A6J1Y0: 13 linhas de tarifa e 13 linhas da view, R$ 254,03 nos dois
  // — identicos, porque a Amazon posta um estorno por pedido. Se um dia postar
  // dois, a contagem passa a ser de PEDIDOS, que e o que a frase da tela diz
  // ("N devolucao(oes)"). A troca foi conferida, nao presumida.
  //
  // `0` e fato ("nao houve devolucao no periodo"), nao ausencia.
  const refunds = Number(estornoRows[0]?.estorno ?? 0);
  const refundCount = estornoRows[0]?.estorno_n ?? 0;

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
  void somaDoQueOBancoValoriza; // medida e nomeada; nenhum consumidor a usa como base
  /**
   * ═══ UNIVERSO COERENTE — o denominador do LUCRO e da MARGEM ═══════════════
   *
   * ⚠️ DEFEITO QUE ISTO CORRIGE (04/09/2026), achado pela vendedora com a
   * planilha na mao: a tela exibia **43,7% de margem** enquanto a planilha dela
   * dava 16–20% por pedido. A conta era
   *
   *   receita de TODOS (orderMetrics, 21 pedidos, R$ 592,68)
   *   − tarifa dos que a gente conhece (17)
   *   − custo dos que a gente conhece (17)
   *
   * Numerador de um universo, denominador de outro — a sexta forma da mesma
   * familia, agora pelo lado da COBERTURA: os 4 pedidos que so existem no
   * agregado da Amazon somavam receita e nao subtraiam nada.
   *
   * 📌 "Somar so o conhecido" vale POR COMPONENTE — e e por isso que Taxas e
   * Custo continuam mostrando a soma de tudo que se conhece, cada card no seu
   * universo declarado. Mas a EQUACAO do resultado tem de fechar num universo
   * so (ADR-028), igual ao "resultado da receita paga" do ML.
   *
   * ⚠️ E O CRITERIO DA RECEITA E DELA, ajustado no mesmo dia depois que ela
   * refez a planilha: **pedido sem valor publicado NAO sai do resultado.** Ele
   * tem preco de anuncio, custo e tarifa calculada — o que falta e so o numero
   * OFICIAL. Excluir esses pedidos jogaria fora venda real; a receita deles e o
   * PRECO DE TABELA, o mesmo sobre o qual a tarifa foi calculada, e por isso a
   * conta fecha.
   *
   * O universo e, entao: pedido com CUSTO cadastrado e TARIFA conhecida, com
   * receita = valor publicado ou, na falta dele, preco de tabela. Fica de fora
   * so o pedido sem custo — que e cadastro dela e ja tem apontamento proprio.
   *
   * Conferido contra a planilha dela (04/09/2026, 17 pedidos): receita
   * R$ 410,28, tarifa R$ 149,01, custo R$ 186,43, imposto 5% R$ 20,51 ->
   * **lucro R$ 54,33**. Sem aliquota configurada: R$ 74,84.
   */
  const porPedido = new Map<string, { valor: number | null; tabela: number; tarifa: number | null; custo: number; temCusto: boolean; dia: string; tarifaEstimada: boolean }>();
  for (const linha of pendenteLinhas) {
    const id = linha.external_order_id;
    if (!porPedido.has(id)) {
      porPedido.set(id, {
        valor: linha.valor_do_pedido == null ? null : Number(linha.valor_do_pedido),
        tabela: 0,
        tarifa: linha.tarifa_do_pedido == null ? null : Number(linha.tarifa_do_pedido),
        custo: 0,
        temCusto: true,
        // O DIA CIVIL do pedido, no mesmo fuso da serie diaria — e a chave que
        // liga este universo coerente ao lucro por dia.
        dia: brazilDateKey(new Date(linha.occurred_at)),
        tarifaEstimada: linha.tarifa_estimada_do_pedido != null && Number(linha.tarifa_estimada_do_pedido) > 0,
      });
    }
    const alvo = porPedido.get(id)!;
    // Preço de tabela da linha: o MESMO sobre o qual a tarifa foi calculada.
    const precoEstimado = linha.preco_estimado == null ? null : Number(linha.preco_estimado);
    if (precoEstimado != null && precoEstimado > 0) alvo.tabela += precoEstimado * linha.qty;
    const entrada = costOf(linha.sku, linha.external_product_id);
    const custoUnitario = entrada ? costAt(entrada, new Date(linha.occurred_at).toISOString()) : 0;
    // ⚠️ Uma unica linha sem custo cadastrado tira o PEDIDO do resultado: metade
    // do custo com a receita inteira e o mesmo vies que este bloco existe para
    // matar. O pedido engrossa o apontamento de cadastrar custo, que ja existe —
    // e cadastro e dela, nao dado do canal (doutrina de 23/08).
    if (custoUnitario > 0) alvo.custo += custoUnitario * linha.qty;
    else alvo.temCusto = false;
  }
  let baseCoerente = 0, tarifaCoerente = 0, custoCoerente = 0, pedidosCompletos = 0;
  for (const pedido of porPedido.values()) {
    if (!pedido.temCusto || pedido.tarifa == null) continue;
    // A RECEITA: valor publicado quando existe; preco de tabela quando nao.
    const receita = pedido.valor != null ? pedido.valor : (pedido.tabela > 0 ? pedido.tabela : null);
    if (receita == null) continue;
    baseCoerente += receita;
    tarifaCoerente += pedido.tarifa;
    custoCoerente += pedido.custo;
    pedidosCompletos += 1;
  }
  const baseDoResultado = pedidosCompletos > 0 ? +baseCoerente.toFixed(2) : null;

  const cogsDoLucro = +cogsDoPeriodo.toFixed(2);
  void cogs; // segue alimentando o rateio POR LINHA, nunca o total do periodo
  // O imposto acompanha a base, e não a receita apurada — ver a nota na leitura
  // da alíquota, acima.
  // Sem base nao ha imposto calculavel: `null`, nunca zero — zero afirmaria
  // isencao, que e fato diferente de "nao sei sobre o que incidir".
  // ⚠️ O IMPOSTO ACOMPANHA A BASE DO RESULTADO, nao o faturamento inteiro: ele
  // e componente da MESMA equacao, e incidir sobre uma receita que nao esta na
  // conta reintroduziria a mistura por outro caminho.
  const taxes = baseDoResultado == null ? null : amazonTaxAmount(baseDoResultado, taxRate);
  // A tarifa da conta é a REAL mais a ESTIMADA — sem a estimada, a receita do
  // pendente entraria sem custo de canal e o lucro inflaria: medido em 31/08,
  // a margem ia a 93,2% justamente por isso. Trocar um número enviesado para
  // cima por outro enviesado para baixo é o que este passo existe para evitar.
  // ⚠️ `fees + feesEstimadas` VIROU DUPLA CONTAGEM EM 01/09/2026, e é o tipo de
  // defeito que só aparece quando duas mudanças certas se encontram.
  //
  // `fees` acumula o total POR PEDIDO da consulta detalhada, e aquela consulta
  // passou a ler a view `..._efetivas` — que já devolve real E estimado. Somar
  // `feesEstimadas` por cima contaria a estimativa dos pedidos apurados duas
  // vezes. Cada troca estava certa sozinha; juntas, erravam.
  //
  // A soma do período agora vem da PRÓPRIA VIEW, para todos os pedidos não
  // cancelados — os apurados e os pendentes, que a consulta detalhada não
  // alcança. Uma pergunta, uma fonte. `feesEstimadas` continua existindo, mas só
  // para a tela DIZER quanto do total é estimativa (ADR-027 item 4).
  const tarifaDoLucro = +Number(tarifaRows[0]?.total ?? 0).toFixed(2);
  void fees; // segue alimentando o rateio POR LINHA, não o total do período
  // Sem base nao ha resultado: `null` em vez de um lucro medido contra uma
  // receita que este produtor nao conhece.
  // ⚠️ RECEITA, TARIFA E CUSTO SAO OS DO UNIVERSO COERENTE — nunca mais o
  // faturamento inteiro contra a tarifa e o custo de um subconjunto.
  //
  // 📌 O ANUNCIO e do PERIODO, nao do pedido, e por isso e descontado inteiro —
  // mesma escolha do "resultado da receita paga" do ML. Ele nao tem como ser
  // rateado por pedido sem inventar atribuicao.
  const lucro = descontarAnuncio(
    baseDoResultado == null
      ? null
      : +(baseDoResultado - tarifaCoerente - custoCoerente - (taxes ?? 0) - refunds).toFixed(2),
    anuncio,
  );
  const estimatedProfit = lucro.estimatedProfit;

  // ═══ LUCRO POR DIA (contrato com a Vitrine, 12/09/2026) ═════════════════════
  //
  // A garantia e a do v3 do ML — `0` e fato, `null` e desconhecido e vira
  // contorno — com os mecanismos DESTE canal (regra da dona: replicar a
  // garantia, nunca o mecanismo):
  //   - a tarifa do dia sai da view efetivas (real OU estimada ADR-027), e o
  //     dia com estimativa dentro ganha `profitEstimated: true` — o "lucro
  //     estimado marcado" que a Ana aprovou;
  //   - o imposto segue a excecao ADR-038 do periodo (aliquota ausente = 0 com
  //     rastro em `taxRateKnown`), NAO a regra do ML (null) — e a regra do canal;
  //   - o lucro da Amazon desconta ANUNCIO (25/08). Dia sem gasto conhecido
  //     (depois de `adsAteDia`, com o canal dentro da janela viva de coleta)
  //     e dia NAO apuravel — o mesmo motivo que anula o lucro do periodo;
  //   - o ESTORNO entra no dia do LANCAMENTO (`posted_at`), nao no do pedido, e
  //     sai tambem como `refunds` para a dica explicar barra derrubada por
  //     venda de semanas atras (pedido da Vitrine, item a do contrato).
  //
  // O universo e o MESMO `porPedido` do resultado do periodo — uma fonte, duas
  // agregacoes — para a soma dos dias fechar com a faixa quando tudo apurar.
  const [estornoPorDiaRows, adsPorDia] = await Promise.all([
    dbQuery<{ dia: string; estorno: string }>(
      `SELECT to_char(COALESCE(f.posted_at, o.occurred_at) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dia,
              COALESCE(SUM(f.amount), 0)::text AS estorno
         FROM workspace_channel_order_fees f
         JOIN workspace_channel_orders o
           ON o.workspace_id = f.workspace_id AND o.provider = f.provider
          AND o.connection_id = f.connection_id AND o.external_order_id = f.external_order_id
        WHERE f.workspace_id = $1 AND f.provider = $2 AND f.connection_id = $3
          AND f.fee_type = 'refund'
          AND o.occurred_at >= $4 AND o.occurred_at <= $5
          AND COALESCE(f.posted_at, o.occurred_at) >= $4
          AND COALESCE(f.posted_at, o.occurred_at) <= $5
          AND o.status <> 'cancelled'
          AND ($6::boolean OR COALESCE(NULLIF(o.gross, 0), o.ordered_gross) IS NOT NULL)
        GROUP BY 1`,
      [...scopeParams(connectionId, period), baseCobreTodosOsPedidos],
    ),
    gastoDeAnuncioPorDia(PROVIDER, period.startISO, period.endISO),
  ]);
  const estornoPorDia = new Map(estornoPorDiaRows.map((r) => [r.dia, Number(r.estorno)]));

  // A decisao dia a dia mora em `lucroPorDiaDaAmazon.ts`, PURA de proposito:
  // e la que os testes exercitam as fronteiras com valores fabricados.
  const dailySalesComLucro = lucroPorDiaDaAmazon({
    pontos: dailySales,
    pedidos: porPedido.values(),
    estornoPorDia,
    anuncio: {
      jaNoExtrato: anuncio.jaNoExtrato,
      primeiroDia: adsPorDia.primeiroDia,
      ateDia: adsPorDia.ateDia,
      gastoPorDia: adsPorDia.gastoPorDia,
    },
    taxRate,
  });

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
    dailySales: dailySalesComLucro,
    topProducts,
    profit: {
      revenueProcessed: +processedRevenue.toFixed(2),
      /**
       * As fatias e o fluxo do painel "Repasses, taxas e lucro", TODOS no
       * universo do conciliado. O lucro e o RESIDUO deste universo e a margem
       * sai sobre o proprio centro — ver a nota longa em `conciliado`.
       */
      composicaoDoConciliado: {
        receita: +conciliado.receita.toFixed(2),
        custo: +conciliado.custo.toFixed(2),
        tarifa: +conciliado.tarifa.toFixed(2),
        pedidos: conciliado.pedidos.size,
        lucro: +(conciliado.receita - conciliado.custo - conciliado.tarifa).toFixed(2),
        margemPct: conciliado.receita > 0
          ? +(((conciliado.receita - conciliado.custo - conciliado.tarifa) / conciliado.receita) * 100).toFixed(2)
          : null,
      },
      /** A base que o LUCRO usa: apurado + pendente valorizado pela Amazon. */
      revenueDoLucro: receitaDoLucro,
      pedidosDoPeriodo,
      pedidosComValor,
      pedidosSemValor,
      fees: tarifaDoLucro,
      /** Quanto de `fees` é estimativa da Product Fees API, não tarifa postada. */
      feesEstimadas: +feesEstimadas.toFixed(2),
      pedidosComTarifaEstimada,
      cogs: cogsDoLucro,
      /** A base do RESULTADO — so os pedidos com preco, tarifa e custo conhecidos. */
      baseDoResultado,
      /** Quantos pedidos compoem `baseDoResultado`. A tela declara os dois. */
      pedidosCompletos,
      estimatedProfit,
      taxRate,
      /**
       * ⚠️ O RASTRO DA EXCECAO (ADR-038). `false` = o imposto e zero porque
       * ninguem cadastrou aliquota; `true` = zero porque ela declarou 0%.
       * As duas contas sao IDENTICAS — este booleano e a unica diferenca, e e
       * por isso que a tela nao pode derivar a pendencia de `taxRate == null`:
       * no dia em que alguem cadastrar 0 de verdade, aquele rastro se apaga.
       */
      taxRateKnown: taxRate != null,
      taxes,
      refunds: +refunds.toFixed(2),
      refundCount,
      ads: lucro.ads,
      adsDesconhecido: lucro.adsDesconhecido,
      adsAteDia: lucro.ateDia,
      /**
       * TACOS sobre o faturamento do lucro (`receitaDoLucro`) — nunca
       * `paid_revenue`. `lucro.ads` ja e o gasto pos-extrato (0 quando o
       * anuncio ja veio como tarifa; null quando desconhecido), entao a
       * garantia do tacosDoPeriodo — nunca mentir para baixo — atravessa.
       */
      tacos: tacosDoPeriodo({
        gasto: lucro.ads,
        faturamento: receitaDoLucro,
        pedidosSemValor,
      }),
      tacosAteDia: lucro.ateDia,
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
export function getAmazonOverviewCanonicalCached(
  period: Period,
  opcoes: OpcoesDoOverview = {},
): Promise<AmazonCanonicalOverview | null> {
  // ⚠️ A BASE ENTRA NA CHAVE DO CACHE, e isso não é zelo.
  //
  // O radar, o top-products e a rentabilidade chamam esta função SEM base (eles
  // não leem lucro). Se a chave ignorasse a base, a primeira dessas chamadas
  // gravaria no cache um overview com o piso do banco, e o DASHBOARD leria esse
  // resultado — voltando a exibir lucro sobre a base apurada por caminho
  // indireto, de forma intermitente e dependente de quem chegou primeiro. É a
  // pior versão do defeito: some quando se vai procurar.
  const base = opcoes.faturamentoDoPeriodo != null && opcoes.faturamentoDoPeriodo > 0
    ? opcoes.faturamentoDoPeriodo.toFixed(2)
    : "piso-do-banco";
  return cached(
    `amazon-overview-canonical:${cacheScope()}:${period.key}:${base}`,
    60_000,
    () => getAmazonOverviewFromCanonical(period, opcoes),
  );
}
