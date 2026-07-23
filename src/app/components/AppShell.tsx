"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountSwitcher } from "./AccountSwitcher";
import { ChannelRail } from "./ChannelRail";
import { ChannelSwitcher } from "./ChannelSwitcher";
import { Logo } from "./Logo";
import { NavLinks } from "./Nav";
import { workspaceFromPath, type WorkspaceId } from "@/lib/integrations/workspaces";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { LogoutButton } from "./LogoutButton";

const channelName: Record<WorkspaceId, string> = { overview: "Central", amazon: "Amazon", mercado_livre: "Mercado Livre" };
const channelSub: Record<WorkspaceId, string> = { overview: "Todos os canais", amazon: "Operação Amazon", mercado_livre: "Operação Mercado Livre" };

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const workspace = workspaceFromPath(pathname);
  if (pathname.startsWith("/login")) return <>{children}</>;
  return (
    <div className="app-shell flex min-h-screen" data-channel={workspace}>
      <aside className="operations-rail sticky top-0 hidden h-screen w-64 shrink-0 lg:flex">
        <ChannelRail />
        <div className="rail-panel flex min-w-0 flex-1 flex-col">
          <div className="rail-panel-head px-4 py-5">
            <p className="rail-panel-title">{channelName[workspace]}</p>
            <p className="rail-panel-sub">{channelSub[workspace]}</p>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3">
            <NavLinks variant="sidebar" />
          </div>
          <div className="rail-account px-3 py-4">
            {workspace === "amazon" ? <AccountSwitcher /> : (
              <Link href="/integracoes" className="workspace-account-link">
                <span className="workspace-account-mark" aria-hidden="true"><MarketplaceIcon provider={workspace === "mercado_livre" ? "mercado_livre" : "sellercore"} size={24} /></span>
                <span>
                  <small>{workspace === "mercado_livre" ? "Conta Mercado Livre" : "Ecossistema SellerCore"}</small>
                  <strong>{workspace === "mercado_livre" ? "Gerenciar integração" : "Ver integrações"}</strong>
                </span>
              </Link>
            )}
            <LogoutButton />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="mobile-console sticky top-0 z-20 px-4 pt-3 lg:hidden">
          <div className="mb-2 flex items-center justify-between gap-4"><Logo compact /><div className="flex items-center gap-2"><ChannelSwitcher compact /><LogoutButton compact /></div></div>
          <NavLinks variant="top" />
        </header>
        <main id="main-content" tabIndex={-1} className="operations-canvas mx-auto w-full max-w-[1500px] flex-1 px-5 py-7 sm:px-8 lg:px-10 lg:py-9">{children}</main>
      </div>
    </div>
  );
}
