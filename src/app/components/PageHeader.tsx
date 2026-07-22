import type { ReactNode } from "react";
import {
  Cable,
  Calculator,
  ChartColumn,
  LayoutDashboard,
  Package,
  Radar,
  Search,
  TrendingUp,
} from "lucide-react";

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

// Ícones do Lucide: traço consistente, desenho profissional, tree-shakeable.
const iconProps = { className: "h-6 w-6", strokeWidth: 1.7, "aria-hidden": true } as const;

export const pageIcons: Record<string, ReactNode> = {
  dashboard: <LayoutDashboard {...iconProps} />,
  calculator: <Calculator {...iconProps} />,
  chart: <ChartColumn {...iconProps} />,
  performance: <TrendingUp {...iconProps} />,
  radar: <Radar {...iconProps} />,
  box: <Package {...iconProps} />,
  search: <Search {...iconProps} />,
  integrations: <Cable {...iconProps} />,
};
