export type ShopeeTaxRateDraft =
  | { valid: true; value: number | null }
  | { valid: false };

export function parseShopeeTaxRateDraft(draft: string): ShopeeTaxRateDraft {
  const text = draft.trim();
  if (!text) return { valid: true, value: null };
  const normalized = text.replace(",", ".");
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return { valid: false };
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 && value <= 100
    ? { valid: true, value }
    : { valid: false };
}

export function shopeeSettingsPath(connectionId: string): string {
  return `/api/integrations/shopee/settings?${new URLSearchParams({ connection_id: connectionId })}`;
}
