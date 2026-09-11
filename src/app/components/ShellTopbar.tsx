"use client";

import { TemaDoMenu } from "./TemaDoMenu";

import Link from "next/link";
import { CircleHelp, PanelLeftClose, PanelLeftOpen, Plug, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { workspaceFromPath } from "@/lib/integrations/workspaces";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { NEXO_ONBOARDING_OPEN_EVENT } from "@/lib/productTour";

const TITULOS: Record<string, string> = {
  "/": "Visão geral",
  "/amazon": "Dashboard Amazon",
  "/mercado-livre": "Dashboard Mercado Livre",
  "/shopee": "Dashboard Shopee",
  "/tiktok": "Dashboard TikTok Shop",
};

const NOMES_SEGMENTO: Record<string, string> = {
  abc: "Curva ABC",
  anuncios: "Anúncios",
  auditoria: "Pedidos a revisar",
  briefing: "Briefing",
  calculadora: "Calculadora",
  catalogo: "Anúncios",
  desempenho: "Desempenho",
  estoque: "Radar de estoque",
  financeiro: "Financeiro",
  historico: "Histórico",
  integracoes: "Integrações",
  configuracoes: "Configurações",
  perfil: "Perfil",
  monitor: "Monitor da conta",
  pesquisa: "Pesquisa",
  produtos: "Produtos",
};

function tituloDaRota(pathname: string) {
  if (TITULOS[pathname]) return TITULOS[pathname];
  const segmento = pathname.split("/").filter(Boolean).at(-1) ?? "";
  return NOMES_SEGMENTO[segmento] ?? "NEXO";
}

export function ShellTopbar({
  sidebarCollapsed,
  onToggleSidebar,
}: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const pathname = usePathname();
  const workspace = workspaceFromPath(pathname);
  const provider = workspace === "overview" ? "sellercore" : workspace;

  return (
    <header className="app-topbar hidden lg:flex">
      <div className="app-topbar-title">
        <button
          type="button"
          className="app-topbar-sidebar-toggle"
          aria-label={sidebarCollapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
          aria-pressed={sidebarCollapsed}
          onClick={onToggleSidebar}
        >
          {sidebarCollapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
        </button>
        <MarketplaceIcon provider={provider} app size={16} />
        <span>{tituloDaRota(pathname)}</span>
      </div>
      <nav className="app-topbar-actions" aria-label="Ações globais">
        <button type="button" onClick={() => window.dispatchEvent(new Event(NEXO_ONBOARDING_OPEN_EVENT))}>
          <CircleHelp aria-hidden />
          <span>Como funciona</span>
        </button>
        {sidebarCollapsed && (
          <Link href="/pesquisa" aria-label="Pesquisa">
            <Search aria-hidden />
            <span>Pesquisa</span>
          </Link>
        )}
        <Link href="/integracoes">
          <Plug aria-hidden />
          <span>Integrações</span>
        </Link>
        {/* ⚠️ O "Briefing" DA BARRA DE TOPO SAIU (pedido dela,
            10/09/2026). Ele levava ao briefing GLOBAL (`/briefing`), enquanto o
            item do menu lateral leva ao do CANAL (`/mercado-livre/briefing`) —
            dois destinos com o mesmo nome na mesma tela.

            ⚠️ E ISSO DEIXA O BRIEFING GLOBAL SEM ENTRADA VISIVEL.
            A rota continua de pe e responde por endereco direto; o que sumiu foi
            o atalho. Se ele precisar voltar, o lugar nao e aqui com o mesmo
            rotulo do item do canal — e distinguir os dois pelo nome. */}
        {/* Sol/lua no fim da fila: é ajuste de aparência, não navegação — fica
            depois de tudo que leva a algum lugar. */}
        <TemaDoMenu />
      </nav>
    </header>
  );
}
