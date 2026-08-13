import type { DbQuery } from "../db";

export type ShopeeWriteTransaction = <T>(work: (query: DbQuery) => Promise<T>) => Promise<T>;

export type ShopeeFenceResult<T> =
  | { owned: true; value: T }
  | { owned: false };

const PROVIDER = "shopee";

/**
 * Writers de configuração/custo bloqueiam somente a integração. A remoção
 * toma esse mesmo lock antes de apagar, portanto um writer atrasado observa a
 * conexão ausente e não recria dados órfãos.
 */
export function withShopeeIntegrationWriteFence<T>(
  transaction: ShopeeWriteTransaction,
  workspaceId: string,
  connectionId: string,
  work: (query: DbQuery) => Promise<T>,
): Promise<ShopeeFenceResult<T>> {
  return transaction(async (query) => {
    const locked = await query<{ id: string }>(
      `SELECT id FROM workspace_integrations
        WHERE workspace_id=$1 AND id=$2 AND provider=$3 AND status='connected'
        FOR UPDATE`,
      [workspaceId, connectionId, PROVIDER],
    );
    if (!locked[0]) return { owned: false };
    return { owned: true, value: await work(query) };
  });
}

/**
 * Writers do sync bloqueiam somente a linha do sync e validam o lease dentro
 * da mesma transação que persiste os dados. A remoção usa a ordem única
 * integração -> sync; nenhum writer toma ambos os locks, evitando ciclo.
 */
export function withShopeeSyncWriteFence<T>(
  transaction: ShopeeWriteTransaction,
  workspaceId: string,
  connectionId: string,
  ownershipToken: string,
  work: (query: DbQuery) => Promise<T>,
): Promise<ShopeeFenceResult<T>> {
  return transaction(async (query) => {
    const locked = await query<{ connection_id: string }>(
      `SELECT connection_id FROM workspace_marketplace_syncs
        WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3
          AND lease_until::text=$4 AND lease_until>clock_timestamp()
        FOR UPDATE`,
      [workspaceId, PROVIDER, connectionId, ownershipToken],
    );
    if (!locked[0]) return { owned: false };
    return { owned: true, value: await work(query) };
  });
}
