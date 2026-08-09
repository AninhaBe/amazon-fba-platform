// Cache em memória com TTL, dedupe de chamadas simultâneas e despejo.
//
// Sem imports de propósito: é a peça que decide o que fica e o que sai da
// memória do processo, e precisa ser testável sem subir contexto de conta.
// O namespacing por workspace/conta fica em `cache.ts`, que embrulha este.
//
// Por que o despejo existe: a chave carrega o parâmetro da consulta (termo
// pesquisado, período, página), então o número de chaves distintas cresce com o
// uso — não é limitado pelo número de telas. Um TTL que só ignora a entrada
// velha, sem removê-la, faz o processo acumular todo resultado já buscado até
// estourar a memória do container. Foi o que derrubou o serviço em 09/08/2026.

interface Entry {
  at: number;
  ttl: number;
  value: Promise<unknown>;
}

const store = new Map<string, Entry>();

/** Teto de entradas vivas. Passou disso, as mais antigas saem. */
export const MAX_ENTRIES = 300;

/**
 * Remove o que venceu e, se ainda estiver acima do teto, as entradas mais
 * antigas. Roda só quando o mapa encosta no limite — não a cada escrita.
 */
function evict(now: number): void {
  for (const [key, entry] of store) {
    if (now - entry.at >= entry.ttl) store.delete(key);
  }
  if (store.size < MAX_ENTRIES) return;

  const porIdade = [...store.entries()].sort((a, b) => a[1].at - b[1].at);
  const excedente = store.size - MAX_ENTRIES + 1; // +1 abre espaço para a nova
  for (const [key] of porIdade.slice(0, excedente)) store.delete(key);
}

export function cachedByKey<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < ttlMs) {
    return hit.value as Promise<T>;
  }
  if (hit) store.delete(key); // vencida: sai agora, não fica ocupando espaço

  if (store.size >= MAX_ENTRIES) evict(now);

  // Em caso de erro, não deixa a falha "grudada" no cache.
  const value = fn().catch((err) => {
    if (store.get(key)?.value === value) store.delete(key);
    throw err;
  });
  store.set(key, { at: now, ttl: ttlMs, value });
  return value as Promise<T>;
}

/** Quantas entradas estão vivas. Para teste e diagnóstico. */
export function cacheSize(): number {
  return store.size;
}

/** Esvazia o cache. Usado nos testes. */
export function clearCache(): void {
  store.clear();
}
