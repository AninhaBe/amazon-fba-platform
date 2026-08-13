export type TiktokTaxRateQuery = <T = Record<string, unknown>>(
  sql: string, params?: unknown[]
) => Promise<T[]>;

/** Atualiza somente a loja que pertence simultaneamente ao tenant e ao shop informados. */
export async function updateTiktokShopTaxRate(
  query: TiktokTaxRateQuery, workspaceId: string, shopId: string, taxRate: number | null
): Promise<boolean> {
  const rows = await query(
    `UPDATE workspace_tiktok_shops SET tax_rate=$3
      WHERE workspace_id=$1 AND shop_id=$2 RETURNING 1`,
    [workspaceId, shopId, taxRate]
  );
  return rows.length > 0;
}
