"use client";

import Link from "next/link";
import type { DailyPoint } from "./RevenueChart";

// Blocos de indicador compartilhados entre os canais (antes duplicados no
// dashboard da Amazon e no workspace do Mercado Livre). O acento por canal vem
// do CSS via data-channel; aqui só existe estrutura.

export interface RevenueTrend {
  direction: "up" | "down" | "flat";
  percentage: number | null;
}

/** Compara as duas metades do período: a seta dos KPIs de faturamento. */
export function getRevenueTrend(points: DailyPoint[]): RevenueTrend | null {
  if (points.length < 2) return null;
  const blockSize = Math.floor(points.length / 2);
  const comparable = points.slice(points.length - blockSize * 2);
  const previous = comparable.slice(0, blockSize).reduce((total, point) => total + point.revenue, 0);
  const current = comparable.slice(blockSize).reduce((total, point) => total + point.revenue, 0);
  if (previous === 0 && current === 0) return { direction: "flat", percentage: 0 };
  if (previous === 0) return { direction: "up", percentage: null };
  const percentage = ((current - previous) / previous) * 100;
  const direction = percentage > 0.5 ? "up" : percentage < -0.5 ? "down" : "flat";
  return { direction, percentage };
}

export function TrendIndicator({ trend }: { trend: RevenueTrend }) {
  const isUp = trend.direction === "up";
  const isDown = trend.direction === "down";
  const label = trend.percentage === null ? "novo ritmo" : `${Math.abs(trend.percentage).toFixed(1)}%`;
  const context = "Comparação entre as duas metades do período selecionado";
  return (
    <span
      className={`revenue-trend revenue-trend-${trend.direction}`}
      title={context}
      aria-label={`${isUp ? "Crescimento" : isDown ? "Queda" : "Estável"}: ${label}. ${context}.`}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        {isUp ? <path d="m3 10 5-5 5 5M8 5v8" /> : isDown ? <path d="m3 6 5 5 5-5M8 3v8" /> : <path d="M3 8h10" />}
      </svg>
      {label}
    </span>
  );
}

export interface MetricProps {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: "default" | "ok" | "warn" | "danger" | "positive";
  loading?: boolean;
  icon?: React.ReactNode;
  trend?: RevenueTrend | null;
  /** Presente = o cartão inteiro vira link (ex.: KPI de estoque → radar). */
  href?: string;
  /** Classe extra no cartão (ex.: forçar o acento do topo por semântica). */
  className?: string;
}

export function Metric({ label, value, sub, tone = "default", loading, icon, trend, href, className }: MetricProps) {
  const toneCls =
    tone === "danger" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "positive" ? "text-emerald-700" : tone === "ok" ? "text-slate-700" : "text-slate-900";
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        {trend ? <TrendIndicator trend={trend} /> : icon && <span className="metric-icon">{icon}</span>}
      </div>
      <p className={`mt-2 text-[27px] font-bold leading-none tabular-nums ${toneCls}`}>
        {loading ? <span className="text-slate-300">···</span> : value}
      </p>
      {sub && <p className="mt-1.5 text-xs text-slate-400">{sub}</p>}
    </>
  );
  if (href) {
    return <Link href={href} className={`metric-cell metric-cell-link block p-5${className ? ` ${className}` : ""}`}>{body}</Link>;
  }
  return <article className={`metric-cell p-5${className ? ` ${className}` : ""}`}>{body}</article>;
}

export function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="compact-metric">
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

export function Flow({ label, value, sign, accent = false }: { label: string; value: string; sign?: "−" | "="; accent?: boolean }) {
  // Custo (sinal "−") em vermelho; subtotal ("=") e valores de entrada em tinta
  // cheia; resultado final (accent) em verde. Coerência visual entre os canais.
  return (
    <div className={`financial-line ${accent ? "is-result" : ""}`}>
      <span className="financial-sign" aria-hidden="true">{sign}</span>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${accent ? "text-emerald-700" : sign === "−" ? "text-red-600" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}

// Linha de custo que abre um detalhamento (a "seta pra distrinchar os custos").
// Reaproveita o grid de .financial-line; o valor agregado fica em vermelho e as
// parcelas aparecem indentadas abaixo quando aberta.
export function FlowExpandable({ label, value, items, open, onToggle }: {
  label: string;
  value: string;
  items: Array<{ label: string; value: string }>;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <button type="button" onClick={onToggle} aria-expanded={open} className="financial-line financial-line-toggle">
        <span className="financial-sign" aria-hidden="true">−</span>
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          {label}
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true" className={`text-slate-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`}>
            <path d="m4 6 4 4 4-4" />
          </svg>
        </span>
        <span className="text-sm font-bold tabular-nums text-red-600">{value}</span>
      </button>
      {open && (
        <div className="financial-sublines">
          {items.map((item) => (
            <div key={item.label} className="financial-subline">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
