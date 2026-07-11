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
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-sm shadow-blue-600/25 ring-1 ring-inset ring-white/20">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-600">
            {eyebrow}
          </p>
          <h1 className="mt-0.5 text-[26px] font-bold leading-tight tracking-tight text-slate-900">
            {title}
          </h1>
          {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
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
};
