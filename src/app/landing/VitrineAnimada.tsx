"use client";

import { useEffect, useState } from "react";
import { BarChart3, LayoutDashboard, PackageSearch } from "lucide-react";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { CompositionDonut } from "../components/CompositionDonut";
import { MarketplaceIcon } from "../components/MarketplaceIcon";
import { Metric } from "../components/Metric";
import { NexoSymbol } from "../components/NexoSymbol";
import { RevenueChart, type DailyPoint } from "../components/RevenueChart";

type Periodo = 15 | 30;

const REVENUES = [
  620, 890, 760, 1120, 980, 1340, 1210, 1490, 1380, 1580,
  1430, 1710, 1620, 1830, 1750, 1960, 1810, 2140, 2290, 2080,
  2360, 2210, 2480, 2390, 2670, 2510, 2780, 2630, 2910, 3060,
];

const POINTS: DailyPoint[] = REVENUES.map((revenue, index) => {
  const date = new Date(Date.UTC(2026, 6, 22 + index)).toISOString().slice(0, 10);
  const orders = Math.max(1, Math.round(revenue / 78));
  return { date, revenue, orders, units: Math.round(orders * 1.18) };
});

const RESUMOS = {
  15: { revenue: 31_450, fees: 6_890, cogs: 10_820, profit: 13_740, orders: 403 },
  30: { revenue: 55_720, fees: 12_210, cogs: 19_120, profit: 24_390, orders: 714 },
} as const;

const money = (value: number) => new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
}).format(value);

/**
 * Demonstração pública composta pela UI real do produto.
 *
 * Os dados são uma amostra ilustrativa e ficam locais: a landing nunca acessa
 * sessão, APIs ou dados de uma conta conectada. A estrutura visível, porém, é
 * a mesma dos dashboards — Metric, RevenueChart e CompositionDonut — para que
 * a animação mostre o NEXO em vez de uma réplica promocional.
 */
export function PainelCanal() {
  const [periodo, setPeriodo] = useState<Periodo>(30);
  const resumo = RESUMOS[periodo];
  const points = periodo === 15 ? POINTS.slice(-15) : POINTS;

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;
    const interval = window.setInterval(() => {
      setPeriodo((current) => current === 30 ? 15 : 30);
    }, 7200);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="lp-product-demo" data-channel="amazon">
      <aside className="lp-product-sidebar" aria-label="Navegação da demonstração">
        <div className="lp-product-brand"><NexoSymbol size={22} /><strong>NEXO</strong></div>
        <span className="lp-product-nav-label">Painéis</span>
        <span className="is-active"><LayoutDashboard aria-hidden="true" />Dashboard</span>
        <span><BarChart3 aria-hidden="true" />Desempenho</span>
        <span className="lp-product-nav-label">Catálogo</span>
        <span><PackageSearch aria-hidden="true" />Produtos</span>
      </aside>

      <div className="lp-product-main">
        <header className="lp-product-topbar">
          <span><MarketplaceIcon provider="amazon" size={18} />Dashboard Amazon</span>
          <em>Demonstração</em>
        </header>

        <div className="lp-product-filters">
          <div role="tablist" aria-label="Período da demonstração">
            {([15, 30] as const).map((days) => (
              <button
                key={days}
                type="button"
                role="tab"
                aria-selected={periodo === days}
                className={periodo === days ? "is-active" : ""}
                onClick={() => setPeriodo(days)}
              >
                {days} dias
              </button>
            ))}
          </div>
          <span>Dados ilustrativos · atualizados agora</span>
        </div>

        <div className="lp-product-content" aria-live="polite">
          <div className="lp-product-heading">
            <div>
              <p>Visão do canal</p>
              <h2>O resultado da operação, sem conta manual</h2>
            </div>
            <span>{resumo.orders.toLocaleString("pt-BR")} pedidos conciliados</span>
          </div>

          <div className="metric-grid lp-product-metrics">
            <Metric
              label="Faturamento"
              value={<AnimatedNumber id="landing-revenue" value={resumo.revenue} format={money} />}
              sub={`${resumo.orders.toLocaleString("pt-BR")} pedidos no período`}
              trend={{ direction: "up", percentage: periodo === 30 ? 12.8 : 8.4 }}
            />
            <Metric
              label="Taxas"
              value={<AnimatedNumber id="landing-fees" value={resumo.fees} format={money} />}
              sub="Valores conciliados"
              tone="danger"
            />
            <Metric
              label="Custo dos produtos"
              value={<AnimatedNumber id="landing-cogs" value={resumo.cogs} format={money} />}
              sub="Custos cadastrados"
            />
            <Metric
              label="Lucro estimado"
              value={<AnimatedNumber id="landing-profit" value={resumo.profit} format={money} />}
              sub={`${((resumo.profit / resumo.revenue) * 100).toFixed(1).replace(".", ",")}% de margem`}
              tone="positive"
            />
          </div>

          <section className="performance-panel lp-product-performance">
            <div className="performance-chart">
              <div className="lp-product-chart-title">
                <div><p className="section-kicker">Desempenho diário</p><h3>Evolução das vendas</h3></div>
                <strong><AnimatedNumber id="landing-chart-total" value={resumo.revenue} format={money} /></strong>
              </div>
              <RevenueChart key={periodo} points={points} currency="BRL" explorable />
            </div>

            <aside className="financial-composition" aria-label="Composição financeira demonstrativa">
              <div>
                <p className="section-kicker">Financeiro conciliado</p>
                <h3>Para onde foi o faturamento</h3>
              </div>
              <CompositionDonut
                total={resumo.revenue}
                totalLabel="Faturamento"
                format={money}
                slices={[
                  { id: "taxas", label: "Taxas", value: resumo.fees },
                  { id: "custo", label: "Produtos", value: resumo.cogs },
                  { id: "lucro", label: "Lucro", value: resumo.profit, isRemainder: true },
                ]}
              />
            </aside>
          </section>
        </div>
      </div>
    </div>
  );
}
