"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Cable,
  Calculator,
  ChartColumn,
  ChevronDown,
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

const COLLAPSE_KEY = "sc-nav-collapsed";

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function ItemLink({ item, active, tabIndex }: { item: NavItem; active: boolean; tabIndex?: number }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      tabIndex={tabIndex}
      className={`rail-nav-item group relative flex items-center gap-3 px-3 py-2.5${active ? " is-active" : ""}`}
    >
      <span className="rail-nav-icon flex h-6 w-6 shrink-0 items-center justify-center">{item.icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight">{item.label}</span>
        <span className="rail-nav-desc mt-1 block text-xs leading-tight">{item.desc}</span>
      </span>
    </Link>
  );
}

export function NavLinks({ variant }: { variant: "sidebar" | "top" }) {
  const pathname = usePathname();
  const workspace = workspaceFromPath(pathname);
  const groups = navigation[workspace];
  const ariaLabel = `Navegação ${workspace === "overview" ? "geral" : workspace === "amazon" ? "Amazon" : "Mercado Livre"}`;

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (raw) setCollapsed(new Set(JSON.parse(raw) as string[]));
    } catch {
      // ignora storage indisponível
    }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
    } catch {
      // ignora storage indisponível
    }
  }, [collapsed]);

  // A seção da página atual nunca fica escondida: ao navegar, ela abre sozinha.
  useEffect(() => {
    const wsGroups = navigation[workspaceFromPath(pathname)];
    const activeTitle = wsGroups.find((group) => group.items.some((item) => isActive(pathname, item)))?.title;
    if (!activeTitle) return;
    setCollapsed((prev) => {
      if (!prev.has(activeTitle)) return prev;
      const next = new Set(prev);
      next.delete(activeTitle);
      return next;
    });
  }, [pathname]);

  function toggle(title: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

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
      {groups.map((group, index) => {
        if (!group.title) {
          return (
            <div key={`group-${index}`} className="rail-group flex flex-col gap-1">
              {group.items.map((item) => (
                <ItemLink key={item.href} item={item} active={isActive(pathname, item)} />
              ))}
            </div>
          );
        }
        const title = group.title;
        const open = !collapsed.has(title);
        const bodyId = `rail-group-${workspace}-${index}`;
        return (
          <div key={title} className="rail-group">
            <button type="button" className="rail-group-header" aria-expanded={open} aria-controls={bodyId} onClick={() => toggle(title)}>
              <span className="rail-group-label">{title}</span>
              <ChevronDown className={`rail-group-chevron h-3.5 w-3.5${open ? " is-open" : ""}`} strokeWidth={2} aria-hidden />
            </button>
            <div id={bodyId} className={`rail-group-body${open ? " is-open" : ""}`} aria-hidden={!open}>
              <div className="rail-group-body-inner flex flex-col gap-1 pt-1">
                {group.items.map((item) => (
                  <ItemLink key={item.href} item={item} active={isActive(pathname, item)} tabIndex={open ? undefined : -1} />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
