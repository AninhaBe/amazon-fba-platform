"use client";

import { useId, useRef, useState } from "react";
import { Banknote, PackageCheck, ShoppingBag, type LucideIcon } from "lucide-react";

export interface DailyPoint {
  date: string;
  revenue: number;
  orders: number;
  units: number;
}

const W = 1000;
const H = 320;
// left comporta o rótulo mais largo ("R$ 18,3k") sem cortar o "R$".
const PAD = { top: 20, right: 16, bottom: 28, left: 72 };

type ChartMetric = "revenue" | "orders" | "units";

const METRICS: Array<{ key: ChartMetric; label: string; icon: LucideIcon }> = [
  { key: "revenue", label: "Faturamento", icon: Banknote },
  { key: "orders", label: "Pedidos", icon: ShoppingBag },
  { key: "units", label: "Unidades", icon: PackageCheck },
];

function money(v: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);
}
function compact(v: number, metric: ChartMetric, currency: string) {
  if (metric !== "revenue") return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  const symbol = currency === "BRL" ? "R$" : currency;
  if (v >= 1000) return `${symbol} ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  return `${symbol} ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}
function shortDate(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function fullDate(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function niceCeiling(maximum: number) {
  if (maximum <= 0) return 1;
  const roughStep = maximum / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const factor = [1, 2, 2.5, 5, 10].find((candidate) => candidate >= normalized) ?? 10;
  return factor * magnitude * 4;
}

export function RevenueChart({
  points,
  explorable = false,
  currency = "BRL",
}: {
  points: DailyPoint[];
  explorable?: boolean;
  currency?: string;
}) {
  const gradientId = `revenue-fill-${useId().replaceAll(":", "")}`;
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [metric, setMetric] = useState<ChartMetric>("revenue");

  // O estado estrutural novo pertence ao dashboard Amazon em validação. As
  // demais famílias que reutilizam o componente mantêm o vazio já aprovado.
  if (!explorable && points.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-[var(--ink-muted)]">
        Sem dados de vendas no período.
      </div>
    );
  }

  const activeMetric = explorable ? metric : "revenue";
  const hasPoints = points.length > 0;
  const values = points.map((point) => point[activeMetric]);
  const maximum = Math.max(...values, 0);
  const niceMax = niceCeiling(maximum);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const x = (i: number) =>
    PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / niceMax) * plotH;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p[activeMetric])}`).join(" ");
  const areaPath = hasPoints ? `${linePath} L ${x(points.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z` : "";

  // Linhas de grade / rótulos do eixo Y
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ t, v: niceMax * t, yy: y(niceMax * t) }));

  // Rótulos do eixo X (no máximo ~7)
  const step = Math.max(1, Math.ceil(points.length / 7));
  const xLabels = points.filter((_, i) => i % step === 0 || i === points.length - 1);

  function onMove(e: React.MouseEvent) {
    const svg = ref.current;
    if (!svg || !hasPoints) return;
    const rect = svg.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const px = ratio * W;
    if (px < PAD.left - 10 || px > W - PAD.right + 10) {
      setHover(null);
      return;
    }
    const i = Math.round(((px - PAD.left) / plotW) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }

  const hp = hover != null ? points[hover] : null;
  const previousPoint = hover != null && hover > 0 ? points[hover - 1] : null;
  const delta = hp && previousPoint ? hp[activeMetric] - previousPoint[activeMetric] : null;
  const deltaPct = hp && previousPoint && previousPoint[activeMetric] !== 0
    ? (delta! / previousPoint[activeMetric]) * 100
    : null;
  const deltaTone = delta == null || delta === 0 ? "is-neutral" : delta > 0 ? "is-positive" : "is-negative";
  const deltaText = delta == null
    ? "Primeiro dia do período"
    : delta === 0
      ? "Sem variação contra o dia anterior"
      : deltaPct == null
        ? `${delta > 0 ? "Acima" : "Abaixo"} do dia anterior`
        : `${Math.abs(deltaPct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ${delta > 0 ? "acima" : "abaixo"} do dia anterior`;
  const hoverLeftPct = hover != null ? (x(hover) / W) * 100 : 0;

  return (
    <div className={`revenue-chart${explorable ? " is-explorable is-chart-v2" : ""}`}>
      {explorable && (
        <div className="revenue-chart-toolbar" role="tablist" aria-label="Métrica do gráfico">
          {METRICS.map((item) => {
            const MetricIcon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-label={item.label}
                title={item.label}
                aria-selected={activeMetric === item.key}
                tabIndex={activeMetric === item.key ? 0 : -1}
                onClick={() => {
                  setMetric(item.key);
                  setHover(null);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  const index = METRICS.findIndex((candidate) => candidate.key === item.key);
                  const offset = event.key === "ArrowRight" ? 1 : -1;
                  const nextIndex = (index + offset + METRICS.length) % METRICS.length;
                  setMetric(METRICS[nextIndex].key);
                  setHover(null);
                  const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']");
                  buttons?.[nextIndex]?.focus();
                }}
              >
                <MetricIcon aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: "auto" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onFocus={() => setHover(points.length - 1)}
        onBlur={() => setHover(null)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const current = hover ?? points.length - 1;
          setHover(Math.max(0, Math.min(points.length - 1, current + (event.key === "ArrowRight" ? 1 : -1))));
        }}
        tabIndex={0}
        role="img"
        aria-label={hasPoints
          ? `${METRICS.find((item) => item.key === activeMetric)?.label} por dia no período. Use as setas para consultar cada dia.`
          : "Sem vendas no período selecionado."}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--rev)" stopOpacity={explorable ? "0.11" : "0.2"} />
            <stop offset="100%" stopColor="var(--rev)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grade horizontal + rótulos Y */}
        {gridLines.map((g) => (
          <g key={g.t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={g.yy}
              y2={g.yy}
              className="revenue-grid-line"
              stroke="var(--ink-12)"
              strokeWidth={1}
              strokeDasharray={explorable ? "3 4" : undefined}
              vectorEffect="non-scaling-stroke"
            />
            {hasPoints && (
              <text
                x={PAD.left - 8}
                y={g.yy + 4}
                textAnchor="end"
                className="revenue-axis-label"
                fill="var(--ink-50)"
                fontSize={13}
              >
                {compact(g.v, activeMetric, currency)}
              </text>
            )}
          </g>
        ))}

        {/* Rótulos X */}
        {xLabels.map((p) => {
          const i = points.indexOf(p);
          const anchor = i === 0 ? "start" : i === points.length - 1 ? "end" : "middle";
          return (
            <text
              key={p.date}
              x={x(i)}
              y={H - 8}
              textAnchor={anchor}
              className="revenue-axis-label"
              fill="var(--ink-50)"
              fontSize={13}
            >
              {shortDate(p.date)}
            </text>
          );
        })}

        {hasPoints && (
          <>
            <path
              key={`area-${activeMetric}`}
              className="revenue-series-area"
              d={areaPath}
              fill={`url(#${gradientId})`}
            />
            <path
              key={`line-${activeMetric}`}
              className="revenue-series-line"
              d={linePath}
              fill="none"
              stroke="var(--rev)"
              strokeWidth={explorable ? 1.5 : 2}
              pathLength={1}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              className="revenue-endpoint"
              cx={x(points.length - 1)}
              cy={y(points[points.length - 1][activeMetric])}
              r={3}
              fill="var(--rev)"
            />
          </>
        )}

        {!hasPoints && (
          <text
            x={PAD.left + plotW / 2}
            y={PAD.top + plotH / 2}
            textAnchor="middle"
            className="revenue-empty-label"
            fill="var(--ink-50)"
            fontSize={13}
          >
            Sem vendas no período selecionado
          </text>
        )}

        {/* Crosshair + ponto do hover */}
        {hp && (
          <g>
            <line
              x1={x(hover!)}
              x2={x(hover!)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              className="revenue-crosshair"
              stroke="var(--ink-32)"
              strokeWidth={1}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={x(hover!)}
              cy={y(hp[activeMetric])}
              r={4}
              fill="var(--rev)"
              stroke="white"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>

      {/* Tooltip */}
      {hp && (
        <div
          className={`revenue-chart-tooltip is-structured ${
            hover === 0 ? "is-start" : hover === points.length - 1 ? "is-end" : "is-middle"
          }`}
          style={{ left: `${hoverLeftPct}%` }}
        >
          <time dateTime={hp.date}>{fullDate(hp.date)}</time>
          <dl>
            <div className={activeMetric === "revenue" ? "is-active" : ""}>
              <dt><i aria-hidden />Faturamento</dt><dd>{money(hp.revenue, currency)}</dd>
            </div>
            <div className={activeMetric === "orders" ? "is-active" : ""}>
              <dt><i aria-hidden />Pedidos</dt><dd>{hp.orders.toLocaleString("pt-BR")}</dd>
            </div>
            <div className={activeMetric === "units" ? "is-active" : ""}>
              <dt><i aria-hidden />Unidades</dt><dd>{hp.units.toLocaleString("pt-BR")}</dd>
            </div>
          </dl>
          <p className={`revenue-tooltip-delta ${deltaTone}`}>{deltaText}</p>
        </div>
      )}
    </div>
  );
}
