"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RevenueChart, type DailyPoint } from "../components/RevenueChart";
import { PageHeader, pageIcons } from "../components/PageHeader";
import { InlineLoading } from "../components/LoadingState";
import { EmptyState } from "../components/EmptyState";
import { DashboardPeriodFilter, useDashboardPeriod } from "../components/DashboardPeriodFilter";
import { OperationPending, type OperationPendingItem } from "../components/OperationPending";
import { Metric as Kpi, getRevenueTrend } from "../components/Metric";
import { amazonFinancialCards } from "./amazonFinancialCards";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { OrderProfitabilityTable } from "../components/OrderProfitabilityTable";
import { ConnectionBroken, isBrokenConnection } from "../components/ConnectionBroken";

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

    // Chamadas rápidas — controlam o "loading" do dashboard.
    Promise.all([
      safe<OrdersData>(`/api/orders?${periodQuery}`, (v) => { next.orders = v; setOrders(v); }, (d) => d as OrdersData, "pedidos"),
      safe<ProfitData>(`/api/profit?${periodQuery}`, (v) => { next.profit = v; setProfit(v); }, (d) => (d as { summary: ProfitData }).summary, "financeiro"),
      safe<RadarRow[]>(`/api/radar?${periodQuery}`, (v) => { next.radar = v; setRadar(v); }, (d) => (d as { rows: RadarRow[] }).rows, "estoque"),
      safe<SalesSeries>(`/api/sales?${periodQuery}`, (v) => { next.sales = v; setSales(v); }, (d) => (d as { series: SalesSeries }).series, "vendas"),
    ]).then(() => {
      if (active) {
        setErrors(errs);
        setBrokenConnection(broken);
        setUpdatedAt(new Date());
        setLoading(false);
        store();
      }
    });

    // Produtos e top produtos usam o relatório da Amazon (lento) — carregam em separado.
    if (!productsCache) Promise.resolve().then(() => active && setProductsLoading(true));
    safe<ProductRow[]>(`/api/products`, (v) => { productsCache = v; setProducts(v); }, (d) => (d as { products: ProductRow[] }).products, "produtos").finally(
      () => active && setProductsLoading(false)
    );
    safe<TopProduct[]>(`/api/top-products?${periodQuery}`, (v) => { next.top = v; setTop(v); store(); }, (d) => (d as { products: TopProduct[] }).products, "top produtos");
    // Saldo NÃO leva `periodQuery`: é o estado de agora, não do período escolhido.
    safe<SaldoData | null>(`/api/amazon/balance`, (v) => setSaldo(v), (d) => d as SaldoData | null, "saldo");
    // Rentabilidade por venda: mesma fonte do monitor, com loading próprio para
    // não segurar os KPIs (o fallback ao vivo do endpoint pode ser lento).
    safe<{ lines: ProfitabilityLine[]; scope?: ProfitabilityScope }>(
      `/api/order-profitability?${periodQuery}`,
      (v) => { next.profitability = v.lines; next.profitabilityScope = v.scope; setProfitability(v.lines); setProfitabilityScope(v.scope); store(); },
      (d) => d as { lines: ProfitabilityLine[]; scope?: ProfitabilityScope },
      "rentabilidade"
    ).finally(() => active && setProfitabilityLoading(false));

    return () => {
      active = false;
    };
  }, [periodQuery]);

  const currency = profit?.finance.currency || orders?.metrics.currency || "BRL";
  const critical = radar.filter((r) => r.status === "critical" || r.status === "out");
  const noCost = products.filter((p) => p.cost == null || p.cost === 0).length;
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
  const ticketMedio = vendasConciliadas > 0 ? faturamentoConciliado / vendasConciliadas : null;
  // Quanto dos pedidos recebidos a Amazon ainda não confirmou. As duas bases só
  // podem ser subtraídas no MESMO critério: `revenue` (orderMetrics) é preço de
  // tabela, então o conciliado precisa voltar ao bruto somando o cupom.
  const pedidosAguardando = Math.max(0, salesCount - vendasConciliadas);
  const valorAguardando = Math.max(0, revenue - (faturamentoConciliado + promocoes));
  const roiPct = cogs > 0 ? (estProfit / cogs) * 100 : 0;
  const revenueTrend = getRevenueTrend(sales?.points ?? []);

  return (
    <div className="dashboard-page space-y-8">
      <PageHeader
        eyebrow="Operação Amazon"
        title="Dashboard Amazon"
        subtitle="Resumo de vendas, lucro, FBA e desempenho da conta Amazon ativa."
        icon={pageIcons.dashboard}
      />
      <DashboardPeriodFilter {...period.filterProps} />

      {updatedAt && (
        <p className="-mt-5 text-xs text-slate-400">
          Atualizado às {brTime(updatedAt)}. Dados de vendas, pedidos e financeiro sincronizados.
        </p>
      )}

      <AmazonPending products={products.length} productsLoading={productsLoading} missingCosts={noCost} />

      <div className="dashboard-sections space-y-8">
      {/* Os doze componentes do resultado, um card cada — mesmo padrão do painel da
          TikTok Shop. Componente sem dado diz o que falta em vez de mostrar zero.
          O Lucro mantém o tratamento verde de destaque que já tinha. */}
      {(() => {
        const cards = amazonFinancialCards({
          finance: profit?.finance ?? null,
          cogs: profit?.cogs ?? 0,
          estimatedProfit: profit?.estimatedProfit ?? 0,
          unitsWithoutCost: profit?.unitsWithoutCost ?? 0,
        });
        const margem = cards.find((c) => c.key === "marginPct");
        return (
          <div className="metric-grid grid grid-cols-1 gap-0 sm:grid-cols-2 lg:grid-cols-4" aria-label="Componentes financeiros da Amazon">
            {cards.map((card) =>
              card.key === "profit" ? (
                <div key={card.key} className="metric-cell metric-primary relative overflow-hidden p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                    {costsIncomplete ? "Repasse líquido" : "Lucro"}
                  </p>
                  <p className="mt-2 text-[27px] font-bold leading-none tabular-nums text-emerald-800">
                    {loading ? "···" : card.raw != null
                      ? <AnimatedNumber id="amz-profit" value={card.raw} format={(amount) => money(amount, currency)} />
                      : card.value}
                  </p>
                  {card.value === "—" || margem?.value === "—" ? (
                    <p className="mt-1.5 text-xs font-medium text-slate-500">{loading ? "" : card.context}</p>
                  ) : (
                    <p className="mt-2 flex items-baseline gap-1.5">
                      <span className="text-[17px] font-extrabold tabular-nums text-emerald-600">{margem?.value}</span>
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700/70">margem sobre vendas</span>
                    </p>
                  )}
                </div>
              ) : (
                <Kpi
                  key={card.key}
                  label={card.label}
                  value={loading ? "…" : card.key === "revenue" && card.raw != null
                    ? <AnimatedNumber id="amz-revenue" value={card.raw} format={(amount) => money(amount, currency)} />
                    : card.value}
                  // O selo de tendência ("novo ritmo") só faz sentido no faturamento.
                  sub={card.key === "revenue" && card.raw != null
                    // Dizer "5 vendas" sob um valor que cobre 2 sugere que os
                    // R$ 39,80 são o resultado das cinco.
                    ? (vendasConciliadas < salesCount ? `${vendasConciliadas} de ${salesCount} vendas conciliadas` : `${salesCount} vendas no período`)
                    : card.context}
                  trend={card.key === "revenue" ? revenueTrend : undefined}
                  loading={loading}
                />
              )
            )}
          </div>
        );
      })()}

      {/* Indicadores de contexto: uma faixa, não uma segunda parede de cartões. */}
      <div className="secondary-metrics" aria-label="Indicadores complementares">
        <CompactMetric label="Vendas" value={String(salesCount)} loading={loading} />
        <CompactMetric label="Unidades" value={String(unitsCount)} loading={loading} />
        <CompactMetric label="Ticket médio" value={ticketMedio == null ? "—" : money(ticketMedio, currency)} loading={loading} />
        <CompactMetric label="ROI" value={cogs > 0 ? `${roiPct.toFixed(1)}%` : "—"} loading={loading} />
      </div>

      {brokenConnection && <ConnectionBroken channel="amazon" message={brokenConnection} />}

      {errors.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          Não foi possível carregar: {errors.join(", ")}.
        </div>
      )}

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
              <h2 className="mt-1 text-lg font-semibold text-slate-900">Evolução das vendas</h2>
            </div>
            <span className="text-sm font-semibold tabular-nums text-slate-900">
              {money(revenue, currency)}{" "}
              <span className="font-normal text-slate-400">em pedidos recebidos</span>
            </span>
          </div>
          {/* Onde o dinheiro está, não só quanto foi vendido. A diferença entre os
              dois totais da tela tem uma explicação concreta — pedido que a Amazon
              ainda não confirmou — e escondê-la só deixava dois números brigando. */}
          {!loading && pedidosAguardando > 0 && (
            <p className="sales-split">
              <span><strong>{vendasConciliadas}</strong> {vendasConciliadas === 1 ? "confirmado" : "confirmados"} · {money(faturamentoConciliado, currency)}</span>
              <span className="is-pendente"><strong>{pedidosAguardando}</strong> {pedidosAguardando === 1 ? "aguardando" : "aguardando"} pagamento · {money(valorAguardando, currency)}</span>
              <small>A Amazon confirma o pagamento antes de informar o valor, e só libera o repasse depois da entrega.</small>
            </p>
          )}
          {loading ? (
            <span className="skeleton-chart" role="status" aria-label="Carregando evolução das vendas" />
          ) : (
            <RevenueChart points={sales?.points ?? []} />
          )}
        </div>

        <aside className="financial-composition" aria-label="Financeiro conciliado do período">
          <div>
            <p className="section-kicker">Financeiro conciliado</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">Repasses, taxas e {costsIncomplete ? "resultado" : "lucro"}</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">Base dos repasses da Amazon (data de postagem) — difere do faturamento acima, que segue a data do pedido como o Seller Central.</p>
          </div>
          {!loading && !hasFinance ? (
            // Sem transação postada não há cascata: zerar receita, taxas e lucro
            // faria a tela afirmar que a venda não rendeu nada.
            <p className="text-sm leading-relaxed text-slate-500">
              A Amazon ainda não postou repasse deste período. As vendas já aparecem no faturamento
              (data do pedido); taxas e lucro entram aqui quando o pedido é postado e liquidado.
            </p>
          ) : (
            <div className="financial-lines">
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
              <Flow label={costsIncomplete ? "Repasse líquido" : "Lucro estimado"} value={loading ? "…" : money(profit?.estimatedProfit ?? 0, currency)} accent sign="=" />
              {!loading && (profit?.finance.revenue ?? 0) > 0 && (
                <Flow
                  label="Margem"
                  value={`${(((profit?.estimatedProfit ?? 0) / (profit?.finance.revenue || 1)) * 100).toFixed(1).replace(".", ",")}%`}
                  accent
                />
              )}
            </div>
          )}
        </aside>
      </section>

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
            <ul className="divide-y divide-slate-100">
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

        <Panel title="Pedidos recentes" href="/amazon/monitor" linkLabel="Ver monitor">
          {loading ? (
            <InlineLoading label="Carregando pedidos recentes" />
          ) : !orders || orders.orders.length === 0 ? (
            <Empty>Nenhum pedido no período.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {orders.orders.slice(0, 6).map((o) => (
                <li key={o.amazonOrderId} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs text-slate-500">
                      {o.amazonOrderId}
                    </span>
                    <span className="text-xs text-slate-400">
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
      <OrderProfitabilityTable lines={profitability} loading={profitabilityLoading} scopeNote={scopeSentence(profitabilityScope)} />

      {/* Top produtos */}
      <div className="work-panel border-t border-slate-300 py-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Top produtos
          </h2>
          <Link href="/produtos" className="text-xs font-medium text-blue-600 hover:underline">
            Ver produtos →
          </Link>
        </div>
        {productsLoading ? (
          <InlineLoading label="Carregando produtos com melhor desempenho" />
        ) : top.length === 0 ? (
          <Empty>Sem vendas no período para ranquear.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <caption className="sr-only">Produtos com melhor desempenho no período</caption>
              <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="pb-2 pr-3 font-medium">#</th>
                  <th scope="col" className="pb-2 pr-3 font-medium">Produto</th>
                  <th scope="col" className="pb-2 px-3 text-right font-medium">Un</th>
                  <th scope="col" className="pb-2 px-3 text-right font-medium">Faturamento</th>
                  <th scope="col" className="pb-2 pl-3 text-right font-medium">Margem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {top.map((p, i) => (
                  <tr key={p.sku}>
                    <td className="py-2.5 pr-3 tabular-nums text-slate-400">{i + 1}</td>
                    <td className="py-2.5 pr-3">
                      <span className="block max-w-[260px] truncate font-medium">
                        {p.title || p.sku}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">{p.units}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                      {money(p.revenue, currency)}
                    </td>
                    <td className="py-2.5 pl-3 text-right">
                      <MarginBadge pct={p.marginPct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-slate-400">
              Margem de contribuição = (preço de venda − custo) ÷ preço. Cadastre custos em
              Produtos para ver a margem.
            </p>
          </div>
        )}
      </div>

      {/* Atalhos: no desktop a sidebar já cobre; no mobile os cartões ajudam. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:hidden">
        <QuickLink href="/amazon/calculadora" label="Calculadora" desc="Lucro por ASIN" />
        <QuickLink href="/amazon/monitor" label="Monitor" desc="Vendas e financeiro" />
        <QuickLink href="/amazon/estoque" label="Radar" desc="Estoque × velocidade" />
        <QuickLink href="/amazon/produtos" label="Produtos" desc="Custos por SKU" />
      </div>
      </div>
    </div>
  );
}



function CompactMetric({ label, value, loading }: { label: string; value: string; loading?: boolean }) {
  return (
    <div className="compact-metric">
      <p>{label}</p>
      <strong>{loading ? "···" : value}</strong>
    </div>
  );
}

// A Transactions API nomeia cada tarifa em inglês. "Taxas Amazon" somava tudo num
// número só e a pergunta "qual taxa é essa?" não tinha resposta na tela.
// Tipo desconhecido aparece com o nome original — nunca some nem vira "Outras".
const NOME_DA_TARIFA: Record<string, string> = {
  Commission: "Comissão",
  AdvertisingFee: "Anúncios",
  FBAPerUnitFulfillmentFee: "Logística FBA",
  FBAStorageFee: "Armazenagem FBA",
  FBAInventoryFee: "Estoque FBA",
  StorageFee: "Armazenagem",
  SubscriptionFee: "Assinatura",
  RefundCommission: "Comissão de reembolso",
  ShippingChargeback: "Estorno de frete",
  DigitalServicesFee: "Taxa de serviços digitais",
  VariableClosingFee: "Taxa de fechamento",
  PerItemFee: "Taxa por item",
};

function nomeDaTarifa(tipo: string): string {
  return NOME_DA_TARIFA[tipo] ?? tipo;
}

function Flow({
  label,
  value,
  muted,
  accent,
  sign,
  detail,
  subtotal,
}: {
  detail?: boolean;
  label: string;
  value: string;
  muted?: boolean;
  accent?: boolean;
  sign?: "−" | "=";
  /** Fecha um trecho da cascata sem ser o resultado final (que é verde). */
  subtotal?: boolean;
}) {
  return (
    <div className={`financial-line ${accent ? "is-result" : ""} ${subtotal ? "is-subtotal" : ""}`}>
      <span className="financial-sign" aria-hidden="true">{sign}</span>
      <p className={detail ? "pl-3 text-xs text-slate-400" : "text-xs font-medium text-slate-500"}>{label}</p>
      <p
        className={`tabular-nums ${detail ? "text-xs text-slate-500" : "text-sm font-bold"} ${
          accent ? "text-emerald-700" : muted && !detail ? "text-red-600" : detail ? "" : "text-slate-900"
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
  const proxima = saldo.liberacoes[0];
  return (
    <section className="saldo-panel" aria-labelledby="saldo-title">
      <div>
        <p className="section-kicker">Saldo na Amazon</p>
        <h2 id="saldo-title" className="mt-1 text-lg font-semibold text-slate-900">O que você tem hoje</h2>
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
        <ol className="saldo-liberacoes">
          {saldo.liberacoes.map((l) => (
            <li key={l.date}>
              <span>{brDate(l.date)}</span>
              <strong>{money(l.amount, saldo.currency)}</strong>
              <small>{l.orderIds.length} {l.orderIds.length === 1 ? "pedido" : "pedidos"}</small>
            </li>
          ))}
        </ol>
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
    <div className="work-panel border-t border-slate-300 py-5">
      <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-3">
        <h2 className="text-[13px] font-semibold text-slate-700">{title}</h2>
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

function MarginBadge({ pct }: { pct: number | null }) {
  if (pct == null) {
    return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-400">—</span>;
  }
  const cls =
    pct >= 18
      ? "bg-emerald-100 text-emerald-700"
      : pct >= 12
        ? "bg-amber-100 text-amber-700"
        : "bg-red-100 text-red-700";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${cls}`}>
      {pct.toFixed(1)}%
    </span>
  );
}

function QuickLink({ href, label, desc }: { href: string; label: string; desc: string }) {
  return (
    <Link
      href={href}
      className="quick-command group flex items-center justify-between border-t border-slate-300 py-4"
    >
      <div>
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        <p className="text-xs text-slate-400">{desc}</p>
      </div>
      <span className="text-slate-300 transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-blue-500">
        →
      </span>
    </Link>
  );
}

function AmazonPending({ products, productsLoading, missingCosts }: { products: number; productsLoading: boolean; missingCosts: number }) {
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

  if (connection === "loading") return null;

  const items: OperationPendingItem[] = [];
  if (connection === "missing") items.push({ label: "Conectar a conta Amazon", href: "/integracoes" });
  if (connection === "connected" && !productsLoading && products === 0) items.push({ label: "Sincronizar os produtos da Amazon", href: "/amazon/produtos" });
  if (products > 0 && missingCosts > 0) items.push({ label: `Cadastrar custo de ${missingCosts} produto(s)`, href: "/amazon/produtos" });

  return <OperationPending items={items} />;
}
