export type IntegrationProvider = "amazon" | "mercado_livre" | "shopee" | "tiktok_shop";
export type IntegrationMode = "local" | "global_selling";
export type IntegrationStatus = "connected" | "attention" | "disconnected";

export type IntegrationCapability =
  | "catalog"
  | "orders"
  | "inventory"
  | "pricing"
  | "finance"
  | "traffic"
  | "messages"
  | "promotions";

export interface IntegrationConnection {
  id: string;
  provider: IntegrationProvider;
  externalAccountId: string;
  displayName?: string;
  mode: IntegrationMode;
  region?: string;
  accessToken?: string;
  refreshToken?: string;
  accessExpiresAt?: string;
  refreshExpiresAt?: string;
  scopes: string[];
  metadata: Record<string, unknown>;
  status: IntegrationStatus;
  connectedAt: string;
  updatedAt: string;
}

export interface PublicIntegrationConnection
  extends Omit<IntegrationConnection, "accessToken" | "refreshToken" | "metadata"> {
  metadata: Record<string, string | number | boolean | null>;
}

export function connectionId(provider: IntegrationProvider, externalAccountId: string): string {
  return `${provider}:${externalAccountId}`;
}
