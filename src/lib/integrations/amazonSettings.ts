// Alíquota de imposto sobre vendas da Amazon.
//
// A Amazon não informa imposto — ela não conhece o regime tributário do
// vendedor. É a pessoa que declara o percentual, como já acontece no Mercado
// Livre, na Shopee e no TikTok. Sem isso, o lucro da Amazon saía SEM imposto
// enquanto o do ML saía COM: comparar os dois canais no painel era injusto, e a
// Amazon parecia mais rentável do que é.
//
// Segue o desenho da Shopee (`shopeeSettings.ts`), não o do ML: guarda em
// `workspace_settings` e distingue **não configurado (`null`)** de **zero
// configurado (`0`)**. O ML faz `Number(metadata.taxRate ?? 0)`, que transforma
// "não sei" em "0%" — exatamente a confusão que o projeto proíbe. Aqui, quem
// não configurou vê "—" e sabe que falta; quem é isento configura 0 e vê 0%.
//
// A chave é por conta (`sellerId`), não por workspace: a pessoa pode ter mais de
// uma conta Amazon, em regimes diferentes.

export type AmazonSettingsQuery = <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<T[]>;

const KEY_PREFIX = "amazon:tax_rate:";

export type AmazonTaxRateSetting =
  | { valid: true; value: number | null }
  | { valid: false };

/** `null` é explícito: limpa a configuração e volta a "não sei". */
export function parseAmazonTaxRateSetting(body: unknown): AmazonTaxRateSetting {
  if (!body || typeof body !== "object" || !("taxRate" in body)) return { valid: false };
  const value = (body as { taxRate?: unknown }).taxRate;
  if (value === null) return { valid: true, value: null };
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    return { valid: false };
  }
  return { valid: true, value };
}

export function normalizeAmazonTaxRate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

export function amazonTaxRateSettingKey(sellerId: string): string {
  return `${KEY_PREFIX}${sellerId}`;
}

export async function getAmazonTaxRateSetting(
  query: AmazonSettingsQuery,
  workspaceId: string,
  sellerId: string,
): Promise<number | null> {
  const rows = await query<{ value: unknown }>(
    `SELECT value FROM workspace_settings WHERE workspace_id=$1 AND key=$2`,
    [workspaceId, amazonTaxRateSettingKey(sellerId)],
  );
  const stored = rows[0]?.value;
  if (!stored || typeof stored !== "object" || !("taxRate" in stored)) return null;
  return normalizeAmazonTaxRate((stored as { taxRate?: unknown }).taxRate);
}

export async function setAmazonTaxRateSetting(
  query: AmazonSettingsQuery,
  workspaceId: string,
  sellerId: string,
  taxRate: number | null,
): Promise<void> {
  const key = amazonTaxRateSettingKey(sellerId);
  if (taxRate === null) {
    await query(`DELETE FROM workspace_settings WHERE workspace_id=$1 AND key=$2`, [workspaceId, key]);
    return;
  }
  const normalized = normalizeAmazonTaxRate(taxRate);
  if (normalized === null) throw new RangeError("Alíquota da Amazon inválida.");
  await query(
    `INSERT INTO workspace_settings (workspace_id,key,value,updated_at)
     VALUES ($1,$2,$3::jsonb,now())
     ON CONFLICT (workspace_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
    [workspaceId, key, JSON.stringify({ taxRate: normalized })],
  );
}

/**
 * Imposto do período. `null` quando a alíquota não foi configurada — e `null`
 * NÃO pode virar zero na tela: "isento" e "não sei" levam a decisões de preço
 * diferentes.
 */
export function amazonTaxAmount(revenue: number, taxRate: number | null): number | null {
  if (taxRate == null) return null;
  return +((Math.max(0, revenue) * taxRate) / 100).toFixed(2);
}
