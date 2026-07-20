import Image from "next/image";
import { LogoMark } from "./Logo";

export type MarketplaceIconProvider = "sellercore" | "amazon" | "mercado_livre" | "shopee" | "tiktok_shop";

const sources: Record<Exclude<MarketplaceIconProvider, "sellercore">, string> = {
  amazon: "/brands/amazon.svg",
  mercado_livre: "/brands/mercado-livre.svg",
  shopee: "/brands/shopee.svg",
  tiktok_shop: "/brands/tiktok-shop.svg",
};

export function MarketplaceIcon({ provider, size = 24, className = "" }: { provider: MarketplaceIconProvider; size?: number; className?: string }) {
  if (provider === "sellercore") return <LogoMark className={className || "h-6 w-6"} />;
  return <Image src={sources[provider]} width={size} height={size} alt="" aria-hidden="true" className={`marketplace-icon marketplace-icon-${provider} ${className}`} />;
}
