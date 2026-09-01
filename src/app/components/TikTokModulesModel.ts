import { janelaDeDias } from "./janelaDeDias";
export function moduleHref(path: string, currentQuery: string, connectionId?: string | null) {
  const source = new URLSearchParams(currentQuery), params = new URLSearchParams();
  const allowed = path === "/tiktok/catalogo" ? ["q", "status", "limit", "offset"]
    : path === "/tiktok/produtos" ? ["q", "limit", "offset"]
      : path === "/tiktok/estoque" ? ["q", "filter", "from", "to", "limit", "offset"]
        : path === "/tiktok/abc" ? ["from", "to", "limit", "offset"]
          : path === "/tiktok/monitor" ? ["q", "status", "order_id", "sku", "from", "to", "limit", "offset"]
            : path === "/tiktok/financeiro" ? ["from", "to", "limit", "offset"]
            : ["from", "to"];
  allowed.forEach((key) => source.getAll(key).forEach((value) => params.append(key, value)));
  if (connectionId) params.set("connection_id", connectionId);
  return `${path}${params.size ? `?${params}` : ""}`;
}

export function updatedModuleQuery(currentQuery: string, values: Record<string, string | null>) {
  const params = new URLSearchParams(currentQuery);
  Object.entries(values).forEach(([key, value]) => value ? params.set(key, value) : params.delete(key));
  if (!Object.hasOwn(values, "offset")) params.set("offset", "0");
  return params.toString();
}

export function moduleConnectionHref(path: string, currentQuery: string, connectionId: string) {
  return moduleHref(path, updatedModuleQuery(currentQuery, { connection_id: connectionId }), connectionId);
}

export function moduleApiQuery(currentQuery: string, connectionId: string, kind: "monitor"|"finance"|"catalog"|"inventory"|"costs"|"abc") {
  const source = new URLSearchParams(currentQuery), out = new URLSearchParams();
  const allowed = kind === "monitor" ? ["status", "order_id", "sku", "limit", "offset", "from", "to"]
    : kind === "finance" ? ["limit", "offset", "from", "to"]
    : kind === "catalog" ? ["q", "status", "limit", "offset"]
      : kind === "inventory" ? ["q", "filter", "limit", "offset", "from", "to"]
        : kind === "costs" ? ["q", "limit", "offset"] : ["limit", "offset", "from", "to"];
  allowed.forEach(k => source.getAll(k).forEach(v => out.append(k, v)));
  out.set("connection_id", connectionId);
  if (["monitor", "finance", "inventory", "abc"].includes(kind) && (!out.has("from") || !out.has("to"))) {
    // ⚠️ MESMO DEFEITO DE FUSO do `syncPeriod` (01/09/2026): `toISOString` é UTC,
    // e das 21h às 23:59 de Brasília este fallback pedia uma janela deslocada um
    // dia para a frente. Ver `janelaDeDias`.
    const janela = janelaDeDias("30");
    out.set("from", janela.from); out.set("to", janela.to);
  }
  return out.toString();
}
export function moduleError(code?: string) {
  if (code === "OWNERSHIP_CONFLICT") return "Esta loja está vinculada de forma conflitante. Gerencie as conexões antes de continuar.";
  if (code === "CONNECTION_NOT_FOUND" || code === "INVALID_CONNECTION_ID") return "A conexão selecionada não é válida ou não pertence mais a este workspace.";
  if (code === "REAUTH_REQUIRED") return "A autorização expirou. Reconecte a loja TikTok Shop.";
  return null;
}

export function moduleMoney(value: unknown, currency = "BRL") {
  return value == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(Number(value));
}
