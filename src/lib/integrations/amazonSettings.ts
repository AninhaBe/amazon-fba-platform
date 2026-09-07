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
 * ⚠️ EXCECAO NOMEADA AO `null != 0` — ADR-038, decisao da dona do produto em
 * 07/09/2026, verbatim: *"nesse caso, ausencia e zero mesmo"*.
 *
 * Aliquota nao cadastrada entra na conta como ZERO, e nao como desconhecido.
 * O motivo esta na ADR: o dado e DELA (nao do marketplace), ela resolve num
 * campo, e existe default honesto — sem aliquota declarada, nada incide.
 * Travessao apagava lucro e margem inteiros de quem so nao preencheu um campo.
 *
 * ⚠️ O QUE NAO MUDA: tarifa, frete e custo continuam `null` quando
 * desconhecidos. Ali a fonte e o marketplace e nao ha default honesto.
 *
 * ⚠️ E O ZERO NAO E SILENCIOSO: `taxRateKnown` viaja no payload para a tela
 * manter a pendencia "cadastrar aliquota". Depois desta mudanca, **quem
 * cadastrou 0% e quem nao cadastrou produzem a MESMA conta** — o sinal e a
 * unica diferenca, e por isso ele e booleano e nao derivado de `taxRate == null`
 * (que se apaga sozinho no dia em que alguem cadastrar 0 de verdade).
 */
export function amazonTaxAmount(revenue: number, taxRate: number | null): number {
  if (taxRate == null) return 0;
  return +((Math.max(0, revenue) * taxRate) / 100).toFixed(2);
}
