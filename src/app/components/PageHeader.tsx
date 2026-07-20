import type { ReactNode } from "react";

// Cabeçalho padrão das páginas: ícone em chip de gradiente + eyebrow + título + subtítulo,
// com um slot de ação à direita (ex: seletor de período).
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  icon,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  icon: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading flex flex-wrap items-end justify-between gap-5">
      <div className="flex items-start gap-4">
        <span className="page-glyph flex h-11 w-11 shrink-0 items-center justify-center">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="page-kicker text-xs font-semibold uppercase tracking-[0.14em]">
            {eyebrow}
          </p>
          <h1 className="mt-1.5 text-balance text-[30px] font-bold leading-[1.08] tracking-[-0.035em] text-slate-900 lg:text-[34px]">
            {title}
          </h1>
          {subtitle && <p className="mt-2.5 max-w-3xl text-pretty text-[15px] leading-relaxed text-slate-600">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="page-actions shrink-0">{action}</div>}
      <span className="coreline" aria-hidden="true"><i /><i /><i /></span>
    </div>
  );
}

const sw = { fill: "none", stroke: "currentColor", strokeWidth: 1.7 } as const;

export const pageIcons: Record<string, ReactNode> = {
  dashboard: (
    <svg viewBox="0 0 24 24" {...sw} className="h-6 w-6">
      <rect x="3" y="3" width="8" height="9" rx="1.5" />
      <rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="10" width="8" height="11" rx="1.5" />
      <rect x="3" y="14" width="8" height="7" rx="1.5" />
    </svg>
  ),
  calculator: (
    <svg viewBox="0 0 24 24" {...sw} className="h-6 w-6">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8M8 11h2M12 11h4M8 15h2M12 15h4" strokeLinecap="round" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" {...sw} className="h-6 w-6">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" strokeLinecap="round" />
    </svg>
  ),
  performance: (
    <svg viewBox="0 0 24 24" {...sw} className="h-6 w-6">
      <path d="M4 19V9m5 10V5m5 14v-7m5 7V3" strokeLinecap="round" />
      <path d="m3 7 5-3 5 5 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  radar: (
    <svg viewBox="0 0 24 24" {...sw} className="h-6 w-6">
      <path d="M3 9l9-5 9 5-9 5-9-5Z" strokeLinejoin="round" />
      <path d="M3 9v6l9 5 9-5V9" strokeLinejoin="round" />
      <path d="M12 14v6" />
    </svg>
  ),
  box: (
    <svg viewBox="0 0 24 24" {...sw} className="h-6 w-6">
      <path d="M20 7 12 3 4 7v10l8 4 8-4V7Z" strokeLinejoin="round" />
      <path d="m4 7 8 4 8-4M12 11v10" strokeLinejoin="round" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" {...sw} className="h-6 w-6">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" strokeLinecap="round" />
    </svg>
  ),
  integrations: (
    <svg viewBox="0 0 24 24" {...sw} className="h-6 w-6">
      <path d="M8 7V4m4 3V4M6 7h8v3a4 4 0 0 1-4 4v3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 17v3h8a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
      <circle cx="20" cy="13" r="2" />
    </svg>
  ),
};
