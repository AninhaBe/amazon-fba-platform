import type { ComponentCoverage, TiktokCoverageV2, TiktokFinancialOverviewV2 } from "@/lib/integrations/tiktokFinancialV2";
// Relativo, nao "@/": este modulo e carregado direto pelos testes, onde o
// alias do Next nao existe.
import { comSemImposto } from "../../lib/semImposto";
import type { TiktokSyncStatus } from "@/lib/integrations/tiktokSync";
import { rotuloStatusPedido } from "./statusDeExibicao";

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

/**
 * Mantido como ponto de entrada do canal, mas o vocabulário agora mora em
 * `statusDeExibicao` — o monitor do TikTok e o da Shopee precisavam das mesmas
 * palavras, e duas cópias já tinham começado a divergir (faltava `refunded`).
 */
export function tiktokOrderStatusLabel(status: string) {
  return rotuloStatusPedido(status);
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

/**
 * O RESULTADO DO PERÍODO FECHOU? — a decisão única sobre lucro, margem e ROI.
 *
 * ⚠️ Não use a fase do dashboard para isto. `effectiveTiktokDashboardPhase`
 * responde "o sync está em dia?", e ela cai para `partial` por
 * `financialBacklog`: uma contagem de pedidos SEM extrato da CONEXÃO INTEIRA,
 * de qualquer data, indiferente ao período que a tela está mostrando. Foi o que
 * partiu a tela em duas em 27/08/2026: a faixa de cima (que lê a cobertura do
 * período, `financials`) mostrava lucro, e o painel de composição logo abaixo —
 * que lia a fase — dizia "Lucro indisponível" sobre os mesmos números.
 *
 * A autoridade do período é `coverage.requestedPeriod.financials`, escrita por
 * `applyTiktokLedgerAuthority` a partir do extrato. É a MESMA que `financialCards`
 * usa nos cards de lucro/margem/ROI — por isso as duas superfícies não podem
 * mais discordar.
 */
export function tiktokResultadoFechado(
  overview: TiktokFinancialOverviewV2 | null | undefined,
  coverage: TiktokFrontendCoverage | null | undefined,
  financialBlocked = false
): boolean {
  if (financialBlocked || !overview || !coverage || overview.profit == null) return false;
  return periodOf(coverage).financials?.status === "complete";
}

/**
 * POR QUE lucro, margem e ROI estão em travessão — a frase que acompanha o
 * `null` até o narrador.
 *
 * O NEXO recebe o lucro como "desconhecido" e, sem o motivo junto, preenchia a
 * lacuna sozinho: narrava "faltam os custos cadastrados" com os custos todos
 * cadastrados e o extrato do período ainda aberto. São ações diferentes — uma
 * ela faz hoje, a outra só a TikTok fecha — e mandar a errada é fazer a pessoa
 * trabalhar à toa. Unidade sem custo vem primeiro por ser a única que depende
 * dela.
 */
export function tiktokMotivoSemLucro(unidadesSemCusto: number): string {
  return unidadesSemCusto > 0
    ? `${unidadesSemCusto} unidade(s) vendida(s) sem custo cadastrado`
    : "o extrato da TikTok Shop ainda não fechou este período; o dia corrente só fecha depois da meia-noite de Brasília";
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

/** Âncora do painel onde a alíquota é cadastrada; o link da pendência aponta para ela. */
export const TIKTOK_TAX_SETTINGS_ANCHOR = "tiktok-imposto";

export function tiktokTaxSettingsHref(connectionId: string) {
  return `/tiktok?${new URLSearchParams({ connection_id: connectionId }).toString()}#${TIKTOK_TAX_SETTINGS_ANCHOR}`;
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
    { key: "financial", label: "Backlog financeiro histórico", status: sync.financialBacklog === 0 && sync.ordersComplete ? "Sem pendências" : ESPERA_LABEL.canal, detail: sync.financialBacklog > 0 ? `${sync.financialBacklog} pedido(s) histórico(s) aguardando extrato; esta contagem não é a cobertura do período selecionado` : sync.ordersComplete ? "Nenhum extrato histórico pendente" : "Será apurado depois da importação dos pedidos" },
  ];
}

export function tiktokConnectionError(code?: string) {
  if (code === "CONNECTION_ID_REQUIRED") return "Selecione uma loja TikTok Shop para continuar.";
  if (code === "INVALID_CONNECTION_ID" || code === "CONNECTION_NOT_FOUND") return "Esta loja não está mais disponível. Selecione outra loja ou gerencie as conexões.";
  return null;
}

const syncStates: Record<TiktokSyncPhase, { title: string; description: string }> = {
  first_sync: { title: "Primeira sincronização em andamento", description: "A loja está conectada. Os indicadores aparecerão quando a primeira janela de pedidos estiver disponível." },
  partial: { title: "Sincronização em andamento", description: "Parte dos pedidos já chegou. Cada componente financeiro aparece quando a TikTok Shop fecha o extrato dele." },
  ready: { title: "Dados sincronizados", description: "A sincronização está pronta." },
  retryable_error: { title: "A sincronização precisa de nova tentativa", description: "Houve uma falha temporária. Tente carregar novamente; o progresso já salvo será preservado." },
  reauth_required: { title: "Reconecte a TikTok Shop", description: "A autorização expirou ou foi revogada. Reconecte a loja para retomar a sincronização." },
  unavailable: { title: "Sincronização indisponível", description: "O serviço de sincronização não está disponível agora. Tente novamente ou gerencie a conexão." },
};

export function syncStateContent(phase: TiktokSyncPhase) { return syncStates[phase]; }

/**
 * Erro da sincronização com nome próprio. "Houve uma falha temporária" é
 * verdadeiro para quase tudo e útil para nada: quando o motivo é um status novo
 * da API, tentar de novo devolve o MESMO resultado, e o pedido fica fora do
 * faturamento sem que ninguém saiba disso.
 */
export function tiktokSyncErrorContent(
  error: TiktokSyncStatus["error"]
): { title: string; description: string; retryable: boolean } {
  if (error?.code === "TIKTOK_STATUS_NAO_MAPEADO") {
    const observed = error.unmappedStatuses ?? [];
    const pedidos = observed.reduce((total, item) => total + item.orders, 0);
    const lista = observed.map((item) => `${item.status || "(vazio)"} (${item.orders})`).join(", ");
    return {
      title: "A TikTok Shop devolveu um status de pedido que o NEXO ainda não conhece",
      description: observed.length
        ? `${pedidos} pedido(s) com status ${lista} ficaram de fora do faturamento. O NEXO não escolhe um equivalente por conta própria — esse status precisa entrar no mapeamento antes de os pedidos contarem. Tentar de novo devolve o mesmo resultado.`
        : `${error.message} Tentar de novo devolve o mesmo resultado.`,
      retryable: false,
    };
  }
  // Demais falhas mantêm o texto genérico de propósito: `last_error` carrega
  // mensagem de driver e de API, que não se coloca na tela de quem vende.
  const fallback = syncStates.retryable_error;
  return { title: fallback.title, description: fallback.description, retryable: true };
}

const money = (value: number, currency: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
const percent = (value: number) => `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

/**
 * De quem é a espera.
 *
 * "Aguardando dados" descreve a tela, não o mundo: quem lê não sabe se o NEXO
 * falhou, se a TikTok atrasou, ou se falta ela cadastrar alguma coisa. São três
 * esperas com donos e desfechos diferentes, e a tela precisa separar as três:
 *
 *   • `canal`       — a TikTok Shop ainda não postou o extrato do pedido
 *                     (`pending`), ou entregou o dado sem aquele componente
 *                     (`missing`). Não há o que fazer além de esperar, e por
 *                     isso essas pendências não ganham botão: oferecer ação
 *                     para algo que só depende de terceiro é mentira educada.
 *   • `vendedora`   — falta custo de SKU ou a alíquota de imposto. Isso ela
 *                     resolve hoje; vem primeiro na lista e sempre com link.
 *   • `conciliacao` — a janela ainda não fechou do NOSSO lado. Ver o comentário
 *                     de `revenue` abaixo: culpar a TikTok por isso era alarme
 *                     falso permanente.
 *
 * As contagens saem inteiras de `tiktokFinancialV2`: nada é estimado aqui.
 */
export type TiktokEsperaDe = "canal" | "vendedora" | "conciliacao";

export interface TiktokPendencia {
  key: string;
  espera: TiktokEsperaDe;
  /** Frase completa da lista na tela. Sempre nomeia o dono e traz número. */
  text: string;
  /** Versão curta, para caber no contexto de um card. */
  short: string;
  /** Só existe quando há o que fazer — ou seja, quando a espera é da vendedora. */
  action?: { label: string; href: string };
}

type RequestedPeriodCoverage = TiktokCoverageV2["requestedPeriod"];

const COMPONENT_DEFS: Array<{
  key: keyof RequestedPeriodCoverage;
  label: string;
  unit: string;
  knownLabel: string;
  legacyKey?: keyof RequestedPeriodCoverage;
  espera: TiktokEsperaDe;
  /** Vem do extrato financeiro, pedido a pedido. Só esses podem falar em extrato. */
  doExtrato?: true;
}> = [
  // `revenue` NÃO é espera da TikTok. Sua cobertura vem de `periodCovered`, que
  // em `tiktokOverviewCanonical` é `financialSnapshot.covered` →
  // `checkpointsCoverPeriod`, ou seja, a NOSSA conciliação ter fechado a janela.
  // E `checkpointsCoverPeriod` começa recusando qualquer `to` posterior a
  // `closedFinancialBoundary` (meia-noite de Brasília): todo período que termina
  // hoje — "Hoje", "7 dias", "30 dias", os padrões da tela — nasce descoberto.
  // Escrever "a TikTok ainda não devolveu os pedidos" aqui era alarme falso
  // diário, do tipo que faz a vendedora abrir chamado com o marketplace.
  { key: "revenue", label: "Faturamento", unit: "período", knownLabel: "conhecido", espera: "conciliacao" },
  { key: "fees", label: "Taxas", unit: "pedidos", knownLabel: "conhecidos", espera: "canal", doExtrato: true },
  { key: "sellerShipping", label: "Frete do vendedor", unit: "pedidos", knownLabel: "conhecidos", legacyKey: "shipping", espera: "canal", doExtrato: true },
  // Sem `doExtrato`: o frete do comprador vem do PEDIDO (`order.buyer_shipping`),
  // não do extrato — em `tiktokFinancialV2` a cobertura dele é montada com
  // `pending: 0`, o extrato não entra na conta. Falar em "extrato fechado sem
  // informar" aqui inventava um documento que nunca carregou esse campo.
  { key: "buyerShipping", label: "Frete do comprador", unit: "pedidos", knownLabel: "conhecidos", legacyKey: "shipping", espera: "canal" },
  { key: "ads", label: "Anúncios", unit: "pedidos", knownLabel: "conhecidos", espera: "canal", doExtrato: true },
  { key: "taxesWithheld", label: "Impostos retidos", unit: "pedidos", knownLabel: "conhecidos", espera: "canal", doExtrato: true },
  { key: "refunds", label: "Estornos", unit: "pedidos", knownLabel: "conhecidos", espera: "canal", doExtrato: true },
  { key: "tax", label: "Impostos", unit: "período", knownLabel: "conhecido", espera: "vendedora" },
  { key: "cogs", label: "Custo dos produtos", unit: "unidades", knownLabel: "conhecidas", espera: "vendedora" },
  { key: "financials", label: "Resultado final", unit: "componentes", knownLabel: "conhecidos", espera: "canal" },
];

/** Componentes que vêm pedido a pedido do extrato — os únicos que podem citá-lo. */
const EXTRATO_DEFS = COMPONENT_DEFS.filter((def) => def.doExtrato);

const CONCILIACAO_PENDENTE = "O período ainda não foi conciliado no NEXO; o dia corrente só fecha depois da meia-noite de Brasília";
const SEM_FRETE_DO_COMPRADOR = (pedidos: number) => `A TikTok Shop não informou o frete pago pelo comprador em ${pedidos} pedido(s)`;

const lower = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);

function periodOf(coverage: TiktokFrontendCoverage): RequestedPeriodCoverage {
  return (coverage.requestedPeriod ?? coverage) as RequestedPeriodCoverage;
}

function readCoverage(period: RequestedPeriodCoverage, key: keyof RequestedPeriodCoverage, legacyKey?: keyof RequestedPeriodCoverage) {
  return (period[key] ?? (legacyKey ? period[legacyKey] : undefined)) as TiktokCoverageMetric | undefined;
}

function esperaDoComponente(key: keyof RequestedPeriodCoverage, period: RequestedPeriodCoverage): TiktokEsperaDe {
  if (key === "cogs" || key === "tax") return "vendedora";
  if (key === "revenue") return "conciliacao";
  // O resultado final não tem dono próprio: herda o de quem está segurando os
  // componentes que faltam, na ordem do que resolve mais cedo — ela desbloqueia
  // hoje, a TikTok num prazo dela, a conciliação sozinha na virada do dia.
  if (key === "financials") {
    const cogs = readCoverage(period, "cogs");
    const tax = readCoverage(period, "tax");
    if ((cogs?.missing ?? 0) > 0 || (tax?.missing ?? 0) > 0) return "vendedora";
    const doCanal = COMPONENT_DEFS.filter((def) => def.espera === "canal" && def.key !== "financials")
      .some((def) => {
        const item = readCoverage(period, def.key, def.legacyKey);
        return (item?.missing ?? 0) > 0 || (item?.pending ?? 0) > 0;
      });
    return doCanal ? "canal" : "conciliacao";
  }
  return "canal";
}

/**
 * Lista o que falta, com número, dono e — quando ela pode agir — link.
 * Ordem deliberada: primeiro o que depende dela, depois o que depende da TikTok.
 */
export function tiktokPendencias(coverage: TiktokFrontendCoverage, connectionId?: string | null): TiktokPendencia[] {
  const period = periodOf(coverage);
  const daVendedora: TiktokPendencia[] = [];
  const doCanal: TiktokPendencia[] = [];
  const daConciliacao: TiktokPendencia[] = [];

  const cogs = readCoverage(period, "cogs");
  if (cogs && cogs.missing > 0) {
    daVendedora.push({
      key: "cogs",
      espera: "vendedora",
      text: `${cogs.missing} unidade(s) vendida(s) sem custo cadastrado`,
      short: `custos de ${cogs.missing} unidade(s)`,
      action: connectionId ? { label: "Cadastrar custos", href: tiktokProductsHref(connectionId) } : undefined,
    });
  }

  const tax = readCoverage(period, "tax");
  if (tax && tax.missing > 0) {
    daVendedora.push({
      key: "tax",
      espera: "vendedora",
      text: "Alíquota de imposto ainda não cadastrada para esta loja",
      short: "alíquota de imposto",
      action: connectionId ? { label: "Configurar alíquota", href: tiktokTaxSettingsHref(connectionId) } : undefined,
    });
  }

  const revenue = readCoverage(period, "revenue");
  if (revenue && revenue.known < revenue.applicable) {
    daConciliacao.push({
      key: "revenue",
      espera: "conciliacao",
      text: CONCILIACAO_PENDENTE,
      short: "conciliação do período",
    });
  }

  const buyerShipping = readCoverage(period, "buyerShipping", "shipping");
  if (buyerShipping && buyerShipping.missing > 0) {
    doCanal.push({
      key: "buyerShipping",
      espera: "canal",
      text: SEM_FRETE_DO_COMPRADOR(buyerShipping.missing),
      short: `frete do comprador de ${buyerShipping.missing} pedido(s)`,
    });
  }

  // Extrato não fechado é um fato do pedido, não de cada componente: repetir a
  // mesma contagem em seis linhas viraria ruído e esconderia o que é específico.
  const semExtrato = Math.max(0, ...EXTRATO_DEFS.map((def) => readCoverage(period, def.key, def.legacyKey)?.pending ?? 0));
  if (semExtrato > 0) {
    doCanal.push({
      key: "statement",
      espera: "canal",
      text: `${semExtrato} pedido(s) ainda sem extrato fechado na TikTok Shop`,
      short: `extrato de ${semExtrato} pedido(s)`,
    });
  }

  for (const def of EXTRATO_DEFS) {
    const item = readCoverage(period, def.key, def.legacyKey);
    if (!item || item.missing <= 0) continue;
    doCanal.push({
      key: def.key,
      espera: "canal",
      text: `A TikTok fechou o extrato de ${item.missing} pedido(s) sem informar ${lower(def.label)}`,
      short: `${lower(def.label)} de ${item.missing} pedido(s)`,
    });
  }

  return [...daVendedora, ...doCanal, ...daConciliacao];
}

function resumoDePendencias(pendencias: TiktokPendencia[]) {
  if (!pendencias.length) return "todos os componentes financeiros";
  const shorts = pendencias.map((item) => item.short);
  return shorts.length <= 3 ? shorts.join("; ") : `${shorts.slice(0, 3).join("; ")} e mais ${shorts.length - 3}`;
}

function contextoDoCard(key: keyof TiktokFinancialOverviewV2, period: RequestedPeriodCoverage, pendencias: TiktokPendencia[]): string {
  if (key === "profit") return `Faltam componentes: ${resumoDePendencias(pendencias)}`;
  if (key === "marginPct") return `A margem só sai com faturamento e lucro completos. Faltam: ${resumoDePendencias(pendencias)}`;
  if (key === "roiPct") return `O ROI só sai com lucro e custo completos. Faltam: ${resumoDePendencias(pendencias)}`;
  if (key === "revenue") return CONCILIACAO_PENDENTE;
  if (key === "buyerShipping") {
    const item = readCoverage(period, "buyerShipping", "shipping");
    return item && item.missing > 0
      ? SEM_FRETE_DO_COMPRADOR(item.missing)
      : "A TikTok Shop ainda não informou o frete pago pelo comprador neste período";
  }
  if (key === "cogs") {
    const item = readCoverage(period, "cogs");
    return item && item.missing > 0
      ? `Você ainda não cadastrou os custos de ${item.missing} unidade(s) vendida(s)`
      : "Você ainda não cadastrou os custos dos produtos vendidos";
  }
  if (key === "tax" || key === "taxRate") return "Você ainda não cadastrou a alíquota de imposto desta loja";

  const def = COMPONENT_DEFS.find((candidate) => candidate.key === (key as keyof RequestedPeriodCoverage));
  const nome = lower(def?.label ?? "este componente");
  const item = def ? readCoverage(period, def.key, def.legacyKey) : undefined;
  if (item && item.pending > 0 && item.missing > 0) {
    return `${item.pending} pedido(s) aguardando o extrato da TikTok Shop e ${item.missing} fechado(s) sem ${nome}`;
  }
  if (item && item.pending > 0) return `${item.pending} pedido(s) aguardando o extrato da TikTok Shop`;
  if (item && item.missing > 0) return `A TikTok fechou o extrato de ${item.missing} pedido(s) sem informar ${nome}`;
  return `A TikTok Shop ainda não postou o extrato com ${nome} deste período`;
}

/** Os três que mudam de valor quando o imposto entra na conta. */
const DERIVAM_DO_IMPOSTO = new Set<keyof TiktokFinancialOverviewV2>(["profit", "marginPct", "roiPct"]);

export function financialCards(overview: TiktokFinancialOverviewV2, coverage: TiktokFrontendCoverage) {
  const periodCoverage = coverage.requestedPeriod ?? coverage;
  const period = periodOf(coverage);
  const pendencias = tiktokPendencias(coverage);
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
      // Lucro, margem e ROI saem calculados mesmo sem a alíquota da loja
      // (26/08/2026) — o rótulo diz que estão sem imposto, e o card "Impostos"
      // ao lado continua apontando o que falta cadastrar.
      context: complete && raw != null
        ? comSemImposto("Total oficial do período", overview.taxRate == null && DERIVAM_DO_IMPOSTO.has(key))
        : contextoDoCard(key, period, pendencias),
    };
  });
}

const ESPERA_LABEL: Record<TiktokEsperaDe, string> = {
  canal: "Aguardando a TikTok",
  vendedora: "Falta você cadastrar",
  conciliacao: "Aguardando conciliação",
};

function detalheDoQueFalta(key: keyof RequestedPeriodCoverage, item: TiktokCoverageMetric, label: string) {
  if (key === "cogs") return `${item.missing} unidade(s) sem custo cadastrado`;
  if (key === "tax") return "alíquota de imposto não cadastrada";
  if (key === "revenue") return "o período ainda não foi conciliado no NEXO";
  if (key === "buyerShipping") return `${item.missing} pedido(s) sem o valor do frete pago pelo comprador`;
  if (key === "financials") return `${item.missing} componente(s) sem valor`;
  return `${item.missing} pedido(s) com extrato fechado sem ${lower(label)}`;
}

export function coverageDescription(coverage: TiktokFrontendCoverage, currency = "BRL") {
  const period = periodOf(coverage);
  return COMPONENT_DEFS.map(({ key, label, unit, knownLabel, legacyKey }) => {
    const item = readCoverage(period, key, legacyKey);
    if (!item) return { key, label, status: ESPERA_LABEL.canal, detail: "Cobertura ainda não informada nesta resposta", captured: null };
    const status = item.status === "complete" ? "Completa" : ESPERA_LABEL[esperaDoComponente(key, period)];
    const ratio = item.ratio ?? (item.applicable > 0 ? item.known / item.applicable : item.status === "complete" ? 1 : 0);
    const parts = [`${item.known} de ${item.applicable} ${unit} ${knownLabel} (${Math.round(ratio * 100)}%)`];
    if (item.pending) parts.push(`${item.pending} aguardando extrato da TikTok`);
    if (item.missing) parts.push(detalheDoQueFalta(key, item, label));
    const captured = item.capturedValue == null ? null : `${money(item.capturedValue, currency)} capturados até agora; não é o total oficial do card`;
    return { key, label, status, detail: parts.join("; "), captured };
  });
}

export function historicalBacklogDescription(coverage: TiktokFrontendCoverage) {
  const backlog = coverage.historicalBacklog;
  return {
    label: "Backlog financeiro histórico",
    status: backlog.pending === 0 ? "Sem pendências" : ESPERA_LABEL.canal,
    detail: backlog.pending === 0
      ? "Nenhum pedido histórico aguardando extrato"
      : `${backlog.pending} pedido(s) histórico(s) aguardando extrato`,
    context: "Escopo histórico; não usa nem compara o denominador do período selecionado.",
  };
}
