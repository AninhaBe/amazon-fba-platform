import type { ComponentCoverage, TiktokCoverageV2, TiktokFinancialOverviewV2 } from "@/lib/integrations/tiktokFinancialV2";
import type { TiktokSyncStatus } from "@/lib/integrations/tiktokSync";

export type TiktokSyncPhase = TiktokSyncStatus["phase"];
export type TiktokCoverageMetric = ComponentCoverage;
export type TiktokFrontendCoverage = TiktokCoverageV2;
export interface TiktokOverviewResponse {
  connection: { id: string; name: string; region: string };
  sync: TiktokSyncStatus;
  coverage: TiktokFrontendCoverage | null;
  overview: TiktokFinancialOverviewV2 | null;
  financialAvailability?: "AVAILABLE" | "BLOCKED";
  financialCoverage?: { status: "complete" | "partial" | "blocked" };
  orders?: number;
  units?: number;
  ticket?: number | null;
  dailySeries?: Array<{ date: string; revenue: number; orders: number; units: number }>;
  statusBreakdown?: Array<{ status: string; orders: number }>;
  topProducts?: Array<{ productId: string; sku: string | null; title: string; revenue: number; units: number }>;
  catalog?: Array<{ id: string; sku: string | null; title: string; status: string; price: number; currency: string; availableQty: number }>;
  orderProfitability?: Array<{ orderId: string; occurredAt: string; revenue: number; profit: number | null; marginPct: number | null; financialStatus: "complete" | "partial" | "pending" }>;
}

export function tiktokOrderStatusLabel(status: string) {
  const labels: Record<string, string> = { pending: "Pendente", paid: "Pago", shipped: "Enviado", delivered: "Entregue", cancelled: "Cancelado" };
  return labels[status] ?? status.replaceAll("_", " ");
}

export function effectiveTiktokDashboardPhase(
  syncPhase: TiktokSyncPhase,
  financialAvailability?: "AVAILABLE" | "BLOCKED",
  financialCoverageStatus?: "complete" | "partial" | "blocked"
): TiktokSyncPhase {
  if (syncPhase !== "ready") return syncPhase;
  return financialAvailability === "BLOCKED" || financialCoverageStatus === "blocked" || financialCoverageStatus === "partial"
    ? "partial"
    : "ready";
}

export interface TiktokConnectionOption {
  id: string;
  externalAccountId?: string;
  displayName?: string;
  region?: string | null;
}

export function orderedTiktokConnections(connections: TiktokConnectionOption[]) {
  return [...connections].sort((left, right) => {
    const leftShopId = left.externalAccountId || left.id.replace(/^tiktok_shop:/, "");
    const rightShopId = right.externalAccountId || right.id.replace(/^tiktok_shop:/, "");
    return leftShopId.localeCompare(rightShopId) || left.id.localeCompare(right.id);
  });
}

export function resolveTiktokConnection(connections: TiktokConnectionOption[], requestedId: string | null) {
  const ordered = orderedTiktokConnections(connections);
  return ordered.find((connection) => connection.id === requestedId) ?? ordered[0] ?? null;
}

export function tiktokPageHref(currentQuery: string, connectionId: string) {
  const source = new URLSearchParams(currentQuery);
  const params = new URLSearchParams();
  ["from", "to", "days"].forEach((key) => source.getAll(key).forEach((value) => params.append(key, value)));
  params.set("connection_id", connectionId);
  return `/tiktok?${params.toString()}`;
}

export function shouldCanonicalizeTiktokUrl(connectionCount: number, requestedId: string | null, selectedId: string) {
  return requestedId !== selectedId && (connectionCount > 1 || requestedId !== null);
}

export function tiktokOverviewQuery(periodQuery: string, connectionId: string) {
  const params = new URLSearchParams(periodQuery);
  params.set("connection_id", connectionId);
  return params.toString();
}

export function tiktokSettingsQuery(connectionId: string) {
  return new URLSearchParams({ connection_id: connectionId }).toString();
}

export function tiktokProductsHref(connectionId: string) {
  return `/tiktok/produtos?${new URLSearchParams({ connection_id: connectionId }).toString()}`;
}

export function productMatchesTiktokScope(product: { id: string; source: string }, connectionId: string | null) {
  return product.source === "tiktok" && (!connectionId || product.id.startsWith(`tiktok:${connectionId}:`));
}

export function parseTaxRateDraft(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

export function syncBacklogDescription(sync: TiktokSyncStatus) {
  return [
    { key: "orders", label: "Pedidos", status: sync.ordersComplete ? "Completa" : "Em andamento", detail: sync.ordersComplete ? `${sync.processedOrders} pedido(s) processado(s)` : `${Math.round(sync.progress * 100)}% da janela sincronizada` },
    { key: "products", label: "Produtos", status: sync.productsComplete ? "Completa" : "Em andamento", detail: `${sync.activeProducts} ativo(s) de ${sync.productsTotal} produto(s) importado(s)` },
    { key: "financial", label: "Backlog financeiro histórico", status: sync.financialBacklog === 0 && sync.ordersComplete ? "Sem pendências" : "Pendente", detail: sync.financialBacklog > 0 ? `${sync.financialBacklog} pedido(s) histórico(s) aguardando extrato; esta contagem não é a cobertura do período selecionado` : sync.ordersComplete ? "Nenhum extrato histórico pendente" : "Será apurado depois da importação dos pedidos" },
  ];
}

export function tiktokConnectionError(code?: string) {
  if (code === "CONNECTION_ID_REQUIRED") return "Selecione uma loja TikTok Shop para continuar.";
  if (code === "INVALID_CONNECTION_ID" || code === "CONNECTION_NOT_FOUND") return "Esta loja não está mais disponível. Selecione outra loja ou gerencie as conexões.";
  return null;
}

const syncStates: Record<TiktokSyncPhase, { title: string; description: string }> = {
  first_sync: { title: "Primeira sincronização em andamento", description: "A loja está conectada. Os indicadores aparecerão quando a primeira janela de pedidos estiver disponível." },
  partial: { title: "Sincronização parcial", description: "Parte dos dados já chegou, mas o período ou os componentes financeiros ainda não estão completos." },
  ready: { title: "Dados sincronizados", description: "A sincronização está pronta." },
  retryable_error: { title: "A sincronização precisa de nova tentativa", description: "Houve uma falha temporária. Tente carregar novamente; o progresso já salvo será preservado." },
  reauth_required: { title: "Reconecte a TikTok Shop", description: "A autorização expirou ou foi revogada. Reconecte a loja para retomar a sincronização." },
  unavailable: { title: "Sincronização indisponível", description: "O serviço de sincronização não está disponível agora. Tente novamente ou gerencie a conexão." },
};

export function syncStateContent(phase: TiktokSyncPhase) { return syncStates[phase]; }

const money = (value: number, currency: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
const percent = (value: number) => `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

const contexts: Record<keyof TiktokFinancialOverviewV2, string> = {
  currency: "",
  revenue: "Aguardando cobertura completa do período",
  fees: "Aguardando fechamento do extrato",
  sellerShipping: "Aguardando frete cobrado do vendedor",
  buyerShipping: "Aguardando frete pago pelo comprador",
  ads: "Aguardando evidência de despesas com anúncios",
  taxesWithheld: "Aguardando retenções discriminadas no extrato",
  refunds: "Aguardando estornos discriminados no extrato",
  tax: "Aguardando configuração do imposto",
  taxRate: "Aguardando configuração da alíquota",
  cogs: "Aguardando custos dos produtos",
  profit: "Aguardando todos os componentes financeiros",
  marginPct: "Aguardando receita e lucro completos",
  roiPct: "Aguardando lucro e custo completos",
};

export function financialCards(overview: TiktokFinancialOverviewV2, coverage: TiktokFrontendCoverage) {
  const periodCoverage = coverage.requestedPeriod ?? coverage;
  const definitions: Array<{ key: keyof TiktokFinancialOverviewV2; label: string; coverage?: ComponentCoverage; kind?: "percent" }> = [
    { key: "revenue", label: "Faturamento", coverage: periodCoverage.revenue },
    { key: "fees", label: "Taxas", coverage: periodCoverage.fees },
    { key: "sellerShipping", label: "Frete do vendedor", coverage: periodCoverage.sellerShipping },
    { key: "buyerShipping", label: "Frete do comprador", coverage: periodCoverage.buyerShipping },
    { key: "ads", label: "Anúncios", coverage: periodCoverage.ads },
    { key: "taxesWithheld", label: "Impostos retidos", coverage: periodCoverage.taxesWithheld },
    { key: "refunds", label: "Estornos", coverage: periodCoverage.refunds },
    { key: "tax", label: "Impostos", coverage: periodCoverage.tax },
    { key: "cogs", label: "Custo dos produtos", coverage: periodCoverage.cogs },
    { key: "profit", label: "Lucro", coverage: periodCoverage.financials },
    { key: "marginPct", label: "Margem", coverage: periodCoverage.financials, kind: "percent" },
    { key: "roiPct", label: "ROI", coverage: periodCoverage.financials, kind: "percent" },
  ];
  return definitions.map(({ key, label, coverage: itemCoverage, kind }) => {
    const raw = overview[key] as number | null;
    const complete = itemCoverage?.status === "complete";
    return {
      key, label, raw,
      value: raw == null || !complete ? "—" : kind === "percent" ? percent(raw) : money(raw, overview.currency),
      context: complete && raw != null ? "Total oficial do período" : contexts[key],
    };
  });
}

type RequestedPeriodCoverage = TiktokCoverageV2["requestedPeriod"];
const coverageDefinitions: Array<{ key: keyof RequestedPeriodCoverage; label: string; unit: string; knownLabel: string; legacyKey?: keyof RequestedPeriodCoverage }> = [
  { key: "revenue", label: "Faturamento", unit: "período", knownLabel: "conhecido" },
  { key: "fees", label: "Taxas", unit: "pedidos", knownLabel: "conhecidos" },
  { key: "sellerShipping", label: "Frete do vendedor", unit: "pedidos", knownLabel: "conhecidos", legacyKey: "shipping" },
  { key: "buyerShipping", label: "Frete do comprador", unit: "pedidos", knownLabel: "conhecidos", legacyKey: "shipping" },
  { key: "ads", label: "Anúncios", unit: "pedidos", knownLabel: "conhecidos" },
  { key: "taxesWithheld", label: "Impostos retidos", unit: "pedidos", knownLabel: "conhecidos" },
  { key: "refunds", label: "Estornos", unit: "pedidos", knownLabel: "conhecidos" },
  { key: "tax", label: "Impostos", unit: "período", knownLabel: "conhecido" },
  { key: "cogs", label: "Custo dos produtos", unit: "unidades", knownLabel: "conhecidas" },
  { key: "financials", label: "Resultado final", unit: "componentes", knownLabel: "conhecidos" },
];

export function coverageDescription(coverage: TiktokFrontendCoverage, currency = "BRL") {
  const periodCoverage = coverage.requestedPeriod ?? coverage;
  return coverageDefinitions.map(({ key, label, unit, knownLabel, legacyKey }) => {
    const item = (periodCoverage[key] ?? (legacyKey ? periodCoverage[legacyKey] : undefined)) as TiktokCoverageMetric | undefined;
    if (!item) return { key, label, status: "Parcial", detail: "Cobertura ainda não informada", captured: null };
    const status = item.status === "complete" ? "Completa" : item.status === "pending" ? "Aguardando" : "Parcial";
    const ratio = item.ratio ?? (item.applicable > 0 ? item.known / item.applicable : item.status === "complete" ? 1 : 0);
    const parts = [`${item.known} de ${item.applicable} ${unit} ${knownLabel} (${Math.round(ratio * 100)}%)`];
    if (item.pending) parts.push(`${item.pending} aguardando extrato`);
    if (item.missing) parts.push(`${item.missing} pendentes`);
    const captured = item.capturedValue == null ? null : `${money(item.capturedValue, currency)} capturados até agora; não é o total oficial do card`;
    return { key, label, status, detail: parts.join("; "), captured };
  });
}

export function historicalBacklogDescription(coverage: TiktokFrontendCoverage) {
  const backlog = coverage.historicalBacklog;
  return {
    label: "Backlog financeiro histórico",
    status: backlog.pending === 0 ? "Sem pendências" : "Pendente",
    detail: backlog.pending === 0
      ? "Nenhum pedido histórico aguardando extrato"
      : `${backlog.pending} pedido(s) histórico(s) aguardando extrato`,
    context: "Escopo histórico; não usa nem compara o denominador do período selecionado.",
  };
}
