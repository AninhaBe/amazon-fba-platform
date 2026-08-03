import { dbQuery, hasDb } from "../db";
import { currentWorkspaceId, runWithWorkspace } from "../workspaceScope";
import { runWithAccount, type AccountCtx } from "../accountContext";
import { getAccount } from "../accountStore";
import { getInventory } from "../inventory";

// Foto diária da oferta na Amazon (ADR-010). O sync da Amazon só persiste pedidos —
// estoque é sempre lido ao vivo e o passado se perde. Sem série temporal dá pra saber
// QUE um anúncio parou de vender, mas não POR QUE (o estoque zerou anteontem).
//
// Custo: `getInventory()` é uma chamada paginada que traz todos os SKUs de uma vez, e
// tem cache SWR de 10 min — na mesma passada do cron o snapshot de ranking já a
// aquece, então na prática esta captura não gera chamada nova.
//
// Chave por SKU (não por ASIN): o estoque na Amazon é por SKU, e a mesma ASIN pode ter
// vários SKUs (as variações de protetor da conta compartilham a ASIN B0H9R1888D).

const PROVIDER = "amazon";
const CONNECTION_PREFIX = "amazon:";

interface OfferRow {
  external_product_id: string;
  sku: string;
  available_qty: number;
}

// Grava a foto do dia. Preço e status ficam NULL: o FBA Inventory não os expõe, e
// buscá-los custaria 1 chamada por SKU numa API de cota apertada (ver ADR-010).
async function recordAmazonOffers(connectionId: string, rows: OfferRow[]): Promise<void> {
  if (!rows.length) return;
  await dbQuery(
    `INSERT INTO workspace_channel_offer_history
       (workspace_id, provider, connection_id, external_product_id, captured_on,
        sku, available_qty, updated_at)
     SELECT $1, $2, $3, item.external_product_id, CURRENT_DATE,
            item.sku, item.available_qty, now()
       FROM jsonb_to_recordset($4::jsonb) AS item(
         external_product_id text, sku text, available_qty integer
       )
     ON CONFLICT (workspace_id, provider, connection_id, external_product_id, captured_on)
     DO UPDATE SET sku = EXCLUDED.sku, available_qty = EXCLUDED.available_qty, updated_at = now()`,
    [currentWorkspaceId(), PROVIDER, connectionId, JSON.stringify(rows)]
  );
}

async function snapshotOneAccount(account: AccountCtx, connectionId: string): Promise<number> {
  return runWithAccount(account, async () => {
    const inventory = await getInventory().catch(() => []);
    const rows = inventory
      .filter((item) => item.sellerSku)
      .map((item) => ({
        external_product_id: item.sellerSku,
        sku: item.sellerSku,
        available_qty: item.fulfillable,
      }));
    await recordAmazonOffers(connectionId, rows);
    return rows.length;
  });
}

export async function runScheduledAmazonOfferSnapshot(limit = 5): Promise<number> {
  if (!hasDb()) return 0;
  const rows = await dbQuery<{ workspace_id: string; connection_id: string }>(
    `SELECT workspace_id, connection_id
       FROM workspace_marketplace_syncs
      WHERE provider = $1
      ORDER BY updated_at DESC
      LIMIT $2`,
    [PROVIDER, limit]
  );

  let total = 0;
  for (const row of rows) {
    const sellerId = row.connection_id.startsWith(CONNECTION_PREFIX)
      ? row.connection_id.slice(CONNECTION_PREFIX.length)
      : row.connection_id;
    try {
      // getAccount() lê currentWorkspaceId() e LANÇA sem contexto — por isso ele tem
      // de vir DENTRO do runWithWorkspace. Fora dele, esta função estourava na
      // primeira conta e o cron reportava 0 sem nunca gravar nada.
      total += await runWithWorkspace(row.workspace_id, async () => {
        const account = await getAccount(sellerId);
        if (!account?.refreshToken) return 0;
        return snapshotOneAccount(account, row.connection_id);
      });
    } catch (err) {
      // Uma conta que falhar não derruba as outras nem o cron — mas o erro aparece.
      console.error(`[offer-snapshot] falhou em ${row.workspace_id}/${sellerId}:`, err);
    }
  }
  return total;
}
