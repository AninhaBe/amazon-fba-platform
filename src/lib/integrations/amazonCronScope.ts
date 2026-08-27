import { runWithWorkspace } from "../workspaceScope";
import { getAccount } from "../accountStore";
import type { AccountCtx } from "../accountContext";

/**
 * Roda um passo do cron da Amazon para UMA conta, sempre dentro do escopo do
 * workspace dela.
 *
 * ⚠️ POR QUE ISTO EXISTE, e por que `getAccount` mora DENTRO do
 * `runWithWorkspace`: `getAccount` (accountStore) chama `currentWorkspaceId()`,
 * que LANÇA "Workspace autenticado ausente." fora de contexto. O cron não tem
 * sessão — ele abre o contexto por linha —, então buscar a conta antes de abrir
 * o escopo estoura na PRIMEIRA conta e derruba o passo inteiro, que devolve
 * zero: indistinguível de "não havia nada a fazer".
 *
 * Já aconteceu duas vezes. `bb4dcdf` (03/08/2026) consertou assim as fotos
 * diárias de ranking e de oferta — "fotos diarias da Amazon nunca gravaram" —,
 * mas `warm` e `insights` ficaram de fora daquele diff e seguiram quebrados até
 * 27/08/2026: os insights do briefing pararam de ser detectados e a última
 * escrita em `workspace_insights` era de dois dias antes. Um lugar só para a
 * regra é o que impede a terceira vez.
 *
 * Falha de uma conta não derruba as outras — mas NUNCA é engolida: o erro sai
 * no log com workspace e vendedor, que é o que faltava para o defeito aparecer.
 */
export async function comContaDoWorkspace<T>(
  rotulo: string,
  row: { workspace_id: string; sellerId: string },
  vazio: T,
  fn: (account: AccountCtx) => Promise<T>
): Promise<T> {
  try {
    return await runWithWorkspace(row.workspace_id, async () => {
      const account = await getAccount(row.sellerId);
      if (!account?.refreshToken) return vazio;
      return fn({ sellerId: account.sellerId, refreshToken: account.refreshToken });
    });
  } catch (err) {
    console.error(`[${rotulo}] falhou em ${row.workspace_id}/${row.sellerId}:`, err);
    return vazio;
  }
}
