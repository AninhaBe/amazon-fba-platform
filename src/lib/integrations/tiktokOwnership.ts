import type { DbQuery } from "../db";

export const TIKTOK_OWNERSHIP_ERROR = "Nao foi possivel operar esta loja TikTok.";

export class TiktokOwnershipConflictError extends Error {
  constructor() {
    super(TIKTOK_OWNERSHIP_ERROR);
    this.name = "TiktokOwnershipConflictError";
  }
}

/** Fail-closed: a identidade externa da loja deve pertencer a um unico workspace. */
export async function assertGlobalTiktokShopOwnership(
  query: DbQuery,
  workspaceId: string,
  shopIds: readonly string[],
  lock = false
): Promise<void> {
  const ids = [...new Set(shopIds)].sort();
  if (!ids.length) return;
  if (lock) {
    for (const shopId of ids) {
      await query("SELECT pg_advisory_xact_lock(hashtextextended('tiktok_shop:' || $1, 0))", [shopId]);
    }
  }
  const conflicts = await query<{ shop_id: string }>(
    `SELECT shop_id
       FROM workspace_tiktok_shops
      WHERE shop_id=ANY($1::text[])
      GROUP BY shop_id
     HAVING COUNT(DISTINCT workspace_id) > 1
         OR BOOL_OR(workspace_id <> $2)
      LIMIT 1`,
    [ids, workspaceId]
  );
  if (conflicts.length) throw new TiktokOwnershipConflictError();
}
