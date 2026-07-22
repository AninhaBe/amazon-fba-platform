"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Cable,
  Calculator,
  ChartColumn,
  LayoutDashboard,
  Package,
  Search,
  Tag,
  TrendingUp,
} from "lucide-react";
import { workspaceFromPath, type WorkspaceId } from "@/lib/integrations/workspaces";

interface NavItem {
  href: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  exact?: boolean;
}

const iconProps = { className: "h-5 w-5", strokeWidth: 1.8, "aria-hidden": true } as const;
const icons = {
  dashboard: <LayoutDashboard {...iconProps} />,
  integrations: <Cable {...iconProps} />,
  calculator: <Calculator {...iconProps} />,
  chart: <ChartColumn {...iconProps} />,
  performance: <TrendingUp {...iconProps} />,
  box: <Package {...iconProps} />,
  search: <Search {...iconProps} />,
  tag: <Tag {...iconProps} />,
};

const navigation: Record<WorkspaceId, NavItem[]> = {
  overview: [
    { href: "/", label: "Visão geral", desc: "Todos os canais", icon: icons.dashboard, exact: true },
    { href: "/integracoes", label: "Integrações", desc: "Contas e canais", icon: icons.integrations },
  ],
  amazon: [
    { href: "/amazon", label: "Dashboard", desc: "Visão do canal", icon: icons.dashboard, exact: true },
    { href: "/amazon/calculadora", label: "Calculadora", desc: "Lucro por ASIN", icon: icons.calculator },
    { href: "/amazon/monitor", label: "Monitor da conta", desc: "Pedidos e financeiro", icon: icons.chart },
    { href: "/amazon/desempenho", label: "Desempenho", desc: "Visitas e conversão", icon: icons.performance },
    { href: "/amazon/estoque", label: "Radar de estoque", desc: "Cobertura FBA", icon: icons.box },
    { href: "/amazon/anuncios", label: "Anúncios", desc: "Criar e publicar", icon: icons.tag },
    { href: "/amazon/pesquisa", label: "Pesquisa", desc: "Anúncios da Amazon", icon: icons.search },
    { href: "/amazon/produtos", label: "Produtos", desc: "Custos por SKU", icon: icons.tag },
  ],
  mercado_livre: [
    { href: "/mercado-livre", label: "Dashboard", desc: "Visão do canal", icon: icons.dashboard, exact: true },
    { href: "/mercado-livre/calculadora", label: "Calculadora", desc: "Preço e margem", icon: icons.calculator },
    { href: "/mercado-livre/monitor", label: "Monitor da conta", desc: "Pedidos e financeiro", icon: icons.chart },
    { href: "/mercado-livre/estoque", label: "Radar de estoque", desc: "Cobertura e ruptura", icon: icons.box },
    { href: "/mercado-livre/anuncios", label: "Anúncios", desc: "Catálogo publicado", icon: icons.tag },
    { href: "/mercado-livre/produtos", label: "Produtos", desc: "Custos e impostos", icon: icons.tag },
  ],
};

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function NavLinks({ variant }: { variant: "sidebar" | "top" }) {
  const pathname = usePathname();
  const workspace = workspaceFromPath(pathname);
  const items = navigation[workspace];

  return (
    <nav aria-label={`Navegação ${workspace === "overview" ? "geral" : workspace === "amazon" ? "Amazon" : "Mercado Livre"}`} className={variant === "top" ? "mobile-nav flex gap-0 overflow-x-auto" : "rail-nav flex flex-col gap-1"}>
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={variant === "top" ? `mobile-nav-item flex items-center gap-2 whitespace-nowrap px-3 py-2 text-xs font-semibold${active ? " is-active" : ""}` : `rail-nav-item group relative flex items-center gap-3 px-3 py-2.5${active ? " is-active" : ""}`}>
            <span className={variant === "top" ? "shrink-0" : "rail-nav-icon flex h-6 w-6 shrink-0 items-center justify-center"}>{item.icon}</span>
            {variant === "top" ? item.label : <span className="min-w-0"><span className="block text-sm font-semibold leading-tight">{item.label}</span><span className="rail-nav-desc mt-1 block text-xs leading-tight">{item.desc}</span></span>}
          </Link>
        );
      })}
    </nav>
  );
}
