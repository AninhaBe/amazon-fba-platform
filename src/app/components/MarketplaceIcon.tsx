import Image from "next/image";
import { NexoSymbol } from "./NexoSymbol";

export type MarketplaceIconProvider = "sellercore" | "amazon" | "mercado_livre" | "shopee" | "tiktok_shop";

const sources: Record<Exclude<MarketplaceIconProvider, "sellercore">, string> = {
  amazon: "/brands/amazon.svg",
  mercado_livre: "/brands/mercado-livre.svg",
  shopee: "/brands/shopee.svg",
  tiktok_shop: "/brands/tiktok-shop.svg",
};

// Variante "app icon": quadrado arredondado na cor da marca com o logo oficial dentro.
const appSources: Record<MarketplaceIconProvider, string> = {
  sellercore: "/nexo-symbol.svg",
  amazon: "/brands/app/amazon.svg",
  mercado_livre: "/brands/app/mercado-livre.svg",
  shopee: "/brands/app/shopee.svg",
  tiktok_shop: "/brands/app/tiktok-shop.svg",
};

export function MarketplaceIcon({ provider, size = 24, className = "", app = false }: { provider: MarketplaceIconProvider; size?: number; className?: string; app?: boolean }) {
  if (provider === "sellercore") {
    return <NexoSymbol size={size} className={`marketplace-icon marketplace-app marketplace-app-sellercore ${className}`} />;
  }
  if (app) {
    return <Image src={appSources[provider]} width={size} height={size} style={{ width: size, height: size }} alt="" aria-hidden="true" className={`marketplace-icon marketplace-app marketplace-app-${provider} ${className}`} />;
  }
  return <Image src={sources[provider]} width={size} height={size} alt="" aria-hidden="true" className={`marketplace-icon marketplace-icon-${provider} ${className}`} />;
}
