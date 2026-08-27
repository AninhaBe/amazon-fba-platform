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
// marketplace; a Central mostra o logo do NEXO.
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
  const provider = workspace === "amazon"
    ? "amazon"
    : workspace === "mercado_livre"
      ? "mercado_livre"
      : workspace === "shopee"
        ? "shopee"
        : workspace === "tiktok_shop"
          ? "tiktok_shop"
        : "sellercore";
  return (
    <div className="page-heading">
      {/* Trilha: canal › página. Substitui o eyebrow em maiúscula espaçada no
          acento do canal. O eyebrow gritava a mesma informação que a sidebar já
          dava (em que canal você está) e gritava em cor. A trilha diz o mesmo em
          13px terciário e ainda situa a página dentro do canal. */}
      <p className="page-crumb">
        <MarketplaceIcon provider={provider} app size={16} />
        <span>{eyebrow}</span>
      </p>
      <div className="page-heading-row">
        <div className="page-heading-texto">
          {/* 20px, não 34px. O app do Peec não tem NADA acima de 16px numa tela
              de dado, e o título de seção fica em 20px — ver a seção 3 de
              `docs/peec-ui-audit.md`. Título grande não cria hierarquia num
              painel cheio de números; cria uma segunda coisa gritando. */}
          <h1>{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        {action && <div className="page-actions shrink-0">{action}</div>}
      </div>
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
