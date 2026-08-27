import type { ShopeeSyncStatus } from "@/lib/integrations/shopeeSync";
import type { PublicIntegrationConnection } from "@/lib/integrations/types";

export type ShopeeSyncPhase = ShopeeSyncStatus["phase"];

type ShopeeConnectionSummary = Pick<PublicIntegrationConnection, "status" | "metadata">;

export interface ShopeeProviderIssue {
  status: "attention";
  code: "OWNERSHIP_CONFLICT" | "PROVIDER_READ_FAILED";
  message: string;
}

export function shopeeProviderIssueContent(issue?: ShopeeProviderIssue | null) {
  if (!issue) return null;
  return {
    title: "Shopee temporariamente indisponível",
    description: issue.message || "Não foi possível carregar este canal agora.",
    actionLabel: "Ver integrações",
  } as const;
}

export function resolveShopeeConnectionState(connections: ShopeeConnectionSummary[]) {
  const realConnections = connections.filter((connection) => connection.metadata.demo !== true);
  const candidates = realConnections.length > 0 ? realConnections : connections;
  const connectionStatus = candidates.some((connection) => connection.status === "connected")
    ? "connected"
    : candidates.some((connection) => connection.status === "attention")
      ? "attention"
      : candidates.length > 0 ? "disconnected" : "missing";
  return {
    demo: realConnections.length === 0 && connections.some((connection) => connection.metadata.demo === true),
    connectionStatus,
    connectionCount: candidates.length,
  } as const;
}

const content: Record<ShopeeSyncPhase, { title: string; description: string; action: "refresh" | "reconnect" | "manage" | null }> = {
  idle: {
    title: "Importando os pedidos recentes",
    description: "A loja está conectada e a importação já foi disparada: os pedidos dos últimos 30 dias entram primeiro, e o restante do histórico segue em segundo plano.",
    action: "manage",
  },
  syncing: {
    title: "Sincronização em andamento",
    description: "Os pedidos recentes são importados primeiro; o restante do histórico continua em segundo plano. O progresso já salvo será preservado.",
    action: null,
  },
  ready: { title: "Dados sincronizados", description: "A sincronização inicial foi concluída.", action: null },
  retryable_error: {
    title: "Não foi possível atualizar os dados",
    description: "A última sincronização falhou temporariamente. Atualize o estado para verificar se o processamento agendado já retomou; o progresso salvo será preservado.",
    action: "refresh",
  },
  reauth_required: {
    title: "Reconecte a Shopee",
    description: "A autorização expirou ou foi revogada. Reconecte a loja para retomar a sincronização.",
    action: "reconnect",
  },
  terminal_error: {
    title: "A sincronização não pode continuar",
    description: "A configuração ou permissão do aplicativo não permite concluir esta sincronização.",
    action: "manage",
  },
};

export function shopeeSyncContent(phase: ShopeeSyncPhase) {
  return content[phase];
}

export function shopeeProfitPresentation(input: {
  coverageComplete: boolean;
  feesComplete: boolean;
  costsComplete: boolean;
}) {
  const complete = input.coverageComplete && input.feesComplete && input.costsComplete;
  return {
    complete,
    label: complete ? "Lucro estimado" : "Resultado processado (parcial)",
    marginLabel: complete ? "margem" : "margem parcial",
  };
}

export function shopeeTaxLabel(taxRate: number | null) {
  const rate = taxRate == null
    ? "—"
    : `${taxRate.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  return `Impostos (${rate})`;
}
