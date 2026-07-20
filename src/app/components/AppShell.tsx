"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountSwitcher } from "./AccountSwitcher";
import { ChannelSwitcher } from "./ChannelSwitcher";
import { Logo } from "./Logo";
import { NavLinks } from "./Nav";
import { workspaceFromPath } from "@/lib/integrations/workspaces";
import { MarketplaceIcon } from "./MarketplaceIcon";

const labels = { overview: "Central multicanal", amazon: "Operação Amazon", mercado_livre: "Operação Mercado Livre" };

export function AppShell({ children }: { children: React.ReactNode }) {
  const workspace = workspaceFromPath(usePathname());
  return (
    <div className="app-shell flex min-h-screen" data-channel={workspace}>
      <aside className="operations-rail sticky top-0 hidden h-screen w-56 shrink-0 flex-col lg:flex">
        <div className="rail-brand px-5 py-6"><Logo /></div>
        <div className="channel-dock px-3 py-4"><ChannelSwitcher /></div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <p className="rail-label px-3 pb-3 text-xs font-semibold uppercase tracking-[0.13em]">{labels[workspace]}</p>
          <NavLinks variant="sidebar" />
        </div>
        {workspace !== "mercado_livre" && <div className="rail-account px-4 py-4">
          {workspace === "amazon" ? <AccountSwitcher /> : (
            <Link href="/integracoes" className="workspace-account-link">
              <span className="workspace-account-mark" aria-hidden="true"><MarketplaceIcon provider="sellercore" size={22} /></span>
              <span><small>Ecossistema SellerCore</small><strong>Ver integrações</strong></span>
            </Link>
          )}
        </div>}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="mobile-console sticky top-0 z-20 px-4 pt-3 lg:hidden">
          <div className="mb-2 flex items-center justify-between gap-4"><Logo compact /><ChannelSwitcher compact /></div>
          <NavLinks variant="top" />
        </header>
        <main id="main-content" tabIndex={-1} className="operations-canvas mx-auto w-full max-w-[1500px] flex-1 px-5 py-7 sm:px-8 lg:px-10 lg:py-9">{children}</main>
      </div>
    </div>
  );
}
