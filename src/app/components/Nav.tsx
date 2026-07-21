"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { workspaceFromPath, type WorkspaceId } from "@/lib/integrations/workspaces";

interface NavItem {
  href: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  exact?: boolean;
}

const icons = {
  dashboard: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><rect x="3" y="3" width="8" height="9" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" /><rect x="13" y="10" width="8" height="11" rx="1.5" /><rect x="3" y="14" width="8" height="7" rx="1.5" /></svg>,
  integrations: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path d="M8 7V4m4 3V4M6 7h8v3a4 4 0 0 1-4 4v3" strokeLinecap="round" strokeLinejoin="round" /><path d="M10 17v3h8a2 2 0 0 0 2-2v-2" strokeLinecap="round" /><circle cx="20" cy="13" r="2" /></svg>,
  calculator: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h2M12 11h4M8 15h2M12 15h4" strokeLinecap="round" /></svg>,
  chart: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" strokeLinecap="round" /></svg>,
  performance: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path d="M4 19V9m5 10V5m5 14v-7m5 7V3" strokeLinecap="round" /><path d="m3 7 5-3 5 5 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  box: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path d="M3 9l9-5 9 5-9 5-9-5Z" strokeLinejoin="round" /><path d="M3 9v6l9 5 9-5V9M12 14v6" strokeLinejoin="round" /></svg>,
  search: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" strokeLinecap="round" /></svg>,
  tag: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path d="M20 13 13 20 4 11V4h7l9 9Z" strokeLinejoin="round" /><circle cx="8" cy="8" r="1.2" /></svg>,
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
