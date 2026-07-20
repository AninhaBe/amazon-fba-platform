import type { IntegrationCapability, IntegrationProvider } from "./types";

export interface ProviderDefinition {
  id: IntegrationProvider;
  name: string;
  shortName: string;
  description: string;
  capabilities: IntegrationCapability[];
  availability: "available" | "planned";
  connectHref?: string;
}

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: "amazon",
    name: "Amazon",
    shortName: "AMZ",
    description: "Pedidos, FBA, catálogo, taxas, tráfego e desempenho.",
    capabilities: ["catalog", "orders", "inventory", "pricing", "finance", "traffic"],
    availability: "available",
    connectHref: "/api/auth/login",
  },
  {
    id: "mercado_livre",
    name: "Mercado Livre",
    shortName: "MELI",
    description: "Conta, anúncios, estoque e pedidos do Mercado Livre Brasil.",
    capabilities: ["catalog", "orders", "inventory", "pricing", "messages", "promotions"],
    availability: "available",
    connectHref: "/api/integrations/mercado-livre/connect",
  },
  {
    id: "tiktok_shop",
    name: "TikTok Shop",
    shortName: "TTS",
    description: "Pedidos, produtos, estoque, preços e operação da TikTok Shop.",
    capabilities: ["catalog", "orders", "inventory", "pricing", "finance"],
    availability: "available",
    connectHref: "/api/tiktok/login",
  },
  {
    id: "shopee",
    name: "Shopee",
    shortName: "SHP",
    description: "Próximo canal previsto na arquitetura de integrações.",
    capabilities: ["catalog", "orders", "inventory", "pricing", "finance"],
    availability: "planned",
  },
];

export function providerDefinition(provider: IntegrationProvider): ProviderDefinition {
  const definition = PROVIDERS.find((item) => item.id === provider);
  if (!definition) throw new Error(`Provedor desconhecido: ${provider}`);
  return definition;
}
