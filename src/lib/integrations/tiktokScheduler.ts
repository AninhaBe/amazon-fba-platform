import { dbQuery, dbTransaction, hasDb } from "../db";
import { filtroDeAssinaturaAtiva } from "./assinaturaPausaSync";
import { getTiktokShops, refreshTiktokShopIfNeeded } from "../tiktokStore";
import { runWithWorkspace } from "../workspaceScope";
import { runTiktokSyncBatch, type TiktokSyncStatus } from "./tiktokSync";
import { liveTiktokFinancialAdapters } from "./tiktokFinancialApi";
import { isFinancialSchemaMissing } from "./tiktokFinancialLedger";
import { processPaymentsPage, processStatementsPage, processUnsettledPage, selectFinancialWindows } from "./tiktokFinancialPipeline";
import { runTiktokFinancialScheduler } from "./tiktokFinancialScheduler";

const PROVIDER = "tiktok_shop";
/** Namespace reservado ao seed de demonstracao (`scripts/_demo-seed.mjs`). */
const DEMO_SHOP_PREFIX = "demo-%";

interface SyncCandidate {
  workspace_id: string;
  shop_id: string;
  connection_id: string;
}

export interface ScheduledTiktokResult {
  workspaceId: string;
  shopId: string;
  status: TiktokSyncStatus["status"] | "failed";
  phase?: TiktokSyncStatus["phase"];
  error?: TiktokSyncStatus["error"];
  progress?: number;
  reason?: string;
}

/**
 * Seleciona diretamente as lojas autorizadas. O LEFT JOIN inclui conexões
 * antigas, criadas antes de existir workspace_marketplace_syncs para TikTok.
 */
/**
 * `budgetMs` era 180_000 — nove vezes o de todos os outros canais (Shopee e o
 * próprio `runTiktokSyncBatch` usam 20_000). Com os quatro jobs do cron
 * disparando em paralelo contra o mesmo container, o TikTok era o único que
 * ficava minutos segurando memória, e era sempre ele que morria: o Render
 * devolvia 502 em tempos variados (37s, 75s, 100s — medidos em 15/08/2026), o
 * processo caía antes de avançar o checkpoint, e a janela financeira de
 * 12/08→13/08 foi retentada 80 vezes sem sair da página 0.
 *
 * Fazer menos por rodada e TERMINAR avança mais que fazer muito e morrer, porque
 * o trabalho só é registrado no fim. Rodando a cada 5 minutos, o backfill anda.
 */
export async function runScheduledTiktokSync(
  connectionLimit = 3,
  budgetMs = 60_000
): Promise<ScheduledTiktokResult[]> {
  if (!hasDb()) return [];

  const candidates = await dbQuery<SyncCandidate>(
    `SELECT shop.workspace_id, shop.shop_id, $1 || ':' || shop.shop_id AS connection_id
       FROM workspace_tiktok_shops shop
       LEFT JOIN workspace_marketplace_syncs sync
         ON sync.workspace_id = shop.workspace_id
        AND sync.provider = $1
        AND sync.connection_id = $1 || ':' || shop.shop_id
      WHERE ${filtroDeAssinaturaAtiva("shop")}
        AND (
           NOT EXISTS (SELECT 1 FROM workspace_tiktok_shops duplicate
             WHERE duplicate.shop_id=shop.shop_id AND duplicate.workspace_id<>shop.workspace_id)
         -- Loja sintetica do workspace de demonstracao NUNCA vai para a API real.
         --
         -- Ela existe para o revisor do App review ver a tela com dado; o token e
         -- falso, entao toda tentativa volta 36009004 e grava status='error' no
         -- sync — e o erro aparece na frente do dashboard, justamente para quem
         -- estamos tentando impressionar. O Shopee ja pula demo pelo
         -- metadata->'demo' da integracao (shopeeScheduler.ts); o TikTok nao tem
         -- essa coluna, porque a conexao dele mora em workspace_tiktok_shops.
         -- O marcador aqui e o prefixo do shop_id, que o seed reserva: shop_id
         -- real do TikTok e numerico, entao demo- nunca colide com loja viva.
         AND shop.shop_id NOT LIKE $3
         AND (
           sync.connection_id IS NULL
           OR (sync.status IN ('pending', 'syncing', 'error')
               AND (sync.lease_until IS NULL OR sync.lease_until < now()))
           OR (sync.status = 'complete'
               AND COALESCE(sync.last_success_at, sync.updated_at) < now() - interval '10 minutes')
         ))
      ORDER BY
        -- Loja sem linha de sync OU que nunca fechou uma janela (covered_from
        -- nulo) é primeira sincronização: fura a fila para o vendedor não
        -- esperar atrás do backfill das lojas antigas. Mesmo desenho do
        -- shopeeScheduler.ts e do mercadoLivreScheduler.ts.
        CASE WHEN sync.connection_id IS NULL OR sync.covered_from IS NULL THEN 0
             WHEN sync.status = 'complete' THEN 2
             ELSE 1 END,
        COALESCE(sync.updated_at, shop.connected_at) ASC
      LIMIT $2`,
    [PROVIDER, connectionLimit, DEMO_SHOP_PREFIX]
  );

  return Promise.all(candidates.map(async (candidate): Promise<ScheduledTiktokResult> => {
    try {
      return await runWithWorkspace(candidate.workspace_id, async () => {
        const sync = await runTiktokSyncBatch(candidate.connection_id, budgetMs);
        try {
          const rawShop=(await getTiktokShops()).find(shop=>shop.shopId===candidate.shop_id);
          if(rawShop){const shop=await refreshTiktokShopIfNeeded(rawShop);const adapters=liveTiktokFinancialAdapters({accessToken:shop.accessToken,shopCipher:shop.shopCipher});const scope={workspaceId:candidate.workspace_id,connectionId:candidate.connection_id};const windows=await selectFinancialWindows(dbQuery,scope);await runTiktokFinancialScheduler({db:{query:dbQuery,transaction:dbTransaction},adapters,scope,window:windows.closed,deadline:Date.now()+Math.max(1_000,Math.floor(budgetMs/3)),processors:[processStatementsPage,processPaymentsPage,processUnsettledPage]});}
        } catch(error) { if(!isFinancialSchemaMissing(error)) throw error; }
        return {
          workspaceId: candidate.workspace_id,
          shopId: candidate.shop_id,
          status: sync.status,
          progress: sync.progress,
          phase: sync.phase,
          error: sync.error,
        };
      });
    } catch (error) {
      return {
        workspaceId: candidate.workspace_id,
        shopId: candidate.shop_id,
        status: "failed",
        reason: error instanceof Error ? error.message : "Erro desconhecido",
      };
    }
  }));
}
