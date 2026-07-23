"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
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
import { workspaceFromPath } from "@/lib/integrations/workspaces";
import { MarketplaceIcon } from "./MarketplaceIcon";

// Cabeçalho padrão das páginas: eyebrow + título + subtítulo, com um slot de ação.
// O ícone é sempre o logo do workspace, sem chip: Amazon/ML mostram o logo do
// marketplace; a Central mostra o logo do SellerCore.
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode; // aceito por compatibilidade; o glifo agora é sempre o logo do canal
  action?: ReactNode;
}) {
  const workspace = workspaceFromPath(usePathname());
  const provider = workspace === "amazon" ? "amazon" : workspace === "mercado_livre" ? "mercado_livre" : "sellercore";
  return (
    <div className="page-heading flex flex-wrap items-end justify-between gap-5">
      <div className="flex items-start gap-4">
        <span className="page-glyph is-bare flex h-11 w-11 shrink-0 items-center justify-center">
          <MarketplaceIcon provider={provider} app size={40} />
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
