import { dbQuery, hasDb } from "../db";
import { runWithWorkspace } from "../workspaceScope";
import { runWithAccount, type AccountCtx } from "../accountContext";
import { getAccount } from "../accountStore";
import { getInventory } from "../inventory";
import { spapiFetch, defaultMarketplaceId } from "../spapi";
import { recordRanks } from "../rankHistory";
import { recordSeen, watchlistForSnapshot, type SeenItem } from "../watchlist";

// Foto diária de ranking (ADR-009). Para cada conta ativa, fotografa o rank de
// (1) todos os produtos da conta (FBA) + (2) a watchlist (ASINs que entraram via
// busca — ADR-011). Assim o histórico engrossa sozinho, sem depender de a usuária
// buscar. Best-effort: falha nunca derruba o cron.

const PROVIDER = "amazon";
const CONNECTION_PREFIX = "amazon:";
// Backstop contra lista absurda — **não** é o mecanismo de controle. Quem limita de
// verdade é o orçamento de tempo abaixo, que é medido em vez de chutado.
//
// Histórico: era 150 com o comentário "(rate limit da SP-API)", o que não vinha de
// nenhum limite documentado — era uma aproximação de quanto cabia no tempo quando cada
// ASIN custava uma chamada. Com o lote de 20, essa conta mudou de patamar, e manter um
// número chutado só fazia a watchlist ser cortada em silêncio (uma conta com 317 ASINs
// monitorava 150 e nunca via os outros 167).
const MAX_ASINS = 2_000;
const CONCURRENCY = 3;
// A rota do cron tem maxDuration de 240s e a foto de ranking é o 3º de 5 passos.
// Reservar uma fatia explícita evita que ela consuma o que sobra e derrube o resto.
const TOTAL_BUDGET_MS = 90_000;

interface RankNode {
  title?: string;
  rank: number;
}

interface CatalogItem {
  salesRanks?: { classificationRanks?: RankNode[]; displayGroupRanks?: RankNode[] }[];
  summaries?: { itemName?: string; brand?: string }[];
  images?: { images: { link: string; height: number; width: number }[] }[];
}

interface Snapshot {
  rank?: number;
  category?: string;
  title?: string;
  brand?: string;
  imageUrl?: string;
}

// A mesma operação da busca aceita `identifiers` em vez de `keywords`: **20 ASINs por
// chamada**. Antes era um ASIN por requisição, o que fazia a passada custar 20x mais
// tempo e bater no orçamento do cron antes de terminar.
//
// `summaries,images` viajam de graça junto do rank — é o que mantém título e foto da
// watchlist atualizados sem requisição extra (ADR-011). Rank: grupo amplo com fallback
// para a classificação, igual à /pesquisa.
const POR_CHAMADA = 20;

async function fetchSnapshots(asins: string[], marketplaceId: string): Promise<Map<string, Snapshot>> {
  const out = new Map<string, Snapshot>();
  const data = await spapiFetch<{ items?: (CatalogItem & { asin: string })[] }>("/catalog/2022-04-01/items", {
    query: {
      marketplaceIds: marketplaceId,
      identifiers: asins.join(","),
      identifiersType: "ASIN",
      includedData: "salesRanks,summaries,images",
    },
  });
  for (const it of data.items ?? []) {
    const ranks = it.salesRanks?.[0];
    const best = ranks?.displayGroupRanks?.[0] ?? ranks?.classificationRanks?.[0];
    const summary = it.summaries?.[0];
    const biggest = (it.images?.[0]?.images ?? []).slice().sort((a, b) => b.width - a.width)[0];
    if (!best && !summary && !biggest) continue;
    out.set(it.asin, {
      rank: best?.rank,
      category: best?.title,
      title: summary?.itemName,
      brand: summary?.brand,
      imageUrl: biggest?.link,
    });
  }
  return out;
}

// Para quando o orçamento de tempo acaba: devolve quantos itens não foram processados.
async function mapLimit<T>(items: T[], limit: number, deadline: number, fn: (t: T) => Promise<void>): Promise<number> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      if (Date.now() > deadline) return;
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return Math.max(0, items.length - i);
}

async function snapshotOneAccount(account: AccountCtx, deadline: number): Promise<number> {
  return runWithAccount(account, async () => {
    const marketplaceId = defaultMarketplaceId();
    const [inventory, watch] = await Promise.all([
      getInventory().catch(() => []),
      watchlistForSnapshot().catch(() => ({ pinned: [], rest: [] })),
    ]);
    const mine = inventory.map((i) => i.asin).filter((a): a is string => !!a);
    // Ordem de prioridade antes do teto (ADR-011): o que a usuária fixou nunca é
    // descartado, depois os produtos dela, e só então o resto da watchlist por
    // recência. Sem isso o corte por MAX_ASINS seria arbitrário e silencioso.
    const asins = [...new Set([...watch.pinned, ...mine, ...watch.rest])].slice(0, MAX_ASINS);
    const cortados = new Set([...watch.pinned, ...mine, ...watch.rest]).size - asins.length;
    // Só atualizamos identidade de quem está na watchlist: os produtos da conta têm
    // sua própria tela e não devem aparecer no histórico de pesquisa.
    const naWatchlist = new Set([...watch.pinned, ...watch.rest]);

    // Fatia em lotes de 20 — é a unidade que a Catalog API aceita por chamada.
    const lotes: string[][] = [];
    for (let i = 0; i < asins.length; i += POR_CHAMADA) lotes.push(asins.slice(i, i + POR_CHAMADA));

    const captured: { asin: string; salesRank?: number; salesRankCategory?: string }[] = [];
    const identidades: SeenItem[] = [];
    const inicio = Date.now();
    let lotesOk = 0;
    const lotesRestantes = await mapLimit(lotes, CONCURRENCY, deadline, async (lote) => {
      try {
        const mapa = await fetchSnapshots(lote, marketplaceId);
        lotesOk++;
        for (const [asin, s] of mapa) {
          if (s.rank != null) captured.push({ asin, salesRank: s.rank, salesRankCategory: s.category });
          if (naWatchlist.has(asin)) {
            identidades.push({ asin, title: s.title, brand: s.brand, imageUrl: s.imageUrl });
          }
        }
      } catch (err) {
        // Um lote que falhar é pulado — não derruba a passada, mas aparece no log.
        console.error(`[rank-snapshot] lote de ${lote.length} ASIN(s) falhou:`, err);
      }
    });
    const naoProcessados = lotesRestantes * POR_CHAMADA;
    const decorrido = Date.now() - inicio;

    if (captured.length) await recordRanks(captured);
    // Sem termo de busca: atualiza título/foto sem mexer em last_seen_at nem ressuscitar
    // ASIN removido.
    if (identidades.length) await recordSeen(identidades).catch(() => {});

    // Throughput medido: é o que permite dimensionar TOTAL_BUDGET_MS com número real
    // em vez de estimativa. Sem isso o orçamento seria mais um chute.
    const porLote = lotesOk ? Math.round(decorrido / lotesOk) : 0;
    console.info(
      `[rank-snapshot] ${asins.length} ASIN(s) em ${lotes.length} lote(s): ` +
        `${lotesOk} ok, ${captured.length} com rank, ${decorrido}ms (${porLote}ms/lote)`
    );

    // Cobertura parcial nunca é silenciosa: sem isso, "0 novos" e "faltou tempo" ficam
    // indistinguíveis no log e o histórico ganha buracos sem explicação.
    if (cortados > 0) {
      console.warn(`[rank-snapshot] backstop de ${MAX_ASINS} ASINs atingido; ${cortados} ficaram de fora hoje.`);
    }
    if (naoProcessados > 0) {
      console.warn(
        `[rank-snapshot] orçamento de tempo esgotado após ${decorrido}ms; ` +
          `~${naoProcessados} ASIN(s) não foram fotografados — entram primeiro na próxima passada.`
      );
    }
    return captured.length;
  });
}

export async function runScheduledRankSnapshot(limit = 5): Promise<number> {
  if (!hasDb()) return 0;
  // Fila de quem AINDA NÃO foi fotografado hoje, do mais carente para o menos.
  //
  // Duas propriedades que sustentam a escala:
  //
  // 1. `h.ultima < CURRENT_DATE` — conta já fotografada hoje sai da fila. Como o cron
  //    roda a cada ~5 min, sem esse filtro cada conta era refotografada ~288x/dia,
  //    sobrescrevendo a mesma linha (a PK é por dia) e gastando chamada à toa.
  //
  // 2. Ordenação por carência — com `limit` contas por passada e ~288 passadas/dia,
  //    cabem ~288 × limit fotos diárias. Com limit=5 isso atende ~1.400 contas, cada
  //    uma uma vez por dia. Quem não couber numa passada é o primeiro da seguinte,
  //    porque continua sendo o mais carente.
  //
  // A ordem anterior (por `updated_at` do sync) era arbitrária: a conta com a maior
  // watchlist caía sempre em primeiro e as demais ficavam dias sem captura.
  const rows = await dbQuery<{ workspace_id: string; connection_id: string }>(
    `SELECT s.workspace_id, s.connection_id
       FROM workspace_marketplace_syncs s
       LEFT JOIN (
         SELECT workspace_id, max(captured_on) AS ultima
           FROM workspace_rank_history GROUP BY workspace_id
       ) h ON h.workspace_id = s.workspace_id
      WHERE s.provider = $1
        AND (h.ultima IS NULL OR h.ultima < CURRENT_DATE)
      ORDER BY h.ultima ASC NULLS FIRST, s.updated_at DESC
      LIMIT $2`,
    [PROVIDER, limit]
  );
  if (!rows.length) return 0; // todas já fotografadas hoje

  // Teto por conta: garante que a segunda da fila ainda tenha tempo de rodar dentro do
  // maxDuration da rota. Quem não couber hoje passa a ser o primeiro da fila amanhã.
  const orcamentoPorConta = Math.floor(TOTAL_BUDGET_MS / Math.max(1, rows.length));
  const fimGeral = Date.now() + TOTAL_BUDGET_MS;

  let total = 0;
  let puladas = 0;
  for (const row of rows) {
    if (Date.now() >= fimGeral) {
      puladas++;
      continue;
    }
    const sellerId = row.connection_id.startsWith(CONNECTION_PREFIX)
      ? row.connection_id.slice(CONNECTION_PREFIX.length)
      : row.connection_id;
    const deadline = Math.min(Date.now() + orcamentoPorConta, fimGeral);
    try {
      // getAccount() lê currentWorkspaceId() e LANÇA sem contexto — por isso ele tem
      // de vir DENTRO do runWithWorkspace. Fora dele, esta função estourava na
      // primeira conta e o cron reportava 0 sem nunca fotografar nada.
      total += await runWithWorkspace(row.workspace_id, async () => {
        const account = await getAccount(sellerId);
        if (!account?.refreshToken) return 0;
        return snapshotOneAccount({ sellerId: account.sellerId, refreshToken: account.refreshToken }, deadline);
      });
    } catch (err) {
      // best-effort: segue para a próxima conta — mas o erro aparece no log.
      console.error(`[rank-snapshot] falhou em ${row.workspace_id}/${sellerId}:`, err);
    }
  }
  if (puladas > 0) console.warn(`[rank-snapshot] ${puladas} conta(s) ficaram para a próxima passada.`);
  return total;
}
