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

// A anatomia do bloco veio do peec.ai (`docs/identidade-visual.md`). Três coisas
// aqui são contraintuitivas e todas são deliberadas:
//
//   • O valor tem 16px, não 27px. Num painel com quatro, seis ou oito KPIs,
//     número grande não cria hierarquia — cria ruído uniforme, porque tudo grita
//     no mesmo volume. Quem diz o que importa é a frase acima da faixa.
//   • O rótulo é 14px em tinta terciária, não 11px em maiúscula espaçada.
//     Maiúscula pequena com tracking custa legibilidade e não estava marcando
//     hierarquia nenhuma — era decoração.
//   • As classes `text-slate-*` saíram. Eram tinta azulada do Tailwind dentro de
//     uma identidade monocromática, o mesmo defeito que o `<body>` carregava.
//     Tom agora sai de token, e só existe quando significa algo.
export function Metric({ label, value, sub, tone = "default", loading, icon, trend, href, className }: MetricProps) {
  const toneCls =
    tone === "danger" ? " metric-tone-danger"
      : tone === "warn" ? " metric-tone-warn"
        : tone === "positive" ? " metric-tone-positive"
          : "";
  const body = (
    <>
      <div className="metric-head">
        <p className="metric-label">{label}</p>
        {trend ? <TrendIndicator trend={trend} /> : icon && <span className="metric-icon">{icon}</span>}
      </div>
      <p className={`metric-value${toneCls}`}>
        {loading ? <span className="metric-loading">···</span> : value}
      </p>
      {sub && <p className="metric-sub">{sub}</p>}
    </>
  );
  if (href) {
    return <Link href={href} className={`metric-cell metric-cell-link${className ? ` ${className}` : ""}`}>{body}</Link>;
  }
  return <article className={`metric-cell${className ? ` ${className}` : ""}`}>{body}</article>;
}

export function CompactMetric({
  label,
  value,
  hint,
  loading = false,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
  tone?: "default" | "positive" | "danger" | "warn";
}) {
  return (
    <div className={`compact-metric compact-metric-${tone}`} aria-busy={loading || undefined}>
      <p>{label}</p>
      {loading ? <span className="compact-metric-skeleton" aria-label={`Carregando ${label}`} /> : <strong>{value}</strong>}
      {hint ? <small className="compact-metric-hint">{hint}</small> : null}
    </div>
  );
}

export function Flow({ label, value, sign, accent = false, tone = "positive" }: { label: string; value: string; sign?: "−" | "="; accent?: boolean; tone?: "positive" | "danger" | "default" }) {
  // Custo (sinal "−") em vermelho; subtotal ("=") e valores de entrada em tinta
  // cheia; o resultado final só ganha cor quando o dado permite afirmar o sinal.
  return (
    <div className={`financial-line ${accent ? `is-result is-result-${tone}` : ""}`}>
      <span className="financial-sign" aria-hidden="true">{sign}</span>
      <p className="text-xs font-medium text-[var(--ink-muted)]">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${accent ? tone === "positive" ? "text-emerald-700" : tone === "danger" ? "text-red-600" : "text-[var(--ink)]" : sign === "−" ? "text-red-600" : "text-[var(--ink)]"}`}>{value}</p>
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
        <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink-muted)]">
          {label}
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true" className={`text-[var(--ink-muted)] transition-transform duration-150 ${open ? "rotate-180" : ""}`}>
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
