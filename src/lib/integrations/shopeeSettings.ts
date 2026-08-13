export type ShopeeSettingsQuery = <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<T[]>;

const KEY_PREFIX = "shopee:tax_rate:";

export type ShopeeTaxRateSetting =
  | { valid: true; value: number | null }
  | { valid: false };

export function parseShopeeTaxRateSetting(body: unknown): ShopeeTaxRateSetting {
  if (!body || typeof body !== "object" || !("taxRate" in body)) return { valid: false };
  const value = (body as { taxRate?: unknown }).taxRate;
  if (value === null) return { valid: true, value: null };
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    return { valid: false };
  }
  return { valid: true, value };
}

export function normalizeShopeeTaxRate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

export function shopeeTaxRateSettingKey(connectionId: string): string {
  return `${KEY_PREFIX}${connectionId}`;
}

export async function getShopeeTaxRateSetting(
  query: ShopeeSettingsQuery,
  workspaceId: string,
  connectionId: string,
): Promise<number | null> {
  const rows = await query<{ value: unknown }>(
    `SELECT value FROM workspace_settings WHERE workspace_id=$1 AND key=$2`,
    [workspaceId, shopeeTaxRateSettingKey(connectionId)],
  );
  const stored = rows[0]?.value;
  if (!stored || typeof stored !== "object" || !("taxRate" in stored)) return null;
  return normalizeShopeeTaxRate((stored as { taxRate?: unknown }).taxRate);
}

export async function setShopeeTaxRateSetting(
  query: ShopeeSettingsQuery,
  workspaceId: string,
  connectionId: string,
  taxRate: number | null,
): Promise<void> {
  const key = shopeeTaxRateSettingKey(connectionId);
  if (taxRate === null) {
    await query(
      `DELETE FROM workspace_settings WHERE workspace_id=$1 AND key=$2`,
      [workspaceId, key],
    );
    return;
  }
  const normalized = normalizeShopeeTaxRate(taxRate);
  if (normalized === null) throw new RangeError("Aliquota Shopee invalida.");
  await query(
    `INSERT INTO workspace_settings (workspace_id,key,value,updated_at)
     VALUES ($1,$2,$3::jsonb,now())
     ON CONFLICT (workspace_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
    [workspaceId, key, JSON.stringify({ taxRate: normalized })],
  );
}
