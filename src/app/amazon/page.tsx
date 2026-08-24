"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RevenueChart, type DailyPoint } from "../components/RevenueChart";
import { PageHeader, pageIcons } from "../components/PageHeader";
import { InlineLoading } from "../components/LoadingState";
import { LegendaDeVendas } from "../components/LegendaDeVendas";
import { EmptyState } from "../components/EmptyState";
import { DashboardPeriodFilter, useDashboardPeriod } from "../components/DashboardPeriodFilter";
import type { OperationPendingItem } from "../components/OperationPending";
import { Metric as Kpi, CompactMetric, getRevenueTrend } from "../components/Metric";
import { amazonFinancialCards } from "./amazonFinancialCards";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { OrderProfitabilityTable } from "../components/OrderProfitabilityTable";
import { ConnectionBroken, isBrokenConnection } from "../components/ConnectionBroken";
import { TopProductsRanking } from "../components/TopProductsRanking";
import { buildFinancialComposition, FinancialSummaryPanel } from "../components/FinancialSummaryPanel";
import { BriefingLead } from "../components/BriefingLead";
import { nomeDaTarifa } from "@/lib/nomeDaTarifa";
import { IntegrationDashboardFrame } from "../components/IntegrationDashboardFrame";
import { marginMetricTone } from "@/lib/marginTone";

/**
 * Cobertura do cálculo de rentabilidade, como a API devolve. É objeto, não
 * texto: `scopeNote` da tabela espera uma frase, então precisa ser formatado
 * antes de chegar lá (renderizar o objeto cru derruba a página inteira).
 */
interface ProfitabilityScope {
  processedOrders: number;
  completePeriod: boolean;
}

function scopeSentence(scope?: ProfitabilityScope): string | undefined {
  if (!scope) return undefined;
  if (scope.completePeriod) return undefined; // período completo: texto padrão da tabela serve
  return `Detalhamento processado em ${scope.processedOrders} venda(s) do período — o histórico ainda está sendo importado.`;
}
import type { ProfitabilityLine } from "@/lib/profitability";
import { brDate, brTime } from "@/lib/datetime";
import { readJson } from "../../lib/readJson";

const PRIMARY_FINANCIAL_CARDS = new Set(["revenue", "fees", "cogs", "profit", "marginPct"]);

function money(v: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);
}

interface OrdersData {
  metrics: { totalOrders: number; totalRevenue: number; currency: string; fbaOrders: number; pendingItems: number };
  orders: {
    amazonOrderId: string;
    purchaseDate: string;
    orderStatus: string;
    orderTotal?: { CurrencyCode: string; Amount: string };
  }[];
}
interface ProfitData {
  finance: {
    revenue: number; fees: number; refunds: number; netProceeds: number; currency: string;
    orderCount: number; units: number; daily: DailyPoint[];
    /** Cupom bancado pela vendedora, já abatido de `revenue`. */
    promotions?: number;
    /** Frete que o comprador pagou de fato. */
    buyerShipping?: number;
    /** Cada tarifa nomeada, para a cascata não esconder o que compõe "Taxas Amazon". */
    feeBreakdown?: { type: string; amount: number }[];
  };
  cogs: number;
  estimatedProfit: number;
  unitsWithoutCost: number;
  taxRate?: number | null;
  taxes?: number | null;
}
interface SaldoData {
  currency: string;
  disponivel: number | null;
  retido: number;
  liberacoes: { date: string; amount: number; orderIds: string[] }[];
  extratoDesde: string | null;
  seraCobrado: boolean;
}
interface RadarRow {
  sellerSku: string;
  productName?: string;
  fulfillable: number;
  daysRemaining: number | null;
  status: string;
}
interface ProductRow {
  id: string;
  cost: number | null;
}
// Faturamento e vendas vêm da Sales API (orderMetrics, data do pedido) para
// BATER com o "Vendas brutas" do Seller Central. O lado financeiro (taxas,
// repasse, lucro) vem das transações — base diferente, como as abas Vendas e
// Pagamentos do próprio Seller Central.
interface SalesSeries {
  currency: string;
  points: DailyPoint[];
  totalRevenue: number;
  totalOrders: number;
  totalUnits: number;
}
interface TopProduct {
  sku: string;
  title?: string;
  units: number;
  revenue: number;
  marginPct: number | null;
}


// Payload da rota agregadora /api/amazon/dashboard (ADR-017): uma chamada
// devolve a tela inteira, lida do banco canônico. As interfaces acima seguem
// sendo o contrato interno da página — aqui só o mapeamento de chegada.
interface DashboardPayload {
  covered: boolean;
  currency: string;
  /** Faturamento bruto do período — espelha o painel do canal (ADR-020). */
  billing: {
    revenue: number;
    orders: number;
    ordersWithValue?: number;
    /**
     * Cupom resgatado no período — o que explica "Pedidos feitos" ser MAIOR que
     * "Faturamento". `null` = período sem pedido conciliado, e a linha some.
     */
    coupon?: number | null;
    /** Há pedidos sem preço de tabela: o cupom é um PISO, não o total exato. */
    couponPartial?: boolean;
  };
  /**
   * Pedidos feitos, pela Sales API: inclui pendentes, EXCLUI cancelados, e
   * valoriza a preço de tabela (antes do cupom resgatado).
   *
   * Medido em 22/08/2026, janela de 30 dias — `orderMetrics` e o relatório
   * All Orders devolvem o mesmo R$ 449,94, decomposto assim:
   *   360,99 pago pelos 14 enviados + 16,83 de cupom + 72,12 dos 3 pendentes.
   * O Seller Central mostra R$ 516,27 porque soma também os 2 cancelados
   * (R$ 66,33) — e esse valor a Amazon NÃO devolve em nenhuma API: pedido
   * cancelado vem com `quantity 0` e preço vazio no relatório e no
   * `getOrderItems`. Por isso a paridade com o Seller Central é impossível,
   * não é defeito nosso. Ver docs/api-amazon-sp-api.md.
   *
   * `null` = a Sales API não respondeu; omitir é melhor que zerar.
   */
  ordered: { revenue: number; orders: number; units: number; points: DailyPoint[] } | null;
  /**
   * Canceladas: somadas no bruto, exibidas à parte — mesmo padrão do ML.
   * `revenue` nulo = valor desconhecido (a Amazon omite `OrderTotal` no que
   * cancela ainda em `Pending`), nunca zero.
   */
  cancelled: { revenue: number | null; orders: number };
  metrics: { totalOrders: number; paidOrders: number; fbaOrders: number; revenue: number };
  dailySales: Array<{ date: string; revenue: number; orders: number; units: number }>;
  topProducts: Array<{ sku: string; title: string; units: number; revenue: number; marginPct: number | null }>;
  profit: { revenueProcessed: number; fees: number; cogs: number; estimatedProfit: number; unitsWithCost: number; unitsWithoutCost: number; coverage?: { processedOrders: number; paidOrders: number; complete: boolean } };
  finance: ProfitData["finance"];
  profitabilityLines: ProfitabilityLine[];
  profitabilityScope?: ProfitabilityScope;
  recentOrders: OrdersData["orders"];
  radar: RadarRow[] | null;
  durationMs: number;
}

interface DashSnapshot {
  orders: OrdersData | null;
  profit: ProfitData | null;
  radar: RadarRow[];
  sales: SalesSeries | null;
  top: TopProduct[];
  profitability: ProfitabilityLine[];
  profitabilityScope?: ProfitabilityScope;
  updatedAt: Date;
}

// Escopo de módulo: sobrevive à navegação entre canais. Ao voltar, o período
// já visto renderiza no primeiro paint e a revalidação roda em segundo plano.
const dashCache = new Map<string, DashSnapshot>();
let productsCache: ProductRow[] | null = null;

/**
 * A legenda do cartão de Faturamento.
 *
 * A Amazon não informa o valor de pedido `Pending`, então existe pedido real sem
 * valor no período. Somar zero e contar um produz "R$ 0,00 · 1 pedido" — a
 * contradição que a vendedora flagrou em 22/08/2026. Aqui a legenda nomeia o
 * estado: quantos pedidos ainda não têm valor, em vez de escondê-los na contagem.
 */
function legendaFaturamento(
  f: { revenue: number; orders: number; ordersWithValue?: number } | null,
  fallback: number
): string {
  const pedidos = f?.orders ?? fallback;
  const comValor = f?.ordersWithValue;
  const plural = (n: number) => `${n} ${n === 1 ? "pedido" : "pedidos"}`;
  if (comValor === undefined || comValor === pedidos) return `${plural(pedidos)} no período`;
  const semValor = pedidos - comValor;
  // Nenhum tem valor ainda: dizer o motivo, não mostrar zero seco.
  if (comValor === 0) {
    return `${plural(pedidos)} — a Amazon ainda não informou o valor`;
  }
  return `${plural(pedidos)} · ${semValor} ainda sem valor informado`;
}

export default function Dashboard() {
  const period = useDashboardPeriod();
  const [initialDash] = useState(() => dashCache.get(period.query));
  const [loading, setLoading] = useState(!initialDash);
  const [orders, setOrders] = useState<OrdersData | null>(initialDash?.orders ?? null);
  const [profit, setProfit] = useState<ProfitData | null>(initialDash?.profit ?? null);
  const [radar, setRadar] = useState<RadarRow[]>(initialDash?.radar ?? []);
  const [products, setProducts] = useState<ProductRow[]>(productsCache ?? []);
  const [sales, setSales] = useState<SalesSeries | null>(initialDash?.sales ?? null);
  const [top, setTop] = useState<TopProduct[]>(initialDash?.top ?? []);
  const [profitability, setProfitability] = useState<ProfitabilityLine[]>(initialDash?.profitability ?? []);
  // Cobertura da conciliação: quantos pedidos pagos já viraram linhas conciliadas.
  // É o que permite à seção "Financeiro conciliado" DIZER que está parcial em vez
  // de exibir um número menor que o faturamento sem explicação (20/08/2026).
  const [conciliacao, setConciliacao] = useState<{ processedOrders: number; paidOrders: number; complete: boolean } | null>(null);
  // Faturamento do período — o MESMO número que a central mostra. Antes o card
  // exibia a receita conciliada (subconjunto), e por isso três telas do produto
  // mostravam três valores diferentes de "faturamento" (20/08/2026).
  const [faturamento, setFaturamento] = useState<DashboardPayload["billing"] | null>(null);
  // O número que ela confere contra o Seller Central. Sem ele na tela, a conta
  // era feita à mão — e foi assim que apareceram os defeitos de 21/08.
  const [pedidosFeitos, setPedidosFeitos] = useState<{ revenue: number; orders: number; units: number; points: DailyPoint[] } | null>(null);
  // Canceladas entram no bruto (ADR-020); mostrar à parte é o que impede o número
  // de parecer inflado sem explicação — o ML já fazia, a Amazon não tinha.
  const [canceladas, setCanceladas] = useState<{ revenue: number | null; orders: number; ordersWithValue?: number; ordersEstimated?: number } | null>(null);
  const [profitabilityScope, setProfitabilityScope] = useState<ProfitabilityScope | undefined>(initialDash?.profitabilityScope);
  const [saldo, setSaldo] = useState<SaldoData | null>(null);
  const [profitabilityLoading, setProfitabilityLoading] = useState(!initialDash);
  const [productsLoading, setProductsLoading] = useState(!productsCache);
  const [errors, setErrors] = useState<string[]>([]);
  const [brokenConnection, setBrokenConnection] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(initialDash?.updatedAt ?? null);

  const periodQuery = period.query;

  useEffect(() => {
    let active = true;
    const cached = dashCache.get(periodQuery);
    Promise.resolve().then(() => {
      if (!active) return;
      if (cached) {
        setOrders(cached.orders);
        setProfit(cached.profit);
        setRadar(cached.radar);
        setSales(cached.sales);
        setTop(cached.top);
        setProfitability(cached.profitability);
        setProfitabilityScope(cached.profitabilityScope);
        setProfitabilityLoading(false);
        setUpdatedAt(cached.updatedAt);
        setLoading(false);
      } else {
        setLoading(true);
        setProfitabilityLoading(true);
      }
    });
    const next: Omit<DashSnapshot, "updatedAt"> = {
      orders: cached?.orders ?? null,
      profit: cached?.profit ?? null,
      radar: cached?.radar ?? [],
      sales: cached?.sales ?? null,
      top: cached?.top ?? [],
      profitability: cached?.profitability ?? [],
      profitabilityScope: cached?.profitabilityScope,
    };
    const store = () => dashCache.set(periodQuery, { ...next, updatedAt: new Date() });
    const errs: string[] = [];
    // Guarda o motivo de autorização à parte: ele merece tratamento próprio
    // (reconectar), e não entra na lista genérica de "não carregou".
    let broken: string | null = null;
    const safe = <T,>(url: string, set: (v: T) => void, pick: (d: unknown) => T, name: string) =>
      fetch(url)
        .then((r) => readJson(r).then((d) => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          if (!ok) {
            const info = (d as { errorInfo?: { code?: string }; error?: string });
            if (isBrokenConnection(info?.errorInfo?.code)) {
              broken = info.error ?? null;
              throw new Error("auth");
            }
            throw new Error(info?.error || name);
          }
          if (active) set(pick(d));
        })
        .catch(() => {
          if (!broken) errs.push(name);
        });

    // Uma tela = uma chamada (ADR-017): a rota agregadora devolve pedidos,
    // financeiro, vendas, estoque, top e rentabilidade num payload só, lido do
    // banco canônico — a SP-API saiu do caminho interativo.
    safe<DashboardPayload>(`/api/amazon/dashboard?${periodQuery}`, (payload) => {
      const orders: OrdersData = {
        metrics: {
          totalOrders: payload.metrics.totalOrders,
          totalRevenue: payload.metrics.revenue,
          currency: payload.currency,
          fbaOrders: payload.metrics.fbaOrders,
          // O canônico não separa "itens pendentes" (era um subproduto da
          // paginação ao vivo). Zero aqui é honesto: a lista de recentes mostra
          // o status real de cada pedido.
          pendingItems: 0,
        },
        orders: payload.recentOrders,
      };
      const profit: ProfitData = {
        finance: payload.finance,
        cogs: payload.profit.cogs,
        estimatedProfit: payload.profit.estimatedProfit,
        unitsWithoutCost: payload.profit.unitsWithoutCost,
      };
      // O gráfico se chama "pedidos recebidos", então tem de contar pedido
      // recebido — incluindo o que ainda está `pending`. A série canônica só tem
      // aprovadas, e por isso um pedido feito às 21:12 aparecia como dia zerado.
      // Quando o orderMetrics responde, é ele que manda; se falhar, cai no
      // canônico e o rótulo abaixo passa a dizer "confirmado".
      const sales: SalesSeries = payload.ordered
        ? {
            currency: payload.currency,
            points: payload.ordered.points,
            totalRevenue: payload.ordered.revenue,
            totalOrders: payload.ordered.orders,
            totalUnits: payload.ordered.units,
          }
        : {
            currency: payload.currency,
            points: payload.dailySales,
            totalRevenue: payload.metrics.revenue,
            totalOrders: payload.metrics.paidOrders,
            totalUnits: payload.dailySales.reduce((sum, d) => sum + d.units, 0),
          };
      next.orders = orders; setOrders(orders);
      next.profit = profit; setProfit(profit);
      next.sales = sales; setSales(sales);
      if (payload.radar) { next.radar = payload.radar; setRadar(payload.radar); }
      next.top = payload.topProducts; setTop(payload.topProducts);
      next.profitability = payload.profitabilityLines; setProfitability(payload.profitabilityLines);
      setConciliacao(payload.profit.coverage ?? null);
      setFaturamento(payload.billing ?? null);
      setPedidosFeitos(payload.ordered ?? null);
      setCanceladas(payload.cancelled ?? null);
      next.profitabilityScope = payload.profitabilityScope; setProfitabilityScope(payload.profitabilityScope);
    }, (d) => d as DashboardPayload, "dashboard").then(() => {
      if (active) {
        setErrors(errs);
        setBrokenConnection(broken);
        setUpdatedAt(new Date());
        setLoading(false);
        setProfitabilityLoading(false);
        store();
      }
    });

    // Produtos e top produtos usam o relatório da Amazon (lento) — carregam em separado.
    if (!productsCache) Promise.resolve().then(() => active && setProductsLoading(true));
    safe<ProductRow[]>(`/api/products`, (v) => { productsCache = v; setProducts(v); }, (d) => (d as { products: ProductRow[] }).products, "produtos").finally(
      () => active && setProductsLoading(false)
    );
    // Saldo NÃO leva `periodQuery`: é o estado de agora, não do período escolhido.
    safe<SaldoData | null>(`/api/amazon/balance`, (v) => setSaldo(v), (d) => d as SaldoData | null, "saldo");

    return () => {
      active = false;
    };
  }, [periodQuery]);

  const currency = profit?.finance.currency || orders?.metrics.currency || "BRL";
  const critical = radar.filter((r) => r.status === "critical" || r.status === "out");
  const noCost = products.filter((p) => p.cost == null || p.cost === 0).length;
  const pendencias = useAmazonPendencias({ products: products.length, productsLoading, missingCosts: noCost });
  // Faturamento/vendas/unidades pela Sales API (data do pedido) = Seller Central.
  const revenue = sales?.totalRevenue ?? orders?.metrics.totalRevenue ?? 0;
  const salesCount = sales?.totalOrders ?? orders?.metrics.totalOrders ?? 0;
  const unitsCount = sales?.totalUnits ?? 0;
  const estProfit = profit?.estimatedProfit ?? 0;
  const cogs = profit?.cogs ?? 0;
  const missingCostUnits = profit?.unitsWithoutCost ?? 0;
  const costsIncomplete = missingCostUnits > 0;
  /** Cupom resgatado pelo comprador — já abatido de `revenue` pela camada financeira. */
  const promocoes = profit?.finance.promotions ?? 0;
  // O financeiro vem das transações, que a Amazon posta na data de POSTAGEM —
  // uma venda recém-feita já conta no faturamento e ainda não tem repasse.
  // Repasse ausente é desconhecido, não zero: exibir "R$ 0,00 / 0,0% de margem"
  // afirmaria que a venda não deu lucro.
  const hasFinance =
    !!profit &&
    (profit.finance.orderCount > 0 ||
      profit.finance.units > 0 ||
      profit.finance.netProceeds !== 0 ||
      profit.finance.fees !== 0 ||
      profit.finance.refunds !== 0);
  // Ticket e faturamento têm de sair da MESMA base. `revenue`/`salesCount` vêm do
  // orderMetrics (data do pedido, preço de tabela, inclui pendente); o card de
  // Faturamento mostra o conciliado. Misturar os dois exibia R$ 39,80 de
  // faturamento ao lado de um ticket de R$ 21,67 — que é 108,34/5, de um total
  // que não está em lugar nenhum da tela. O ticket real é 39,80/2 = R$ 19,90.
  const vendasConciliadas = profit?.finance.orderCount ?? 0;
  const faturamentoConciliado = profit?.finance.revenue ?? 0;
  // Decisão dela (22/08): sem base, o cartão mostra R$ 0,00 em vez de "—".
  // Antes disso, porém, tenta o número REAL: quando ainda não há venda conciliada
  // mas o período tem faturamento (pendente com valor de tabela), o ticket existe
  // e é faturamento ÷ vendas — mostrar zero ali seria esconder um número que temos.
  const ticketMedio =
    vendasConciliadas > 0
      ? faturamentoConciliado / vendasConciliadas
      : (faturamento?.revenue ?? 0) > 0 && salesCount > 0
        ? (faturamento?.revenue ?? 0) / salesCount
        : 0;
  // Quanto dos pedidos recebidos a Amazon ainda não confirmou. As duas bases só
  // podem ser subtraídas no MESMO critério: `revenue` (orderMetrics) é preço de
  // tabela, então o conciliado precisa voltar ao bruto somando o cupom.
  const pedidosAguardando = Math.max(0, salesCount - vendasConciliadas);
  const valorAguardando = Math.max(0, revenue - (faturamentoConciliado + promocoes));
  const roiPct = cogs > 0 ? (estProfit / cogs) * 100 : 0;
  const revenueTrend = getRevenueTrend(sales?.points ?? []);

  return (
    <IntegrationDashboardFrame
      className="dashboard-page amazon-dashboard"
      period={<DashboardPeriodFilter
        {...period.filterProps}
        meta={updatedAt ? <>Atualizado às {brTime(updatedAt)}</> : undefined}
      />}
      header={<PageHeader
        eyebrow="Operação Amazon"
        title="Resumo financeiro"
        subtitle="Faturamento, pedidos e resultado do período selecionado."
        icon={pageIcons.dashboard}
      />}
    >
      <div className="dashboard-sections integration-dashboard-sections">
      {/* A leitura executiva abre todos os canais antes das métricas. */}
      <BriefingLead
        periodo={period.label}
        faturamento={faturamento?.revenue ?? null}
        pedidos={faturamento?.orders ?? 0}
        lucro={profit?.estimatedProfit ?? null}
        loading={loading}
        format={(v) => money(v, currency)}
        escopo="amazon"
        canalNome="Amazon"
        moeda={currency}
        briefingHref="/amazon/briefing"
        // Uma pergunta, um lugar. As pendências de conta e de sincronização
        // vêm do hook; estoque crítico vem do radar já carregado nesta tela.
        acoes={[
          ...pendencias.map((p) => ({ ...p, tone: "pendencia" as const })),
          ...(critical.length > 0
            ? [{ label: `${critical.length} produto(s) com estoque crítico`, href: "/amazon/estoque", tone: "alerta" as const }]
            : []),
        ]}
      />

      {brokenConnection && <ConnectionBroken channel="amazon" message={brokenConnection} />}

      {errors.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          Não foi possível carregar: {errors.join(", ")}.
        </div>
      )}

      {/* A primeira faixa contém somente os indicadores que resumem o resultado.
          O detalhamento continua abaixo, na composição financeira, sem perder
          nenhuma distinção entre zero e dado ainda desconhecido. */}
      {(() => {
        const cards = amazonFinancialCards({
          finance: profit?.finance ?? null,
          cogs: profit?.cogs ?? 0,
          estimatedProfit: profit?.estimatedProfit ?? 0,
          unitsWithoutCost: profit?.unitsWithoutCost ?? 0,
          taxRate: profit?.taxRate ?? null,
          taxes: profit?.taxes ?? null,
        });
        const margem = cards.find((c) => c.key === "marginPct");
        const primaryCards = cards.filter((card) => PRIMARY_FINANCIAL_CARDS.has(card.key));
        return (
          <div className="metric-grid" aria-label="Resumo financeiro da Amazon">
            {primaryCards.map((card) =>
              // O bloco de lucro era markup próprio: rótulo 11px maiúsculo,
              // valor 27px e um fundo verde, tudo escrito à mão dentro desta
              // página. Numa faixa contínua ele virava um bloco colorido no
              // meio de nada, e o `overflow: hidden` sobre 132px de largura
              // CORTAVA o valor no meio ("R$ 222,9").
              //
              // Agora usa o `Metric` como todos os outros. O lucro continua se
              // distinguindo — pela cor do número (`tone="positive"`), que é
              // informação, e não pelo fundo, que era decoração.
              card.key === "profit" ? (
                <Kpi
                  key={card.key}
                  label={costsIncomplete ? "Repasse líquido" : "Lucro"}
                  tone={card.tone}
                  loading={loading}
                  value={card.raw != null
                    ? <AnimatedNumber id="amz-profit" value={card.raw} format={(amount) => money(amount, currency)} />
                    : card.value}
                  sub={card.value === "—" || margem?.value === "—"
                    ? card.context
                    : `${margem?.value} de margem sobre vendas`}
                />
              ) : (
                <Kpi
                  key={card.key}
                  label={card.label}
                  value={loading ? "…" : card.key === "revenue" && (faturamento || card.raw != null)
                    ? <AnimatedNumber id="amz-revenue" value={faturamento?.revenue ?? card.raw ?? 0} format={(amount) => money(amount, currency)} />
                    : card.value}
                  // O selo de tendência ("novo ritmo") só faz sentido no faturamento.
                  sub={card.key === "revenue"
                    // O subtítulo tem de acompanhar a base do VALOR. O valor soma
                    // só quem tem `gross`; a contagem inclui pendente sem valor —
                    // e emparelhar os dois produzia "R$ 0,00 · 1 pedido", que se
                    // contradiz na própria linha (22/08/2026). Quando há pedido
                    // sem valor, o subtítulo DIZ isso em vez de fingir coerência.
                    ? legendaFaturamento(faturamento, salesCount)
                    : card.context}
                  // O "i" do Faturamento explica a BASE — é o que separa este
                  // número do "Pedidos feitos" logo abaixo.
                  info={
                    card.key === "revenue" && (faturamento?.coupon ?? 0) > 0
                      ? `O que o comprador pagou, já sem ${money(faturamento?.coupon ?? 0, currency)} de cupom.`
                      : undefined
                  }
                  trend={card.key === "revenue" ? revenueTrend : undefined}
                  tone={card.key === "marginPct" ? marginMetricTone(card.raw) : card.tone}
                  loading={loading}
                />
              )
            )}
          </div>
        );
      })()}

      {/* Indicadores de contexto: uma faixa, não uma segunda parede de cartões. */}
      <div className="secondary-metrics" aria-label="Indicadores complementares">
        {/*
          Os dois números lado a lado, cada um com nome próprio.
          "Confirmado" é o que o comprador já pagou; "Pedidos feitos" é o que a
          Sales API conta — pendente entra, cancelado não, e a preço de tabela.
          Antes a tela mostrava só o primeiro, sem dizer que era só o primeiro — e
          conferir a diferença exigia somar pedido a pedido no painel da Amazon.
        */}
        <CompactMetric
          label="Pedidos feitos"
          value={
            pedidosFeitos
              ? `${money(pedidosFeitos.revenue, currency)} · ${pedidosFeitos.orders}`
              : "—"
          }
          info={
            pedidosFeitos
              ? "Preço de tabela, antes do cupom. É o número do Seller Central."
              : undefined
          }
          loading={loading}
        />
        {/*
          CUPOM — a ponte entre os dois números acima. "Pedidos feitos" vem a
          preço de tabela e "Faturamento" é o que o comprador pagou; sem esta
          linha a diferença ficava sem nome na tela e ela conferia à mão contra o
          Seller Central (22/08: R$ 449,94 lá contra R$ 455,01 aqui, em 15 dias).
          Só aparece quando houve cupom — período sem resgate não ganha um card
          de R$ 0,00 ocupando a faixa.
        */}
        {(faturamento?.coupon ?? 0) > 0 && (
          <CompactMetric
            label="Cupom resgatado"
            value={`− ${money(faturamento?.coupon ?? 0, currency)}`}
            // Fecha a conta na tela: este é EXATAMENTE o valor que separa
            // "Pedidos feitos" de "Faturamento". Sem dizer isso, o número fica
            // solto e a pessoa não liga um card ao outro.
            // Só afirma a igualdade quando ela SE SUSTENTA: numa conta com
            // pedidos sem preço de tabela, este valor é piso, não a diferença.
            info={
              faturamento?.couponPartial
                ? "Apurado só nos pedidos com preço de tabela importado — pode haver mais."
                : "A diferença entre Pedidos feitos e Faturamento."
            }
            loading={loading}
          />
        )}
        <CompactMetric label="Vendas" value={String(salesCount)} loading={loading} />
        <CompactMetric label="Unidades" value={String(unitsCount)} loading={loading} />
        <CompactMetric label="Ticket médio" value={money(ticketMedio, currency)} loading={loading} />
        <CompactMetric
          label="ROI"
          value={`${roiPct.toFixed(1)}%`}
          tone={cogs > 0 ? (roiPct > 0 ? "positive" : roiPct < 0 ? "danger" : "default") : "default"}
          loading={loading}
        />
        <CompactMetric
          label="Canceladas"
          // A Amazon ZERA o pedido ao cancelar — some o OrderTotal, some a
          // quantidade, some do orderMetrics. Testado nas quatro fontes em
          // 22/08/2026. O valor só existe se foi capturado antes (migrations/0010,
          // relatório ALL_ORDERS, que é a única fonte que precifica pendente).
          //
          // Daí os três estados, e o do meio é o que quase virou bug: com 160
          // cancelados e 1 com valor, exibir só a soma afirmaria que os 160
          // custaram R$ 89,70. Cobertura parcial tem que aparecer como parcial.
          // SEM cancelamento no período, R$ 0,00 é FATO — "não houve" — e é o que
          // ela pediu ver (22/08). O "—" ali sugeria "não sei", que é pior.
          // Só continua desconhecido quando EXISTE cancelado e a Amazon não
          // informou o valor de nenhum deles: aí zero seria afirmar que cancelar
          // não custou nada, e isso a legenda abaixo explica.
          value={
            !canceladas || canceladas.orders === 0
              ? money(0, currency)
              : canceladas.revenue === null
                ? "—"
                : money(canceladas.revenue, currency)
          }
          tone={canceladas && canceladas.orders > 0 ? "danger" : "default"}
          loading={loading}
        />
      </div>

      {/* Uma única superfície explica desempenho e composição financeira. */}
      <section className="performance-panel">
        <div className="performance-chart">
          <div className="mb-2 flex items-baseline justify-between gap-4">
            <div>
              <p className="section-kicker">Desempenho diário</p>
              {/* NÃO chamar de "faturamento": este total é o orderMetrics (data do
                  pedido, preço de tabela, inclui pendente) e é maior que o card
                  de Faturamento, que mostra o conciliado. Dois números com o
                  mesmo nome na mesma tela era o que confundia. */}
              <h2 className="mt-1 text-lg font-semibold text-[var(--ink)]">Evolução das vendas</h2>
            </div>
            <span className="text-sm font-semibold tabular-nums text-[var(--ink)]">
              {money(revenue, currency)}{" "}
              <span className="font-normal text-[var(--ink-muted)]">
                {pedidosFeitos ? "em pedidos recebidos" : "confirmado (pedidos recebidos indisponível)"}
              </span>
            </span>
          </div>
          {/* Regras e armadilhas moram no componente — ele é o mesmo nos quatro
              canais. O que é da Amazon é só a `nota`. */}
          {!loading && (
            <LegendaDeVendas
              confirmados={{ pedidos: vendasConciliadas, valor: faturamentoConciliado }}
              aguardando={{ pedidos: pedidosAguardando, valor: valorAguardando }}
              cancelados={{ pedidos: canceladas?.orders ?? 0 }}
              nota="A Amazon confirma o pagamento antes de informar o valor, e só libera o repasse depois da entrega."
              money={(valor) => money(valor, currency)}
            />
          )}
          {loading ? (
            <span className="skeleton-chart" role="status" aria-label="Carregando evolução das vendas" />
          ) : (
            <RevenueChart points={sales?.points ?? []} currency={currency} explorable />
          )}
        </div>

        <FinancialSummaryPanel
          complete={!costsIncomplete && conciliacao?.complete !== false}
          labelledBy="amazon-financial-summary-title"
          description={(
            <>
              <span>Base dos repasses da Amazon (data de postagem) — difere do faturamento acima, que segue a data do pedido como o Seller Central.</span>
              {conciliacao && !conciliacao.complete ? (
                <span className="mt-2 block rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                  {conciliacao.paidOrders - conciliacao.processedOrders} pedido(s) ainda sem repasse postado pela Amazon. Os valores desta seção sobem conforme ela posta.
                </span>
              ) : null}
            </>
          )}
          total={loading ? 0 : faturamentoConciliado}
          totalLabel="Faturamento conciliado"
          format={(value) => money(value, currency)}
          slices={buildFinancialComposition({
            total: faturamentoConciliado,
            costs: [
              ...(profit?.finance.feeBreakdown ?? []).map((fee) => ({ id: fee.type, label: nomeDaTarifa(fee.type), value: fee.amount })),
              { id: "cogs", label: "Custo dos produtos", value: costsIncomplete ? null : profit?.cogs },
            ],
            result: costsIncomplete ? null : profit?.estimatedProfit,
          })}
          empty={!loading && !hasFinance ? (
            // Sem transação postada não há cascata: zerar receita, taxas e lucro
            // faria a tela afirmar que a venda não rendeu nada.
            <p className="text-sm leading-relaxed text-[var(--ink-muted)]">
              A Amazon ainda não postou repasse deste período. As vendas já aparecem no faturamento
              (data do pedido); taxas e lucro entram aqui quando o pedido é postado e liquidado.
            </p>
          ) : undefined}
        >
              {/* O cupom é dedução de verdade — sai do bolso dela e merece o "−",
                  como qualquer custo. Mas `revenue` já vem líquido dele, então
                  descontá-lo do líquido contaria duas vezes. A cascata parte do
                  preço de tabela, desconta, e FECHA num subtotal igual ao card
                  de Faturamento — a ponte que faltava entre os dois números. */}
              {promocoes > 0 ? (
                <>
                  <Flow label="Faturamento (preço de tabela)" value={loading ? "…" : money(faturamentoConciliado + promocoes, currency)} />
                  <Flow label="Cupons e promoções" value={loading ? "…" : money(promocoes, currency)} muted sign="−" />
                  <Flow label="Faturamento líquido" value={loading ? "…" : money(faturamentoConciliado, currency)} subtotal sign="=" />
                </>
              ) : (
                <Flow label="Faturamento" value={loading ? "…" : money(faturamentoConciliado, currency)} />
              )}
              <Flow label="Taxas Amazon" value={loading ? "…" : money(profit?.finance.fees ?? 0, currency)} muted sign="−" />
              {!loading && (profit?.finance.feeBreakdown ?? []).map((t) => (
                <Flow key={t.type} label={nomeDaTarifa(t.type)} value={money(t.amount, currency)} detail muted />
              ))}
              <Flow label="Custo dos produtos" value={loading ? "…" : money(profit?.cogs ?? 0, currency)} muted sign="−" />
              <Flow
                label={costsIncomplete ? "Repasse líquido" : "Lucro estimado"}
                value={loading ? "…" : money(profit?.estimatedProfit ?? 0, currency)}
                accent
                tone={costsIncomplete || loading
                  ? "default"
                  : (profit?.estimatedProfit ?? 0) > 0
                    ? "positive"
                    : (profit?.estimatedProfit ?? 0) < 0
                      ? "danger"
                      : "default"}
                sign="="
              />
              {!loading && (profit?.finance.revenue ?? 0) > 0 && (
                <Flow
                  label="Margem"
                  value={`${(((profit?.estimatedProfit ?? 0) / (profit?.finance.revenue || 1)) * 100).toFixed(1).replace(".", ",")}%`}
                  accent
                  tone={costsIncomplete
                    ? "default"
                    : marginMetricTone(((profit?.estimatedProfit ?? 0) / (profit?.finance.revenue || 1)) * 100)}
                />
              )}
        </FinancialSummaryPanel>
      </section>

      {/* O ranking ocupa a mesma posição em todos os canais: depois da leitura
          temporal e antes dos módulos operacionais de detalhe. */}
      {productsLoading ? (
        <div className="top-products-loading">
          <InlineLoading label="Carregando produtos com melhor desempenho" />
        </div>
      ) : top.length === 0 ? (
        <div className="top-products-loading"><Empty>Sem vendas no período para ranquear.</Empty></div>
      ) : (
        <TopProductsRanking products={top} currency={currency} productsHref="/amazon/produtos" />
      )}

      {/* Logo abaixo da cascata: é a mesma conversa sobre dinheiro, e responde a
          pergunta que o lucro sozinho deixa no ar — "então cadê?". */}
      {saldo && <SaldoNaAmazon saldo={saldo} />}

      {/* Duas colunas: alertas de estoque + pedidos recentes */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Panel title="Estoque crítico" href="/amazon/estoque" linkLabel="Ver radar">
          {loading ? (
            <InlineLoading label="Carregando estoque crítico" />
          ) : critical.length === 0 ? (
            <Empty>Nenhum SKU em ruptura iminente.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {critical.slice(0, 6).map((r) => (
                <li key={r.sellerSku} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="min-w-0 truncate pr-3">{r.productName || r.sellerSku}</span>
                  <span className="shrink-0 font-semibold text-red-600">
                    {r.status === "out" ? "esgotado" : `${r.daysRemaining} dias`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Pedidos recentes" href="/amazon/monitor?secao=vendas" linkLabel="Ver todos os pedidos">
          {loading ? (
            <InlineLoading label="Carregando pedidos recentes" />
          ) : !orders || orders.orders.length === 0 ? (
            <Empty>Nenhum pedido no período.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {orders.orders.slice(0, 6).map((o) => (
                <li key={o.amazonOrderId} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs text-[var(--ink-muted)]">
                      {o.amazonOrderId}
                    </span>
                    <span className="text-xs text-[var(--ink-muted)]">
                      {brDate(o.purchaseDate)} · {o.orderStatus}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {o.orderTotal
                      ? money(parseFloat(o.orderTotal.Amount), o.orderTotal.CurrencyCode)
                      : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Rentabilidade por venda — a mesma visão do monitor, direto no dashboard. */}
      <OrderProfitabilityTable
        lines={profitability}
        loading={profitabilityLoading}
        scopeNote={scopeSentence(profitabilityScope)}
        pageSize={6}
      />

      {/* Atalhos: no desktop a sidebar já cobre; no mobile os cartões ajudam. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:hidden">
        <QuickLink href="/amazon/calculadora" label="Calculadora" desc="Lucro por ASIN" />
        <QuickLink href="/amazon/monitor" label="Monitor" desc="Vendas e financeiro" />
        <QuickLink href="/amazon/estoque" label="Radar" desc="Estoque × velocidade" />
        <QuickLink href="/amazon/produtos" label="Produtos" desc="Custos por SKU" />
      </div>
      </div>
    </IntegrationDashboardFrame>
  );
}




// A Transactions API nomeia cada tarifa em inglês. "Taxas Amazon" somava tudo num
// número só e a pergunta "qual taxa é essa?" não tinha resposta na tela.
// Tipo desconhecido aparece com o nome original — nunca some nem vira "Outras".

function Flow({
  label,
  value,
  muted,
  accent,
  tone = "default",
  sign,
  detail,
  subtotal,
}: {
  detail?: boolean;
  label: string;
  value: string;
  muted?: boolean;
  accent?: boolean;
  tone?: "default" | "positive" | "danger" | "warn";
  sign?: "−" | "=";
  /** Fecha um trecho da cascata sem ser o resultado final (que é verde). */
  subtotal?: boolean;
}) {
  return (
    <div className={`financial-line ${accent ? `is-result is-result-${tone}` : ""} ${subtotal ? "is-subtotal" : ""}`}>
      <span className="financial-sign" aria-hidden="true">{sign}</span>
      <p className={detail ? "pl-3 text-xs text-[var(--ink-muted)]" : "text-xs font-medium text-[var(--ink-muted)]"}>{label}</p>
      <p
        className={`tabular-nums ${detail ? "text-xs text-[var(--ink-muted)]" : "text-sm font-bold"} ${
          accent
            ? tone === "positive"
              ? "text-[var(--positive)]"
              : tone === "danger"
                ? "text-[var(--danger)]"
                : tone === "warn"
                  ? "text-[var(--warning)]"
                : "text-[var(--ink)]"
            : muted && !detail
              ? "text-[var(--ink-soft)]"
              : detail
                ? ""
                : "text-[var(--ink)]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * Saldo e liberação. Existe porque o dashboard dizia "lucro R$ 20,04" enquanto o
 * app da Amazon dizia "Fundos disponíveis: −R$ 6,12" — os dois certos, e a
 * pessoa sem entender qual acreditar. A Amazon retém o valor das vendas até
 * depois da entrega, então o saldo só enxerga as despesas até lá.
 */
function SaldoNaAmazon({ saldo }: { saldo: SaldoData }) {
  const [todasLiberacoes, setTodasLiberacoes] = useState(false);
  const proxima = saldo.liberacoes[0];
  const liberacoesVisiveis = todasLiberacoes ? saldo.liberacoes : saldo.liberacoes.slice(0, 6);
  const temMaisLiberacoes = saldo.liberacoes.length > liberacoesVisiveis.length;
  return (
    <section className="saldo-panel" aria-labelledby="saldo-title">
      <div>
        <p className="section-kicker">Saldo na Amazon</p>
        <h2 id="saldo-title" className="mt-1 text-lg font-semibold text-[var(--ink)]">O que você tem hoje</h2>
      </div>
      <div className="saldo-grid">
        <div className={`saldo-card${saldo.seraCobrado ? " is-cobranca" : ""}`}>
          <span>Disponível agora</span>
          {/* Sem extrato devolvido não há saldo a afirmar — R$ 0,00 diria que não
              há nada nem a receber nem a pagar, e isso é um fato, não um vazio. */}
          <strong>{saldo.disponivel == null ? "—" : money(saldo.disponivel, saldo.currency)}</strong>
          <small>
            {saldo.disponivel == null
              ? "Aguardando o extrato da Amazon"
              : saldo.seraCobrado
              ? "Negativo: a Amazon cobra no fechamento do extrato"
              : "Liberado para transferência"}
          </small>
        </div>
        <div className="saldo-card">
          <span>Retido pela Amazon</span>
          <strong>{money(saldo.retido, saldo.currency)}</strong>
          <small>{proxima ? `Primeira liberação em ${brDate(proxima.date)}` : "Nenhuma venda retida"}</small>
        </div>
      </div>
      {saldo.liberacoes.length > 0 && (
        <div className="saldo-liberacoes-wrap">
          <ol className="saldo-liberacoes">
            {liberacoesVisiveis.map((l) => (
              <li key={l.date}>
                <span>{brDate(l.date)}</span>
                <strong>{money(l.amount, saldo.currency)}</strong>
                <small>{l.orderIds.length} {l.orderIds.length === 1 ? "pedido" : "pedidos"}</small>
              </li>
            ))}
          </ol>
          {(temMaisLiberacoes || todasLiberacoes) && (
            <button
              type="button"
              className="saldo-liberacoes-toggle"
              aria-expanded={todasLiberacoes}
              onClick={() => setTodasLiberacoes((atual) => !atual)}
            >
              {todasLiberacoes
                ? "Mostrar apenas as próximas liberações"
                : `Ver todas as ${saldo.liberacoes.length} liberações`}
            </button>
          )}
        </div>
      )}
      <p className="saldo-nota">
        A Amazon retém o valor de cada venda até depois da entrega — por isso o saldo disponível pode
        estar negativo enquanto o lucro do período é positivo.
        {saldo.extratoDesde && ` Extrato aberto desde ${brDate(saldo.extratoDesde)}.`}
      </p>
    </section>
  );
}

function Panel({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="work-panel border-t border-[var(--line-strong)] py-5">
      <div className="mb-3 flex items-center justify-between border-b border-[var(--line)] pb-3">
        <h2 className="text-[13px] font-semibold text-[var(--ink-soft)]">{title}</h2>
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:gap-1.5 hover:text-blue-700"
        >
          {linkLabel}
          <span aria-hidden>→</span>
        </Link>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <EmptyState compact title={String(children)} />;
}

function QuickLink({ href, label, desc }: { href: string; label: string; desc: string }) {
  return (
    <Link
      href={href}
      className="quick-command group flex items-center justify-between border-t border-[var(--line-strong)] py-4"
    >
      <div>
        <p className="text-sm font-semibold text-[var(--ink)]">{label}</p>
        <p className="text-xs text-[var(--ink-muted)]">{desc}</p>
      </div>
      <span className="text-[var(--ink-faint)] transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-blue-500">
        →
      </span>
    </Link>
  );
}

/**
 * Pendências da Amazon como HOOK, não como bloco.
 *
 * Era um componente que renderizava a própria faixa "Pendências da operação".
 * Quando o `BriefingLead` passou a listar o que exige ação, as duas coisas
 * apareceram na tela dizendo "cadastre o custo de 1 produto" com 60px de
 * distância — a mesma pendência, duas vezes.
 *
 * Devolver a LISTA em vez de renderizar resolve na origem: existe um só lugar
 * que responde "o que precisa de mim?", e quem decide como mostrar é a
 * abertura do painel. O componente `OperationPending` continua no repo e em
 * uso nas telas que ainda não têm abertura própria.
 */
function useAmazonPendencias({ products, productsLoading, missingCosts }: { products: number; productsLoading: boolean; missingCosts: number }): OperationPendingItem[] {
  const [connection, setConnection] = useState<"loading" | "connected" | "missing">("loading");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch("/api/auth/accounts")
        .then((res) => readJson(res).then((data) => ({ ok: res.ok, data })))
        .then(({ ok, data }) => setConnection(ok && (data.hasOwnerToken || data.accounts?.length > 0) ? "connected" : "missing"))
        .catch(() => setConnection("missing"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (connection === "loading") return [];

  const items: OperationPendingItem[] = [];
  if (connection === "missing") items.push({ label: "Conectar a conta Amazon", href: "/integracoes" });
  if (connection === "connected" && !productsLoading && products === 0) items.push({ label: "Sincronizar os produtos da Amazon", href: "/amazon/produtos" });
  if (products > 0 && missingCosts > 0) items.push({ label: `Cadastrar custo de ${missingCosts} produto(s)`, href: "/amazon/produtos" });

  return items;
}
