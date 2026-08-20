"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Box,
  Calculator,
  ChevronDown,
  History,
  LayoutDashboard,
  Gauge,
  Lightbulb,
  Megaphone,
  Plug,
  Search,
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

/**
 * Peso e tamanho medidos no menu do `2.datadive.tools` (19/08/2026): ícones de
 * 18px com traço 1.5. O nosso estava em 20px com 1.8, o que engrossava o
 * desenho e deixava a calha visualmente pesada.
 *
 * Só o SVG encolhe — a caixa que o envolve continua 24px (`h-6 w-6`), que é a
 * medida que centraliza o ícone na calha de 60px do menu fechado. Ver a conta
 * em `globals.css` → "Menu que encolhe".
 */
const iconProps = { className: "h-[18px] w-[18px]", strokeWidth: 1.5, "aria-hidden": true } as const;
/**
 * Glifos escolhidos pelo mesmo critério do menu do DataDive: **um objeto só,
 * sem detalhe interno**. Quatro dos nossos eram desenhos carregados e é o que
 * fazia a calha parecer suja, mais do que a espessura do traço:
 *
 *   Boxes (3 cubos sobrepostos)   → Box       — uma caixa lisa
 *   Radar (arcos + varredura)     → Gauge     — um ponteiro
 *   Sparkles (3 estrelas)         → Lightbulb — uma lâmpada
 *   Blocks (blocos em 3D)         → Plug      — uma tomada
 *
 * `Calculator` fica: a grade de teclas é detalhada, mas qualquer troca perde o
 * significado, e significado ganha de limpeza num menu.
 */
const icons = {
  dashboard: <LayoutDashboard {...iconProps} />,
  integrations: <Plug {...iconProps} />,
  calculator: <Calculator {...iconProps} />,
  monitor: <Activity {...iconProps} />,
  performance: <TrendingUp {...iconProps} />,
  ads: <Megaphone {...iconProps} />,
  create: <SquarePen {...iconProps} />,
  products: <Box {...iconProps} />,
  stock: <Gauge {...iconProps} />,
  search: <Search {...iconProps} />,
  history: <History {...iconProps} />,
  briefing: <Lightbulb {...iconProps} />,
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
        { href: "/mercado-livre/auditoria", label: "Pedidos a revisar", desc: "Frete cobrado × declarado", icon: icons.monitor },
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
  shopee: [
    {
      title: "Painéis",
      tone: "sky",
      items: [
        { href: "/shopee", label: "Dashboard", desc: "Visão do canal", icon: icons.dashboard, exact: true },
        { href: "/shopee/monitor", label: "Monitor da conta", desc: "Pedidos e financeiro", icon: icons.monitor },
      ],
    },
    { title: "Catálogo", tone: "emerald", items: [
      { href: "/shopee/catalogo", label: "Anúncios", desc: "Catálogo publicado", icon: icons.ads },
      { href: "/shopee/produtos", label: "Produtos", desc: "Custos por SKU", icon: icons.products },
      { href: "/shopee/estoque", label: "Radar de estoque", desc: "Cobertura agregada", icon: icons.stock },
    ] },
    { title: "Ferramentas", tone: "violet", items: [
      { href: "/shopee/abc", label: "Curva ABC", desc: "Receita por produto", icon: icons.performance },
    ] },
  ],
  // As rotas abaixo refletem os módulos TikTok implementados sobre sync, cron e
  // overview canônico. A validação financeira real ainda é parcial.
  tiktok_shop: [
    {
      title: "Painéis",
      tone: "sky",
      items: [
        { href: "/tiktok", label: "Dashboard", desc: "Visão do canal", icon: icons.dashboard, exact: true },
        { href: "/tiktok/monitor", label: "Monitor da conta", desc: "Pedidos e conciliação", icon: icons.monitor },
        { href: "/tiktok/financeiro", label: "Financeiro", desc: "Transações e cobertura", icon: icons.performance },
      ],
    },
    {
      title: "Catálogo",
      tone: "emerald",
      items: [
        { href: "/tiktok/catalogo", label: "Anúncios", desc: "Catálogo publicado", icon: icons.ads },
        { href: "/tiktok/produtos", label: "Produtos", desc: "Custos por SKU", icon: icons.products },
        { href: "/tiktok/estoque", label: "Radar de estoque", desc: "Cobertura e ruptura", icon: icons.stock },
      ],
    },
    {
      title: "Ferramentas",
      tone: "violet",
      items: [
        { href: "/tiktok/abc", label: "Curva ABC", desc: "Receita por produto", icon: icons.performance },
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
      title={`${item.label} — ${item.desc}`}
      aria-current={active ? "page" : undefined}
      tabIndex={tabIndex}
      className={`rail-nav-item group relative flex flex-1 items-center gap-2.5 px-2.5${sub ? " is-sub py-2" : " py-2.5"}${active ? " is-active" : ""}`}
    >
      <span className={`rail-nav-icon flex shrink-0 items-center justify-center ${sub ? "h-5 w-5" : "h-6 w-6"}`}>{item.icon}</span>
      {/* `rail-nav-text` existe para o menu encolhido poder apagar só o texto,
          mantendo o ícone na calha. Ver `globals.css` → "Menu que encolhe". */}
      <span className="rail-nav-text min-w-0">
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

export function NavLinks({
  variant,
  workspace: workspaceForcado,
  compact = false,
}: {
  variant: "sidebar" | "top";
  /** Só a bancada `/lab/rail` passa isto: fora dela o canal vem da URL. */
  workspace?: WorkspaceId;
  /** Sidebar inteira recolhida: mantém todas as rotas acessíveis por ícone. */
  compact?: boolean;
}) {
  const pathname = usePathname();
  const workspace = workspaceForcado ?? workspaceFromPath(pathname);
  const groups = navigation[workspace];
  const workspaceLabel: Record<WorkspaceId, string> = { overview: "geral", amazon: "Amazon", mercado_livre: "Mercado Livre", shopee: "Shopee", tiktok_shop: "TikTok Shop" };
  const ariaLabel = `Navegação ${workspaceLabel[workspace]}`;

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const hydrated = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem(COLLAPSE_KEY);
        if (raw) {
          setCollapsed(new Set(JSON.parse(raw) as string[]));
        }
      } catch {
        // ignora storage indisponível
      } finally {
        hydrated.current = true;
      }
    }, 0);
    return () => window.clearTimeout(timer);
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

  // A seção da rota atual é sempre visível. Derivar isso do pathname evita uma
  // janela entre navegação e efeito (inclusive enquanto o storage ainda hidrata).
  const activeTitle = groups.find((group) => flatten(group.items).some((item) => isActive(pathname, item)))?.title;

  // Ao ENTRAR numa rota, revele o grupo correspondente. Depois disso o controle
  // continua sendo uma sanfona de verdade: a pessoa pode recolher inclusive o
  // grupo atual, como na referência, e a seta sempre representa o estado real.
  useEffect(() => {
    if (!activeTitle) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed((prev) => {
      if (!prev.has(activeTitle)) return prev;
      const next = new Set(prev);
      next.delete(activeTitle);
      return next;
    });
  }, [activeTitle, pathname]);

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

  if (compact) {
    return (
      <nav aria-label={ariaLabel} className="rail-nav flex flex-col">
        {groups.map((group, index) => (
          <div key={group.title ?? `group-${index}`} className="rail-group flex flex-col gap-1" data-tone={group.tone}>
            {flatten(group.items).map((item) => (
              <ItemLink key={item.href} item={item} active={isActive(pathname, item)} sub={item.href.split("/").length > 3} />
            ))}
          </div>
        ))}
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
              <svg
                className={`rail-group-chevron${open ? " is-open" : ""}`}
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden
              >
                <path
                  d="M8.67171 5.25C9.66052 5.25031 10.2007 6.40372 9.56777 7.16351L7.8964 9.1693C7.43003 9.72866 6.57066 9.72854 6.10423 9.1693L4.43286 7.16351C3.79969 6.40366 4.33991 5.25012 5.32894 5.25H8.67171Z"
                  fill="currentColor"
                />
              </svg>
              <span className="rail-group-label">{title}</span>
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
