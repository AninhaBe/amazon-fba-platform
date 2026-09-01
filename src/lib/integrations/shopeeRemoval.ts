export type ShopeeRemovalQuery = <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<T[]>;

export type ShopeeRemovalTransaction = <T>(
  work: (query: ShopeeRemovalQuery) => Promise<T>,
) => Promise<T>;

const PROVIDER = "shopee";
const TAX_RATE_SETTING_PREFIX = "shopee:tax_rate:";

/**
 * Remove somente credenciais e dados locais de uma conexão Shopee owned pelo
 * workspace. Não chama a OpenAPI e não representa revogação no marketplace.
 */
export async function removeLocalShopeeConnection(
  transaction: ShopeeRemovalTransaction,
  workspaceId: string,
  connectionId: string,
): Promise<boolean> {
  return transaction(async (query) => {
    const owned = await query<{ id: string }>(
      `SELECT id FROM workspace_integrations
        WHERE workspace_id=$1 AND id=$2 AND provider=$3
        FOR UPDATE`,
      [workspaceId, connectionId, PROVIDER],
    );
    if (!owned.length) return false;

    // Ordem global: integração -> sync. Writers de sync tomam apenas sync;
    // settings/custos tomam apenas integração. Assim a remoção espera writers
    // em voo sem formar ciclo e apaga qualquer escrita concluída antes dela.
    await query(
      `SELECT connection_id FROM workspace_marketplace_syncs
        WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3
        FOR UPDATE`,
      [workspaceId, PROVIDER, connectionId],
    );

    const scope = [workspaceId, PROVIDER, connectionId];
    for (const table of [
      "workspace_channel_order_fees",
      "workspace_channel_order_items",
      "workspace_channel_orders",
      "workspace_channel_products",
      "workspace_channel_offer_history",
      "workspace_marketplace_orders",
      "workspace_marketplace_shipments",
      "workspace_marketplace_products",
      "workspace_marketplace_events",
      "workspace_marketplace_syncs",
    ]) {
      await query(
        `DELETE FROM ${table} WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3`,
        scope,
      );
    }

    const costPrefix = `shopee:${connectionId}:`;
    await query(
      `DELETE FROM workspace_product_costs
        WHERE workspace_id=$1 AND left(id,length($2))=$2`,
      [workspaceId, costPrefix],
    );
    await query(
      `DELETE FROM workspace_settings WHERE workspace_id=$1 AND key=$2`,
      [workspaceId, `${TAX_RATE_SETTING_PREFIX}${connectionId}`],
    );

    const removed = await query<{ id: string }>(
      `DELETE FROM workspace_integrations
        WHERE workspace_id=$1 AND id=$2 AND provider=$3
        RETURNING id`,
      [workspaceId, connectionId, PROVIDER],
    );
    return removed.length === 1;
  });
}
