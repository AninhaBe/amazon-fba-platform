"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { workspaceFromPath } from "@/lib/integrations/workspaces";
import { MarketplaceIcon } from "./MarketplaceIcon";

const channels = [
  { id: "overview", href: "/", label: "Visão geral", provider: "sellercore" },
  { id: "amazon", href: "/amazon", label: "Amazon", provider: "amazon" },
  { id: "mercado_livre", href: "/mercado-livre", label: "Mercado Livre", provider: "mercado_livre" },
  { id: "shopee", href: "/shopee", label: "Shopee", provider: "shopee" },
  { id: "tiktok_shop", href: "/tiktok", label: "TikTok Shop", provider: "tiktok_shop" },
] as const;

export function ChannelSwitcher({ compact = false }: { compact?: boolean }) {
  const workspace = workspaceFromPath(usePathname());
  return (
    <div
      className={`channel-switcher${compact ? " is-compact" : ""}`}
      role="navigation"
      aria-label="Alternar canal de venda"
      style={compact ? { flex: "1 1 auto", minWidth: 0, maxWidth: "calc(100% - 112px)", overflowX: "auto" } : undefined}
    >
      {channels.map((channel) => (
        <Link key={channel.id} href={channel.href} title={channel.label} aria-label={channel.label} aria-current={workspace === channel.id ? "page" : undefined} className={`channel-tab channel-${channel.id}${workspace === channel.id ? " is-active" : ""}`}>
          <span aria-hidden="true"><MarketplaceIcon provider={channel.provider} size={27} /></span>
        </Link>
      ))}
      {workspace === "overview" && <Link href="/integracoes" title="Adicionar canal" aria-label="Adicionar ou gerenciar integrações" className="channel-tab channel-add"><span aria-hidden="true">+</span></Link>}
    </div>
  );
}
