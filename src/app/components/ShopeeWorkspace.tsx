"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatedNumber } from "./AnimatedNumber";
import { EmptyState } from "./EmptyState";
import { DashboardSkeleton } from "./LoadingState";
import { PageHeader } from "./PageHeader";
import { RevenueChart, type DailyPoint } from "./RevenueChart";
import { DashboardPeriodFilter, useDashboardPeriod } from "./DashboardPeriodFilter";
import { OrderProfitabilityTable } from "./OrderProfitabilityTable";
import { OperationPending } from "./OperationPending";
import { Flow, FlowExpandable, Metric, getRevenueTrend } from "./Metric";
import { brDate, brTime } from "@/lib/datetime";
import { Boxes, PackageOpen } from "lucide-react";
import type { ProfitabilityLine } from "@/lib/profitability";

interface Overview {
  account: { id: string; name: string; region: string };
  period: { from: string; to: string; label: string };
  metrics: {
    activeListings: number;
    productsWithoutCost: number;
    orders30d: number;
    paidOrders: number;
    revenue30d: number;
    cancelledRevenue: number;
    cancelledOrders: number;
    lastSaleAt: string | null;
    currency: string;
    revenueCoverage: { capturedOrders: number; totalOrders: number; complete: boolean };
  };
  profit: {
    fees: number; cogs: number; taxes: number; taxRate: number;
    sellerShipping: number; buyerShipping: number; feesComplete: boolean;
    revenueProcessed: number;
    coverage: { processedOrders: number; paidOrders: number; complete: boolean };
    estimatedProfit: number; marginPct: number; unitsWithoutCost: number;
  };
  dailySales: DailyPoint[];
  topProducts: Array<{ id: string; sku: string | null; title: string; units: number; revenue: number; cost: number; contribution: number; complete: boolean; marginPct: number | null }>;
  stockRadar: Array<{ id: string; sku: string | null; title: string; availableQuantity: number; unitsSold: number; calculationDays: number; daysRemaining: number | null; status: "out" | "critical" | "ok" }>;
  profitabilityLines: ProfitabilityLine[];
  recentOrders: Array<{ id: string; status: string; createdAt: string; total: number; currency: string; items: number }>;
}

interface ProviderStatus {
  configured: boolean;
  connected: boolean;
  connectHref?: string;
}

function money(value: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

function percent(value: number) {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

// Status da Shopee (v2) traduzidos; o que não estiver mapeado aparece legível.
function orderStatus(status: string) {
  const labels: Record<string, string> = {
    UNPAID: "Aguardando pagamento",
    READY_TO_SHIP: "Pronto para envio",
    PROCESSED: "Em processamento",
    SHIPPED: "Enviado",
    COMPLETED: "Concluído",
    CANCELLED: "Cancelado",
    INVOICE_PENDING: "Aguardando NF-e",
    paid: "Pago",
    cancelled: "Cancelado",
  };
  return labels[status] || status.replaceAll("_", " ").toLowerCase();
}

export function ShopeeWorkspace() {
  const period = useDashboardPeriod();
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/integrations", { cache: "no-store" });
        if (!response.ok) throw new Error("Não foi possível carregar as integrações.");
        const data = await response.json();
        const provider = (data.providers ?? []).find((item: { id: string }) => item.id === "shopee");
        if (cancelled) return;
        setStatus({
          configured: Boolean(provider?.configured),
          connected: (provider?.connections ?? []).length > 0,
          connectHref: provider?.connectHref,
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!status?.connected) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/integrations/shopee/overview?${period.query}`, { cache: "no-store" });
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || "Erro ao carregar a Shopee.");
        if (data.pending) {
          setPending(true);
          setOverview(null);
        } else {
          setPending(false);
          setOverview(data.overview);
          setUpdatedAt(new Date());
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar.");
      }
    })();
    return () => { cancelled = true; };
  }, [status?.connected, period.query]);

  if (error) {
    return (
      <>
        <PageHeader eyebrow="Shopee" title="Visão do canal" />
        <EmptyState title="Não foi possível carregar" description={error} kind="permission" />
      </>
    );
  }

  if (!status) {
    return (
      <>
        <PageHeader eyebrow="Shopee" title="Visão do canal" />
        <DashboardSkeleton />
      </>
    );
  }

  if (!status.configured) {
    return (
      <>
        <PageHeader eyebrow="Shopee" title="Visão do canal" subtitle="Canal ainda não configurado no servidor." />
        <EmptyState
          kind="permission"
          title="Credenciais da Shopee ausentes"
          description="Defina SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY no ambiente para habilitar a conexão."
        />
      </>
    );
  }

  if (!status.connected) {
    return (
      <>
        <PageHeader eyebrow="Shopee" title="Visão do canal" subtitle="Conecte uma loja para começar a sincronizar pedidos e taxas." />
        <EmptyState
          title="Nenhuma loja Shopee conectada"
          description="Ao autorizar, o SellerCore passa a ler pedidos, produtos e as taxas reais de cada venda (escrow)."
          action={
            <Link className="meli-primary-action" href={status.connectHref || "/integracoes"}>
              Conectar loja Shopee <span aria-hidden="true">→</span>
            </Link>
          }
        />
      </>
    );
  }

  if (pending || !overview) {
    return (
      <>
        <PageHeader eyebrow="Shopee" title="Visão do canal" subtitle="Loja conectada — primeira sincronização pendente." />
        <EmptyState
          title="Ainda sem dados sincronizados"
          description="A loja está autorizada. Assim que a primeira sincronização rodar, os indicadores, o gráfico e a rentabilidade por pedido aparecem aqui."
          action={<Link className="meli-primary-action" href="/integracoes">Gerenciar conexão <span aria-hidden="true">→</span></Link>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Shopee"
        title={overview.account.name}
        subtitle={`Loja ${overview.account.id} · ${overview.account.region} · ${overview.period.label}`}
        action={<DashboardPeriodFilter {...period.filterProps} />}
      />
      <Dashboard overview={overview} updatedAt={updatedAt} />
    </>
  );
}

function Dashboard({ overview, updatedAt }: { overview: Overview; updatedAt: Date | null }) {
  const [costsOpen, setCostsOpen] = useState(false);
  const profitCoverage = overview.profit.coverage;
  const ticket = overview.metrics.paidOrders > 0 ? overview.metrics.revenue30d / overview.metrics.paidOrders : 0;
  const units = overview.dailySales.reduce((total, point) => total + point.units, 0);
  const critical = overview.stockRadar.filter((product) => product.status === "critical" || product.status === "out");
  const roi = overview.profit.cogs > 0 ? (overview.profit.estimatedProfit / overview.profit.cogs) * 100 : null;
  const costsIncomplete = overview.profit.unitsWithoutCost > 0;

  return (
    <div className="dashboard-sections space-y-8">
      {updatedAt && (
        <p className="-mt-5 text-xs text-slate-400">
          Atualizado às {brTime(updatedAt)}
          {overview.metrics.lastSaleAt ? ` · última venda contabilizada às ${brTime(overview.metrics.lastSaleAt, true)}` : ""}.
        </p>
      )}

      <OperationPending items={overview.metrics.productsWithoutCost > 0 ? [{ label: `Cadastrar custo de ${overview.metrics.productsWithoutCost} produto(s)`, href: "/integracoes" }] : []} />

      <section className="metric-grid grid grid-cols-1 gap-0 sm:grid-cols-2 lg:grid-cols-4" aria-label="Indicadores Shopee">
        <Metric
          label="Vendas"
          value={<AnimatedNumber id="shopee-dash-revenue" value={overview.metrics.revenue30d} format={(amount) => money(amount, overview.metrics.currency)} />}
          sub={`${overview.metrics.paidOrders} pedido(s) no período`}
          trend={getRevenueTrend(overview.dailySales)}
        />
        <div className="metric-cell metric-primary relative overflow-hidden p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">{costsIncomplete ? "Margem antes do custo" : "Lucro estimado"}</p>
          <p className="mt-2 text-[27px] font-bold leading-none tabular-nums text-emerald-800">
            <AnimatedNumber id="shopee-dash-profit" value={overview.profit.estimatedProfit} format={(amount) => money(amount, overview.metrics.currency)} />
          </p>
          {costsIncomplete
            ? <p className="mt-1.5 text-xs font-medium text-amber-700">cadastre custos para o lucro real</p>
            : <p className="mt-2 flex items-baseline gap-1.5"><span className="text-[17px] font-extrabold tabular-nums text-emerald-600">{percent(overview.profit.marginPct)}</span><span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700/70">margem</span></p>}
        </div>
        <Metric label="Estoque crítico" value={critical.length.toLocaleString("pt-BR")} sub={critical.length ? "repor com urgência" : "tudo sob controle"} tone={critical.length ? "danger" : "ok"} icon={<Boxes className="h-5 w-5" strokeWidth={1.7} aria-hidden />} />
        <Metric label="Produtos sem custo" value={overview.metrics.productsWithoutCost.toLocaleString("pt-BR")} sub={overview.metrics.productsWithoutCost ? "cadastre para ver o lucro" : "todos cadastrados"} tone={overview.metrics.productsWithoutCost ? "warn" : "ok"} icon={<PackageOpen className="h-5 w-5" strokeWidth={1.7} aria-hidden />} />
      </section>

      <section className="performance-panel">
        <div className="performance-chart">
          <div className="mb-2 flex items-baseline justify-between gap-4">
            <div>
              <p className="section-kicker">Desempenho diário</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">Evolução do faturamento</h2>
            </div>
            <span className="text-sm font-semibold tabular-nums text-slate-900">
              {money(overview.metrics.revenue30d, overview.metrics.currency)} <span className="font-normal text-slate-400">no período</span>
            </span>
          </div>
          <div className="chart-inline-stats" aria-label="Indicadores complementares">
            <span><small>Canceladas</small><strong className={overview.metrics.cancelledRevenue > 0 ? "text-red-600" : "text-slate-400"}>{money(overview.metrics.cancelledRevenue, overview.metrics.currency)}</strong></span>
            <span><small>Unidades</small><strong>{units.toLocaleString("pt-BR")}</strong></span>
            <span><small>Ticket médio</small><strong>{money(ticket, overview.metrics.currency)}</strong></span>
            <span><small>ROI</small><strong>{roi == null ? "—" : `${roi.toFixed(1)}%`}</strong></span>
          </div>
          <RevenueChart points={overview.dailySales} />
        </div>
        <aside className="financial-composition" aria-label="Resumo do resultado financeiro">
          <div>
            <p className="section-kicker">Resultado do período</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">Do faturamento ao lucro</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              {profitCoverage.complete ? "Valores efetivamente identificados no período." : `Detalhamento processado em ${profitCoverage.processedOrders} de ${profitCoverage.paidOrders} vendas.`}
            </p>
          </div>
          <div className="financial-lines">
            <Flow label={profitCoverage.complete ? "Receita paga" : "Receita processada"} value={money(overview.profit.revenueProcessed, overview.metrics.currency)} />
            <FlowExpandable
              label="Custos do canal e do produto"
              value={money(overview.profit.fees + overview.profit.sellerShipping + overview.profit.cogs + overview.profit.taxes, overview.metrics.currency)}
              open={costsOpen}
              onToggle={() => setCostsOpen((open) => !open)}
              items={[
                { label: "Taxas da Shopee (escrow)", value: money(overview.profit.fees, overview.metrics.currency) },
                { label: "Frete pago pelo vendedor", value: money(overview.profit.sellerShipping, overview.metrics.currency) },
                { label: "Custo dos produtos", value: money(overview.profit.cogs, overview.metrics.currency) },
                { label: `Impostos (${overview.profit.taxRate.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%)`, value: money(overview.profit.taxes, overview.metrics.currency) },
              ]}
            />
            <Flow label={profitCoverage.complete ? "Lucro estimado" : "Lucro processado"} value={money(overview.profit.estimatedProfit, overview.metrics.currency)} sign="=" accent />
          </div>
          {!overview.profit.feesComplete && (
            <p className="text-xs leading-relaxed text-amber-700">
              As taxas da Shopee só fecham no escrow, depois do pagamento do pedido. Enquanto isso, as vendas mais recentes entram sem tarifa e aparecem como incompletas.
            </p>
          )}
          {overview.profit.unitsWithoutCost > 0 && (
            <p className="text-xs leading-relaxed text-amber-700">{overview.profit.unitsWithoutCost} unidade(s) vendida(s) ainda estão sem custo cadastrado.</p>
          )}
        </aside>
      </section>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Panel title="Estoque crítico">
          {critical.length === 0 ? <Empty>Nenhum produto em ruptura iminente.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {critical.slice(0, 6).map((product) => (
                <li key={product.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="min-w-0 truncate pr-3">{product.title || product.sku || product.id}</span>
                  <span className="shrink-0 font-semibold text-red-600">{product.status === "out" ? "esgotado" : `${product.daysRemaining} dias`}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Pedidos recentes">
          {overview.recentOrders.length === 0 ? <Empty>Nenhum pedido no período.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {overview.recentOrders.slice(0, 6).map((order) => (
                <li key={order.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs text-slate-500">#{order.id}</span>
                    <span className="text-xs text-slate-400">{brDate(order.createdAt)} · {orderStatus(order.status)}</span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">{money(order.total, order.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <OrderProfitabilityTable lines={overview.profitabilityLines} />

      <div className="work-panel border-t border-slate-300 py-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Top produtos</h2>
        </div>
        {overview.topProducts.length === 0 ? <Empty>Sem vendas no período para ranquear.</Empty> : (
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
                {overview.topProducts.map((product, index) => (
                  <tr key={`${product.id}:${product.sku || ""}`}>
                    <td className="py-2.5 pr-3 tabular-nums text-slate-400">{index + 1}</td>
                    <td className="py-2.5 pr-3"><span className="block max-w-[260px] truncate font-medium" title={product.title}>{product.title}</span></td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">{product.units}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-medium">{money(product.revenue, overview.metrics.currency)}</td>
                    <td className="py-2.5 pl-3 text-right"><MarginBadge pct={product.marginPct} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-slate-400">O faturamento considera todas as vendas do período. A margem aparece somente quando todos os custos daquele produto foram processados.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="work-panel border-t border-slate-300 py-5">
      <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-3">
        <h2 className="text-[13px] font-semibold text-slate-700">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <EmptyState compact title={String(children)} />;
}

function MarginBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-400">—</span>;
  const tone = pct >= 15 ? "bg-emerald-50 text-emerald-700" : pct >= 5 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${tone}`}>{pct.toFixed(1)}%</span>;
}
