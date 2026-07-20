"use client";

import { useRef, useState } from "react";

export interface DailyPoint {
  date: string;
  revenue: number;
  orders: number;
  units: number;
}

const W = 1000;
const H = 320;
const PAD = { top: 20, right: 16, bottom: 28, left: 56 };

function brl(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}
function compact(v: number) {
  if (v >= 1000) return `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  return `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}
function shortDate(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

export function RevenueChart({ points }: { points: DailyPoint[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-slate-400">
        Sem dados de vendas no período.
      </div>
    );
  }

  const maxRev = Math.max(...points.map((p) => p.revenue), 0);
  const niceMax = maxRev <= 0 ? 100 : Math.ceil(maxRev / 4) * 4 * 1.05;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const x = (i: number) =>
    PAD.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / niceMax) * plotH;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.revenue)}`).join(" ");
  const areaPath = `${linePath} L ${x(points.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`;

  // Linhas de grade / rótulos do eixo Y
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ t, v: niceMax * t, yy: y(niceMax * t) }));

  // Rótulos do eixo X (no máximo ~7)
  const step = Math.max(1, Math.ceil(points.length / 7));
  const xLabels = points.filter((_, i) => i % step === 0 || i === points.length - 1);

  const empty = maxRev <= 0;

  function onMove(e: React.MouseEvent) {
    const svg = ref.current;
    if (!svg) return;
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
  const hoverLeftPct = hover != null ? (x(hover) / W) * 100 : 0;

  return (
    <div className="relative">
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
        aria-label="Faturamento diário no período. Use as setas para consultar cada dia."
      >
        <defs>
          <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--rev)" stopOpacity="0.28" />
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
              className="stroke-slate-200 dark:stroke-slate-700"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={PAD.left - 8}
              y={g.yy + 4}
              textAnchor="end"
              className="fill-slate-400"
              fontSize={13}
            >
              {compact(g.v)}
            </text>
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
              className="fill-slate-400"
              fontSize={13}
            >
              {shortDate(p.date)}
            </text>
          );
        })}

        {!empty && (
          <>
            <path d={areaPath} fill="url(#revFill)" />
            <path
              d={linePath}
              fill="none"
              stroke="var(--rev)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {/* Ponto final destacado */}
            <circle cx={x(points.length - 1)} cy={y(points[points.length - 1].revenue)} r={4} fill="var(--rev)" />
          </>
        )}

        {/* Crosshair + ponto do hover */}
        {hp && (
          <g>
            <line
              x1={x(hover!)}
              x2={x(hover!)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--rev)"
              strokeWidth={1}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={x(hover!)}
              cy={y(hp.revenue)}
              r={5}
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
          className={`pointer-events-none absolute top-2 z-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md ${
            hover === 0 ? "" : hover === points.length - 1 ? "-translate-x-full" : "-translate-x-1/2"
          }`}
          style={{ left: `${hoverLeftPct}%` }}
        >
          <p className="font-semibold text-slate-900">{shortDate(hp.date)}</p>
          <p className="mt-0.5 text-slate-600">{brl(hp.revenue)}</p>
          <p className="text-slate-400">
            {hp.orders} {hp.orders === 1 ? "pedido" : "pedidos"} · {hp.units} un
          </p>
        </div>
      )}
    </div>
  );
}
