const RESERVED_KEY = "_sellercore";

/** Payload de marketplace nunca pode criar ou sobrescrever metadado interno. */
export function stripReservedCanonicalMetadata(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const { [RESERVED_KEY]: _reserved, ...safe } = raw as Record<string, unknown>;
  void _reserved;
  return safe;
}

/** Espelho puro da precedência usada pelo merge JSONB no upsert. */
export function mergeCanonicalRaw(incoming: unknown, stored: unknown): unknown {
  const safeIncoming = stripReservedCanonicalMetadata(incoming);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return safeIncoming;
  const internal = (stored as Record<string, unknown>)[RESERVED_KEY];
  if (!internal || typeof internal !== "object" || Array.isArray(internal)) return safeIncoming;
  return { ...((safeIncoming && typeof safeIncoming === "object" && !Array.isArray(safeIncoming)) ? safeIncoming : {}), [RESERVED_KEY]: internal };
}
