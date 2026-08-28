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

export function AppShell({ children }: { children: React.ReactNode }) {
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
  if (
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
