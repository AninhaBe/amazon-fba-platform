"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Blocks,
  Boxes,
  Calculator,
  ChevronDown,
  History,
  LayoutDashboard,
  Megaphone,
  Radar,
  Search,
  Sparkles,
  SquarePen,
  TrendingUp,
} from "lucide-react";
import { workspaceFromPath, type WorkspaceId } from "@/lib/integrations/workspaces";

interface NavItem {
  href: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  exact?: boolean;
  /** Sub-itens: páginas que só fazem sentido dentro deste item (ex.: Pesquisa → Histórico). */
  children?: NavItem[];
}

interface NavGroup {
  title?: string;
  tone: string;
  items: NavItem[];
}

const iconProps = { className: "h-5 w-5", strokeWidth: 1.8, "aria-hidden": true } as const;
const icons = {
  dashboard: <LayoutDashboard {...iconProps} />,
  integrations: <Blocks {...iconProps} />,
  calculator: <Calculator {...iconProps} />,
  monitor: <Activity {...iconProps} />,
  performance: <TrendingUp {...iconProps} />,
  ads: <Megaphone {...iconProps} />,
  create: <SquarePen {...iconProps} />,
  products: <Boxes {...iconProps} />,
  stock: <Radar {...iconProps} />,
  search: <Search {...iconProps} />,
  history: <History {...iconProps} />,
  briefing: <Sparkles {...iconProps} />,
};

const navigation: Record<WorkspaceId, NavGroup[]> = {
  overview: [
    {
      tone: "slate",
      items: [
        { href: "/", label: "Visão geral", desc: "Todos os canais", icon: icons.dashboard, exact: true },
        { href: "/integracoes", label: "Integrações", desc: "Contas e canais", icon: icons.integrations },
      ],
    },
  ],
  amazon: [
    {
      title: "Painéis",
      tone: "sky",
      items: [
        { href: "/amazon", label: "Dashboard", desc: "Visão do canal", icon: icons.dashboard, exact: true },
        { href: "/amazon/briefing", label: "Briefing", desc: "Prioridades do dia", icon: icons.briefing },
        { href: "/amazon/monitor", label: "Monitor da conta", desc: "Pedidos e financeiro", icon: icons.monitor },
      ],
    },
    {
      title: "Catálogo",
      tone: "emerald",
      items: [
        { href: "/amazon/catalogo", label: "Anúncios", desc: "Catálogo publicado", icon: icons.ads },
        { href: "/amazon/produtos", label: "Produtos", desc: "Custos por SKU", icon: icons.products },
        { href: "/amazon/estoque", label: "Radar de estoque", desc: "Cobertura FBA", icon: icons.stock },
        {
          href: "/amazon/pesquisa",
          label: "Pesquisa",
          desc: "Anúncios da Amazon",
          icon: icons.search,
          exact: true,
          children: [
            { href: "/amazon/pesquisa/historico", label: "Histórico", desc: "O que você acompanha", icon: icons.history },
          ],
        },
      ],
    },
    {
      title: "Ferramentas",
      tone: "violet",
      items: [
        { href: "/amazon/abc", label: "Curva ABC", desc: "Lucro por produto", icon: icons.performance },
        { href: "/amazon/calculadora", label: "Calculadora", desc: "Lucro por ASIN", icon: icons.calculator },
      ],
    },
  ],
  mercado_livre: [
    {
      title: "Painéis",
      tone: "sky",
      items: [
        { href: "/mercado-livre", label: "Dashboard", desc: "Visão do canal", icon: icons.dashboard, exact: true },
        { href: "/mercado-livre/monitor", label: "Monitor da conta", desc: "Pedidos e financeiro", icon: icons.monitor },
      ],
    },
    {
      title: "Catálogo",
      tone: "emerald",
      items: [
        { href: "/mercado-livre/anuncios", label: "Anúncios", desc: "Catálogo publicado", icon: icons.ads },
        { href: "/mercado-livre/produtos", label: "Produtos", desc: "Custos e impostos", icon: icons.products },
        { href: "/mercado-livre/estoque", label: "Radar de estoque", desc: "Cobertura e ruptura", icon: icons.stock },
      ],
    },
    {
      title: "Ferramentas",
      tone: "violet",
      items: [
        { href: "/mercado-livre/abc", label: "Curva ABC", desc: "Lucro por produto", icon: icons.performance },
        { href: "/mercado-livre/calculadora", label: "Calculadora", desc: "Preço e margem", icon: icons.calculator },
      ],
    },
  ],
};

const COLLAPSE_KEY = "sc-nav-collapsed";
// Guarda os ABERTOS (e não os fechados): a sanfona nasce recolhida.
const SUBNAV_KEY = "sc-nav-sub-open";

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Item + sub-itens em uma lista só — para o menu mobile e para achar o grupo ativo. */
function flatten(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => [item, ...(item.children ?? [])]);
}

function ItemLink({
  item,
  active,
  tabIndex,
  sub,
}: {
  item: NavItem;
  active: boolean;
  tabIndex?: number;
  sub?: boolean;
}) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      tabIndex={tabIndex}
      className={`rail-nav-item group relative flex flex-1 items-center gap-2.5 px-2.5${sub ? " is-sub py-2" : " py-2.5"}${active ? " is-active" : ""}`}
    >
      <span className={`rail-nav-icon flex shrink-0 items-center justify-center ${sub ? "h-5 w-5" : "h-6 w-6"}`}>{item.icon}</span>
      <span className="min-w-0">
        <span className={`block overflow-hidden text-ellipsis whitespace-nowrap font-semibold leading-tight ${sub ? "text-[12.5px]" : "text-[13px]"}`}>
          {item.label}
        </span>
        {/* O sub-item vive dentro do pai, que já dá o contexto: repetir a descrição só
            adicionaria ruído numa linha mais estreita. */}
        {!sub && (
          <span className="rail-nav-desc mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-tight">{item.desc}</span>
        )}
      </span>
    </Link>
  );
}

/**
 * Item com sub-itens em sanfona. A setinha é um controle SEPARADO do link: clicar no
 * rótulo navega, clicar na setinha só abre ou fecha — e o estado sobrevive à navegação
 * e ao reload, guardado no localStorage.
 *
 * Um cuidado: entrar num filho força a abertura. Sem isso dava para estar no Histórico
 * com a sanfona fechada, escondendo justamente o item onde a pessoa está.
 */
function ItemBlock({
  item,
  pathname,
  tabIndex,
  aberto,
  onToggle,
}: {
  item: NavItem;
  pathname: string;
  tabIndex?: number;
  aberto: boolean;
  onToggle: (href: string) => void;
}) {
  if (!item.children?.length) {
    return <ItemLink item={item} active={isActive(pathname, item)} tabIndex={tabIndex} />;
  }
  return (
    <div className="flex flex-col">
      <div className="flex items-stretch">
        <ItemLink item={item} active={isActive(pathname, item)} tabIndex={tabIndex} />
        <button
          type="button"
          className="rail-subnav-toggle"
          aria-expanded={aberto}
          aria-label={`${aberto ? "Recolher" : "Expandir"} ${item.label}`}
          tabIndex={tabIndex}
          onClick={() => onToggle(item.href)}
        >
          <ChevronDown className={`rail-subnav-chevron h-3.5 w-3.5${aberto ? " is-open" : ""}`} strokeWidth={2.4} aria-hidden />
        </button>
      </div>
      <div className={`rail-subnav-body${aberto ? " is-open" : ""}`} aria-hidden={!aberto}>
        <div className="rail-subnav flex flex-col gap-1 pt-1">
          {item.children.map((child) => (
            <ItemLink
              key={child.href}
              item={child}
              active={isActive(pathname, child)}
              tabIndex={aberto ? tabIndex : -1}
              sub
            />
          ))}
        </div>
      </div>
    </div>
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

  // --- sanfona dos sub-itens (guarda os ABERTOS: nasce recolhida) ---
  const [subAbertos, setSubAbertos] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SUBNAV_KEY);
      // Hidratação a partir do localStorage: não existe no servidor, então só dá para
      // ler depois da montagem. Mesmo padrão já usado pelo COLLAPSE_KEY acima.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setSubAbertos(new Set(JSON.parse(raw) as string[]));
    } catch {
      // ignora storage indisponível
    }
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(SUBNAV_KEY, JSON.stringify([...subAbertos]));
    } catch {
      // ignora storage indisponível
    }
  }, [subAbertos]);

  // Entrar num sub-item força a abertura — senão dá para estar no Histórico com a
  // sanfona fechada, escondendo justamente o item onde a pessoa está.
  useEffect(() => {
    const pai = navigation[workspaceFromPath(pathname)]
      .flatMap((g) => g.items)
      .find((i) => i.children?.some((c) => isActive(pathname, c)));
    if (!pai) return;
    // Sincroniza a sanfona com a rota — é reação a mudança externa (navegação), não
    // render em cascata: o updater devolve o mesmo Set quando já está aberto.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubAbertos((prev) => (prev.has(pai.href) ? prev : new Set(prev).add(pai.href)));
  }, [pathname]);

  function toggleSub(href: string) {
    setSubAbertos((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });
  }

  // A seção da página atual nunca fica escondida: ao navegar, ela abre sozinha.
  useEffect(() => {
    const wsGroups = navigation[workspaceFromPath(pathname)];
    const activeTitle = wsGroups.find((group) => flatten(group.items).some((item) => isActive(pathname, item)))?.title;
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
    // No mobile a barra é horizontal e rolável: não há hierarquia para representar,
    // então os sub-itens entram na sequência, logo depois do pai.
    const items = groups.flatMap((group) => flatten(group.items));
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
            <div key={`group-${index}`} className="rail-group flex flex-col gap-1" data-tone={group.tone}>
              {group.items.map((item) => (
                <ItemBlock key={item.href} item={item} pathname={pathname} aberto={subAbertos.has(item.href)} onToggle={toggleSub} />
              ))}
            </div>
          );
        }
        const title = group.title;
        const open = !collapsed.has(title);
        const bodyId = `rail-group-${workspace}-${index}`;
        return (
          <div key={title} className="rail-group" data-tone={group.tone}>
            <button type="button" className="rail-group-header" aria-expanded={open} aria-controls={bodyId} onClick={() => toggle(title)}>
              <span className="rail-group-label">{title}</span>
              <ChevronDown className={`rail-group-chevron h-3.5 w-3.5${open ? " is-open" : ""}`} strokeWidth={2} aria-hidden />
            </button>
            <div id={bodyId} className={`rail-group-body${open ? " is-open" : ""}`} aria-hidden={!open}>
              <div className="rail-group-body-inner flex flex-col gap-1 pt-1">
                {group.items.map((item) => (
                  <ItemBlock
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    tabIndex={open ? undefined : -1}
                    aberto={subAbertos.has(item.href)}
                    onToggle={toggleSub}
                  />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
