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

interface NavGroup {
  title?: string;
  items: NavItem[];
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

const navigation: Record<WorkspaceId, NavGroup[]> = {
  overview: [
    {
      items: [
        { href: "/", label: "Visão geral", desc: "Todos os canais", icon: icons.dashboard, exact: true },
        { href: "/integracoes", label: "Integrações", desc: "Contas e canais", icon: icons.integrations },
      ],
    },
  ],
  amazon: [
    {
      title: "Painéis",
      items: [
        { href: "/amazon", label: "Dashboard", desc: "Visão do canal", icon: icons.dashboard, exact: true },
        { href: "/amazon/monitor", label: "Monitor da conta", desc: "Pedidos e financeiro", icon: icons.chart },
        { href: "/amazon/desempenho", label: "Desempenho", desc: "Visitas e conversão", icon: icons.performance },
      ],
    },
    {
      title: "Catálogo",
      items: [
        { href: "/amazon/anuncios", label: "Anúncios", desc: "Criar e publicar", icon: icons.tag },
        { href: "/amazon/produtos", label: "Produtos", desc: "Custos por SKU", icon: icons.tag },
        { href: "/amazon/estoque", label: "Radar de estoque", desc: "Cobertura FBA", icon: icons.box },
        { href: "/amazon/pesquisa", label: "Pesquisa", desc: "Anúncios da Amazon", icon: icons.search },
      ],
    },
    {
      title: "Ferramentas",
      items: [
        { href: "/amazon/calculadora", label: "Calculadora", desc: "Lucro por ASIN", icon: icons.calculator },
      ],
    },
  ],
  mercado_livre: [
    {
      title: "Painéis",
      items: [
        { href: "/mercado-livre", label: "Dashboard", desc: "Visão do canal", icon: icons.dashboard, exact: true },
        { href: "/mercado-livre/monitor", label: "Monitor da conta", desc: "Pedidos e financeiro", icon: icons.chart },
      ],
    },
    {
      title: "Catálogo",
      items: [
        { href: "/mercado-livre/anuncios", label: "Anúncios", desc: "Catálogo publicado", icon: icons.tag },
        { href: "/mercado-livre/produtos", label: "Produtos", desc: "Custos e impostos", icon: icons.tag },
        { href: "/mercado-livre/estoque", label: "Radar de estoque", desc: "Cobertura e ruptura", icon: icons.box },
      ],
    },
    {
      title: "Ferramentas",
      items: [
        { href: "/mercado-livre/calculadora", label: "Calculadora", desc: "Preço e margem", icon: icons.calculator },
      ],
    },
  ],
};

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function NavLinks({ variant }: { variant: "sidebar" | "top" }) {
  const pathname = usePathname();
  const workspace = workspaceFromPath(pathname);
  const groups = navigation[workspace];
  const ariaLabel = `Navegação ${workspace === "overview" ? "geral" : workspace === "amazon" ? "Amazon" : "Mercado Livre"}`;

  if (variant === "top") {
    const items = groups.flatMap((group) => group.items);
    return (
      <nav aria-label={ariaLabel} className="mobile-nav flex gap-0 overflow-x-auto">
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`mobile-nav-item flex items-center gap-2 whitespace-nowrap px-3 py-2 text-xs font-semibold${active ? " is-active" : ""}`}>
              <span className="shrink-0">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label={ariaLabel} className="rail-nav flex flex-col">
      {groups.map((group, index) => (
        <div key={group.title ?? `group-${index}`} className="rail-group">
          {group.title && <p className="rail-group-label">{group.title}</p>}
          <div className="flex flex-col gap-1">
            {group.items.map((item) => {
              const active = isActive(pathname, item);
              return (
                <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`rail-nav-item group relative flex items-center gap-3 px-3 py-2.5${active ? " is-active" : ""}`}>
                  <span className="rail-nav-icon flex h-6 w-6 shrink-0 items-center justify-center">{item.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-tight">{item.label}</span>
                    <span className="rail-nav-desc mt-1 block text-xs leading-tight">{item.desc}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
