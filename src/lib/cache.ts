// Cache simples em memória com TTL que também deduplica chamadas simultâneas.
// Guarda a PROMISE — então várias rotas pedindo o mesmo dado ao mesmo tempo
// compartilham uma única chamada à SP-API (evita estourar o rate limit).

interface Entry {
  at: number;
  value: Promise<unknown>;
}

const store = new Map<string, Entry>();

export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < ttlMs) {
    return hit.value as Promise<T>;
  }
  // Em caso de erro, não deixa a falha "grudada" no cache.
  const value = fn().catch((err) => {
    if (store.get(key)?.value === value) store.delete(key);
    throw err;
  });
  store.set(key, { at: now, value });
  return value as Promise<T>;
}
