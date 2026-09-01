"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ChannelSwitcher } from "./ChannelSwitcher";
import { Logo } from "./Logo";
import { NavLinks } from "./Nav";
// `OperationsRail` (duas calhas de ícone) continua no repositório e é o que a
// bancada `/lab/rail` exercita. A casca passou a usar a sidebar única com
// rótulo sempre visível — ver a nota de cabeçalho em `SidebarNexo.tsx`.
import { SidebarNexo } from "./SidebarNexo";
import { workspaceFromPath } from "@/lib/integrations/workspaces";
import { LogoutButton } from "./LogoutButton";
import { CrispChat } from "./CrispChat";
import { TrialNotice } from "./TrialNotice";
import { NexoOnboarding } from "./NexoOnboarding";
import { ShellTopbar } from "./ShellTopbar";
import Link from "next/link";
import { Settings } from "lucide-react";
import {
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_PREFERENCE_EVENT,
  type SidebarPreferenceDetail,
} from "@/lib/navigationPreferences";
import accountStyles from "./ShellAccountLinks.module.css";

/**
 * Há sessão neste navegador?
 *
 * ⚠️ Lê o COOKIE, não pergunta ao servidor: a casca é decidida a cada render, e
 * uma chamada de auth aqui seria uma por página, no caminho da requisição — o
 * oposto do que o postmortem do pool esgotado (29/08/2026) mandou fazer. O
 * cookie do Supabase é o mesmo que o proxy já lê para decidir a rota, então os
 * dois não têm como discordar.
 *
 * No servidor devolve `false` ("assuma que há sessão"): é o que mantém o HTML
 * pré-renderizado das telas autenticadas igual ao que o cliente monta. A raiz
 * sem sessão vem do rewrite, cujo HTML é o da landing — que já não tem casca.
 */
function usarSemSessao(): boolean {
  if (typeof document === "undefined") return false;
  return !/(^|;\s*)sb-[^=]*-auth-token=/.test(document.cookie);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const semSessao = usarSemSessao();
  const pathname = usePathname();
  const workspace = workspaceFromPath(pathname);
  const isDashboard = ["/", "/amazon", "/mercado-livre", "/shopee", "/tiktok"].includes(pathname);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarHydrated = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
      } catch {
        // Storage indisponível não impede a navegação; o padrão aberto permanece.
      } finally {
        sidebarHydrated.current = true;
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!sidebarHydrated.current) return;
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      // A preferência é um aprimoramento; a navegação não depende do storage.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    const syncPreference = (event: Event) => {
      const detail = (event as CustomEvent<SidebarPreferenceDetail>).detail;
      if (typeof detail?.collapsed === "boolean") setSidebarCollapsed(detail.collapsed);
    };
    window.addEventListener(SIDEBAR_PREFERENCE_EVENT, syncPreference);
    return () => window.removeEventListener(SIDEBAR_PREFERENCE_EVENT, syncPreference);
  }, []);
  // As rotas públicas não usam a casca autenticada. Manter esta lista coerente
  // com `publicPaths` do proxy evita, por exemplo, uma política pública com a
  // sidebar e o seletor da conta de quem já estiver logado. `/lab` desenha a
  // própria navegação em desenvolvimento.
  //
  // ⚠️ E A LISTA SOZINHA NÃO BASTA DESDE 01/09/2026, quando a raiz passou a
  // servir a landing por REWRITE.
  //
  // Rewrite mantém o endereço em `/` — é o ponto dele —, então `pathname`
  // continua sendo `/` e nenhuma linha desta lista casa. Sem a regra de sessão
  // abaixo, a landing renderizaria DENTRO da moldura autenticada, com sidebar,
  // topo e seletor de conta, para um visitante que nunca logou: a primeira tela
  // de um cliente novo mostrando navegação de um produto que ele não tem.
  //
  // Por isso a condição passou a olhar SESSÃO, e não só endereço. Lista é
  // enumeração — ela protege os caminhos que alguém lembrou de escrever. Sessão
  // é a propriedade que realmente decide se existe casca para mostrar, e o
  // próximo endereço público entra protegido sem ninguém editar nada.
  if (
    semSessao ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/landing") ||
    pathname.startsWith("/privacidade") ||
    pathname.startsWith("/lab")
  ) return <>{children}</>;
  return (
    <div className="app-shell flex min-h-screen" data-channel={workspace}>
      <SidebarNexo workspace={workspace} collapsed={sidebarCollapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="mobile-console sticky top-0 z-20 px-4 pt-3 lg:hidden">
          <div className="mb-2 flex min-w-0 items-center justify-between gap-2"><Logo compact /><div className="flex min-w-0 flex-1 items-center justify-end gap-1.5"><ChannelSwitcher compact /><Link href="/configuracoes" className={accountStyles.mobileAction} aria-label="Configurações e perfil"><Settings aria-hidden /></Link><LogoutButton compact /></div></div>
          <NavLinks variant="top" />
        </header>
        <ShellTopbar
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
        />
        <TrialNotice />
        <NexoOnboarding />
        {/* Suporte via Crisp — só aqui, DEPOIS do early-return das rotas
            públicas: landing/login/privacidade nunca carregam o script. */}
        <CrispChat />
        {/* Sem `max-w` e sem padding grande: a referência deixa o conteúdo
            crescer com a tela e usa 24px de respiro lateral. O container de
            1500px centralizado deixava faixa morta dos dois lados em monitor
            largo, justamente onde a tabela precisa de coluna. */}
        <main id="main-content" tabIndex={-1} className={`operations-canvas flex-1${isDashboard ? " is-dashboard" : ""}`}>{children}</main>
      </div>
    </div>
  );
}
