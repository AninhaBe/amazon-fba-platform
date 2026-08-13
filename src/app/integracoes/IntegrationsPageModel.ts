export type ConnectionStatus = "connected" | "attention" | "disconnected";

export interface ConnectionLike { status: ConnectionStatus }

export type ProviderState = "connected" | "attention" | "disconnected" | "available" | "planned" | "unconfigured";

export function providerState(
  connections: ConnectionLike[],
  options: { planned: boolean; configured: boolean; issueStatus?: "attention" },
): ProviderState {
  if (connections.some((connection) => connection.status === "connected")) return "connected";
  if (options.issueStatus === "attention") return "attention";
  if (connections.some((connection) => connection.status === "attention")) return "attention";
  if (connections.some((connection) => connection.status === "disconnected")) return "disconnected";
  if (options.planned) return "planned";
  return options.configured ? "available" : "unconfigured";
}

export const providerStateLabel: Record<ProviderState, string> = {
  connected: "Conectado",
  attention: "Requer atenção",
  disconnected: "Desconectado",
  available: "Disponível",
  planned: "Planejado",
  unconfigured: "Indisponível",
};

export function activeConnectionCount(providers: Array<{ connections: ConnectionLike[] }>): number {
  return providers.reduce(
    (total, provider) => total + provider.connections.filter((connection) => connection.status === "connected").length,
    0,
  );
}

export type RemovableProviderId = "mercado_livre" | "tiktok_shop" | "shopee";

export interface ConnectionRemovalCopy {
  button: string;
  confirm: string;
  success?: string;
}

export function isRemovableProvider(providerId: string): providerId is RemovableProviderId {
  return providerId === "mercado_livre" || providerId === "tiktok_shop" || providerId === "shopee";
}

export function connectionRemovalCopy(
  providerId: RemovableProviderId,
  connectionLabel: string,
): ConnectionRemovalCopy {
  if (providerId === "shopee") {
    return {
      button: "Remover do SellerCore",
      confirm: `Remover ${connectionLabel} do SellerCore? As credenciais, sincronizações e os dados locais desta loja serão apagados. O acesso não será revogado na Shopee; para revogá-lo, use o painel da Shopee.`,
      success: "Conexão removida apenas do SellerCore. O acesso na Shopee não foi revogado.",
    };
  }

  return {
    button: "Desconectar",
    confirm: `Desconectar ${connectionLabel}?`,
  };
}
