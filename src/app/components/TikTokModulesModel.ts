export function moduleHref(path: string, currentQuery: string, connectionId?: string | null) {
  const source = new URLSearchParams(currentQuery), params = new URLSearchParams();
  // ⚠️ `days` VIAJA JUNTO com `from`/`to` (01/09/2026). Quem escolheu 7 dias e
  // navegou para outro módulo levava o intervalo personalizado e NÃO levava o
  // preset — o módulo de destino abria no padrão, e a pessoa via a escolha dela
  // sumir ao trocar de aba.
  const allowed = path === "/tiktok/catalogo" ? ["q", "status", "limit", "offset"]
    : path === "/tiktok/produtos" ? ["q", "limit", "offset"]
      : path === "/tiktok/estoque" ? ["q", "filter", "days", "from", "to", "limit", "offset"]
        : path === "/tiktok/abc" ? ["days", "from", "to", "limit", "offset"]
          : path === "/tiktok/monitor" ? ["q", "status", "order_id", "sku", "days", "from", "to", "limit", "offset"]
            : path === "/tiktok/financeiro" ? ["days", "from", "to", "limit", "offset"]
            : ["days", "from", "to"];
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
  // ⚠️ `days` ENTRA NA LISTA (01/09/2026). Sem ele, o preset que a pessoa clicou
  // era filtrado aqui e nunca chegava ao servidor — o mesmo defeito que o
  // `atividade` teve em 28/08: filtro que só existe na barra de endereço.
  const allowed = kind === "monitor" ? ["status", "order_id", "sku", "limit", "offset", "days", "from", "to"]
    : kind === "finance" ? ["limit", "offset", "days", "from", "to"]
    : kind === "catalog" ? ["q", "status", "limit", "offset"]
      : kind === "inventory" ? ["q", "filter", "limit", "offset", "days", "from", "to"]
        : kind === "costs" ? ["q", "limit", "offset"] : ["limit", "offset", "days", "from", "to"];
  allowed.forEach(k => source.getAll(k).forEach(v => out.append(k, v)));
  out.set("connection_id", connectionId);
  // ⚠️ O FALLBACK DE 30 DIAS SAIU DAQUI (01/09/2026), e ele era DOIS defeitos.
  //
  // 1. Fuso: montava as datas com `toISOString()`, que é UTC, então das 21h às
  //    23:59 de Brasília pedia uma janela um dia à frente.
  // 2. **Rótulo de um recorte sobre o número de outro**, e este chegava à tela
  //    em QUALQUER horário: ao abrir, a URL não tem `from`/`to`, o filtro
  //    mostrava "Hoje" (o padrão do hook) e este fallback mandava 30 dias. A
  //    pessoa via um mês de movimento sob a palavra "Hoje".
  //
  // Quem resolve período agora é o servidor (`periodRequest`), que sem
  // parâmetro nenhum entende "today" — o mesmo padrão dos quatro dashboards.
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
