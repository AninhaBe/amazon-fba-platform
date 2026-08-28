export type ShopeeModuleKind = "monitor" | "catalog" | "inventory" | "costs" | "abc";

export const SHOPEE_MODULES = {
  monitor: { title: "Monitor da conta", subtitle: "Pedidos e resultado financeiro capturado pela Shopee.", endpoint: "financial", period: true },
  catalog: { title: "Anúncios", subtitle: "Catálogo agregado por anúncio, em modo somente leitura.", endpoint: "products", period: false },
  inventory: { title: "Radar de estoque", subtitle: "Estoque agregado e cobertura baseada nas vendas capturadas.", endpoint: "inventory", period: true },
  costs: { title: "Produtos", subtitle: "Custos por SKU, isolados por workspace e loja Shopee.", endpoint: "costs", period: false },
  abc: { title: "Curva ABC", subtitle: "Receita e participação por produto no período.", endpoint: "abc", period: true },
} as const;

export function shopeeModuleQuery(source: string, connectionId: string, kind: ShopeeModuleKind) {
  const input = new URLSearchParams(source), output = new URLSearchParams({ connection_id: connectionId });
  // E3 (28/08/2026): o monitor ganhou busca de servidor — q entra também nele.
  if (["monitor", "catalog", "inventory", "costs"].includes(kind)) {
    const q = input.get("q"); if (q) output.set("q", q);
  }
  if (kind !== "abc") {
    for (const key of ["limit", "offset"]) { const value = input.get(key); if (value) output.set(key, value); }
  }
  if (["monitor", "inventory", "abc"].includes(kind)) {
    // Período personalizado deixou de ser descartado (E3): com from+to na URL,
    // eles é que definem o período; days fica de fallback.
    const from = input.get("from"), to = input.get("to");
    if (from && to) { output.set("from", from); output.set("to", to); }
    else output.set("days", input.get("days") ?? "30");
  }
  return output.toString();
}

export function shopeeModuleHref(path: string, source: string, connectionId: string) {
  const input = new URLSearchParams(source), output = new URLSearchParams({ connection_id: connectionId });
  for (const key of ["q", "days", "from", "to", "limit", "offset"]) input.getAll(key).forEach(value => output.append(key, value));
  return `${path}?${output}`;
}

export function shopeeModuleError(code?: string) {
  if (code === "CONNECTION_NOT_FOUND") return "A loja selecionada não está conectada a este workspace.";
  if (code === "INVALID_COST") return "Informe um custo válido, maior ou igual a zero.";
  return null;
}
