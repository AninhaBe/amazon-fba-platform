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
import { TrialNotice } from "./TrialNotice";
import { ShellTopbar } from "./ShellTopbar";

const SIDEBAR_COLLAPSED_KEY = "nexo:sidebar-collapsed";

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
  // Login e landing não usam a casca do app: a landing é a porta de entrada e
  // não pode aparecer com o menu lateral de quem já está logado. `/lab` é o
  // laboratório de protótipos — ele desenha o próprio menu, e a casca por fora
  // deixaria dois menus laterais na tela.
  if (pathname.startsWith("/login") || pathname.startsWith("/landing") || pathname.startsWith("/lab")) return <>{children}</>;
  return (
    <div className="app-shell flex min-h-screen" data-channel={workspace}>
      <SidebarNexo workspace={workspace} collapsed={sidebarCollapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="mobile-console sticky top-0 z-20 px-4 pt-3 lg:hidden">
          <div className="mb-2 flex items-center justify-between gap-4"><Logo compact /><div className="flex items-center gap-2"><ChannelSwitcher compact /><LogoutButton compact /></div></div>
          <NavLinks variant="top" />
        </header>
        <ShellTopbar
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
        />
        <TrialNotice />
        {/* Sem `max-w` e sem padding grande: a referência deixa o conteúdo
            crescer com a tela e usa 24px de respiro lateral. O container de
            1500px centralizado deixava faixa morta dos dois lados em monitor
            largo, justamente onde a tabela precisa de coluna. */}
        <main id="main-content" tabIndex={-1} className={`operations-canvas flex-1${isDashboard ? " is-dashboard" : ""}`}>{children}</main>
      </div>
    </div>
  );
}
