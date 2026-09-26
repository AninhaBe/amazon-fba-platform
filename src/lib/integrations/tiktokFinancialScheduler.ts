import crypto from "crypto";
import type { FinancialPaginationSeen, TiktokFinancialAdapters } from "./tiktokFinancialLedger";
import type { FinancialPipelineInput, FinancialPipelineResult, PipelineDb, PipelineScope, PipelineWindow } from "./tiktokFinancialPipeline";

export const TIKTOK_FINANCIAL_PAGE_BUDGET = 24;
export type FinancialPageProcessor = (input:FinancialPipelineInput)=>Promise<FinancialPipelineResult>;

/** Drena os quatro recursos financeiros. `statement_transactions` usa um
 * checkpoint por statement e e drenado pelo processador de `statements` antes
 * do checkpoint de discovery avancar. O historico SHA-256 vive no banco, logo
 * invocacoes distintas compartilham a mesma protecao contra ciclos. */
export async function runTiktokFinancialScheduler(input:{
  db:PipelineDb; adapters:TiktokFinancialAdapters; scope:PipelineScope;
  window:PipelineWindow; deadline:number; pageBudget?:number;
  paginationSeen?:FinancialPaginationSeen; ownerToken?:()=>string;
  /** Repassado aos processadores: busca dirigida do pedido citado (ADR-039). */
  garantirPedidosCitados?:(ids:readonly string[])=>Promise<number>;
  processors:readonly FinancialPageProcessor[];
}):Promise<void>{
  const paginationSeen=input.paginationSeen??new Map<string,Set<string>>();
  for(const processPage of input.processors){
    const ownerToken=input.ownerToken?.()??crypto.randomUUID();
    for(let page=0;page<(input.pageBudget??TIKTOK_FINANCIAL_PAGE_BUDGET)&&Date.now()<input.deadline;page++){
      const result=await processPage({db:input.db,adapters:input.adapters,scope:input.scope,window:input.window,ownerToken,paginationSeen,garantirPedidosCitados:input.garantirPedidosCitados});
      if(!result.acquired||result.terminal)break;
    }
  }
}

export interface TiktokFinancialCandidate {
  orderId: string; occurredAt: string; lastAttemptAt: string | null;
  lastOutcome: "pending" | "retryable_error" | null;
}

const MINUTE = 60_000;

export function tiktokStatementNextEligibleAt(candidate: TiktokFinancialCandidate): number {
  if (!candidate.lastAttemptAt) return 0;
  const delay = candidate.lastOutcome === "pending" ? 6 * 60 * MINUTE : 15 * MINUTE;
  return new Date(candidate.lastAttemptAt).getTime() + delay;
}

/** 80/20 recente/historico, preenchendo vagas ociosas sem bloquear nenhuma classe. */
export function allocateTiktokFinancialQuota(
  candidates: readonly TiktokFinancialCandidate[], limit: number, now = Date.now()
): TiktokFinancialCandidate[] {
  const eligible = candidates.filter((item) => tiktokStatementNextEligibleAt(item) <= now);
  const oldest = (items: TiktokFinancialCandidate[]) => items.sort((a, b) =>
    (a.lastAttemptAt ? new Date(a.lastAttemptAt).getTime() : 0) - (b.lastAttemptAt ? new Date(b.lastAttemptAt).getTime() : 0)
    || new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
    || a.orderId.localeCompare(b.orderId));
  const boundary = now - 30 * 86_400_000;
  const recent = oldest(eligible.filter((item) => new Date(item.occurredAt).getTime() >= boundary));
  const historical = oldest(eligible.filter((item) => new Date(item.occurredAt).getTime() < boundary));
  const recentQuota = Math.ceil(limit * 0.8);
  const historicalQuota = limit - recentQuota;
  const selected = [...recent.slice(0, recentQuota), ...historical.slice(0, historicalQuota)];
  const selectedIds = new Set(selected.map((item) => item.orderId));
  return [...selected, ...oldest(eligible.filter((item) => !selectedIds.has(item.orderId)))].slice(0, limit);
}
