"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { workspaceFromPath } from "@/lib/integrations/workspaces";
import { MarketplaceIcon } from "./MarketplaceIcon";

const channels = [
  { id: "overview", href: "/", label: "Central", provider: "sellercore" },
  { id: "amazon", href: "/amazon", label: "Amazon", provider: "amazon" },
  { id: "mercado_livre", href: "/mercado-livre", label: "Mercado Livre", provider: "mercado_livre" },
  { id: "shopee", href: "/shopee", label: "Shopee", provider: "shopee" },
  { id: "tiktok_shop", href: "/tiktok", label: "TikTok Shop", provider: "tiktok_shop" },
] as const;

export function ChannelRail() {
  const workspace = workspaceFromPath(usePathname());
  return (
    <div className="channel-rail">
      <div className="channel-rail-tabs" role="navigation" aria-label="Alternar canal de venda">
        {channels.map((channel) => (
          <Link
            key={channel.id}
            href={channel.href}
            title={channel.label}
            aria-label={channel.label}
            aria-current={workspace === channel.id ? "page" : undefined}
            className={`channel-rail-tab channel-${channel.id}${workspace === channel.id ? " is-active" : ""}`}
          >
            <span aria-hidden="true"><MarketplaceIcon provider={channel.provider} size={38} app /></span>
          </Link>
        ))}
        <Link href="/integracoes" title="Adicionar canal" aria-label="Adicionar ou gerenciar integrações" className="channel-rail-add">
          <Plus className="h-[18px] w-[18px]" strokeWidth={2.1} aria-hidden />
        </Link>
      </div>
    </div>
  );
}
