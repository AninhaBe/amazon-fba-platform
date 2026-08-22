"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3, LayoutDashboard, MousePointer2, PackageSearch } from "lucide-react";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { CompositionDonut } from "../components/CompositionDonut";
import { MarketplaceIcon } from "../components/MarketplaceIcon";
import { Metric } from "../components/Metric";
import { NexoSymbol } from "../components/NexoSymbol";
import { RevenueChart, type ChartMetric, type DailyPoint } from "../components/RevenueChart";

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
  const [chartMetric, setChartMetric] = useState<ChartMetric>("revenue");
  const [cursorTarget, setCursorTarget] = useState("period-15");
  const [cursorClicking, setCursorClicking] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0, ready: false });
  const demoRef = useRef<HTMLDivElement>(null);
  const pauseUntilRef = useRef(0);
  const resumo = RESUMOS[periodo];
  const points = periodo === 15 ? POINTS.slice(-15) : POINTS;

  const chartTotal = chartMetric === "revenue"
    ? resumo.revenue
    : chartMetric === "orders"
      ? resumo.orders
      : Math.round(resumo.orders * 1.18);
  const chartHeading = chartMetric === "revenue"
    ? "Evolução das vendas"
    : chartMetric === "orders"
      ? "Evolução dos pedidos"
      : "Evolução das unidades";
  const chartTotalText = chartMetric === "revenue"
    ? money(chartTotal)
    : `${chartTotal.toLocaleString("pt-BR")} ${chartMetric === "orders" ? "pedidos" : "unidades"}`;

  function pauseDemo() {
    pauseUntilRef.current = Date.now() + 8_000;
    setCursorClicking(false);
    setCursorPosition((current) => ({ ...current, ready: false }));
  }

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;
    const steps: Array<{ target: string; apply: () => void }> = [
      { target: "period-15", apply: () => setPeriodo(15) },
      { target: "metric-orders", apply: () => setChartMetric("orders") },
      { target: "period-30", apply: () => setPeriodo(30) },
      { target: "metric-units", apply: () => setChartMetric("units") },
      { target: "metric-revenue", apply: () => setChartMetric("revenue") },
    ];
    let stepIndex = 0;
    let moveTimer = 0;
    let clickTimer = 0;
    let releaseTimer = 0;

    const runStep = () => {
      if (Date.now() < pauseUntilRef.current) {
        moveTimer = window.setTimeout(runStep, 1_000);
        return;
      }
      const step = steps[stepIndex % steps.length];
      setCursorTarget(step.target);
      setCursorClicking(false);
      clickTimer = window.setTimeout(() => {
        if (Date.now() < pauseUntilRef.current) return;
        step.apply();
        setCursorClicking(true);
        releaseTimer = window.setTimeout(() => setCursorClicking(false), 240);
      }, 850);
      stepIndex += 1;
      moveTimer = window.setTimeout(runStep, 2_350);
    };

    moveTimer = window.setTimeout(runStep, 900);
    return () => {
      window.clearTimeout(moveTimer);
      window.clearTimeout(clickTimer);
      window.clearTimeout(releaseTimer);
    };
  }, []);

  useEffect(() => {
    if (Date.now() < pauseUntilRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const demo = demoRef.current;
      const target = demo?.querySelector<HTMLElement>(`[data-demo-target="${cursorTarget}"]`);
      if (!demo || !target) return;
      const demoRect = demo.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      setCursorPosition({
        x: targetRect.left - demoRect.left + targetRect.width * 0.62,
        y: targetRect.top - demoRect.top + targetRect.height * 0.66,
        ready: true,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cursorTarget, periodo, chartMetric]);

  return (
    <div ref={demoRef} className="lp-product-demo" data-channel="amazon">
      <span
        className={`lp-demo-cursor${cursorClicking ? " is-clicking" : ""}${cursorPosition.ready ? " is-ready" : ""}`}
        style={{ left: cursorPosition.x, top: cursorPosition.y }}
        aria-hidden="true"
      >
        <MousePointer2 />
      </span>
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
                data-demo-target={`period-${days}`}
                onClick={() => {
                  pauseDemo();
                  setPeriodo(days);
                }}
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
                <div><p className="section-kicker">Desempenho diário</p><h3>{chartHeading}</h3></div>
                <strong>{chartMetric === "revenue"
                  ? <AnimatedNumber id="landing-chart-total" value={chartTotal} format={money} />
                  : chartTotalText}
                </strong>
              </div>
              <RevenueChart
                points={points}
                currency="BRL"
                explorable
                metric={chartMetric}
                demoTargetPrefix="metric"
                onMetricChange={(metric) => {
                  pauseDemo();
                  setChartMetric(metric);
                }}
              />
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
