import { readCache, writeCache } from "./persistentCache";
import { currentAccount, currentAccountId, runWithAccount } from "./accountContext";

// Stale-while-revalidate com persistência em disco e isolamento por conta.
// - fresco: devolve na hora
// - vencido: devolve o cache (stale) e atualiza em segundo plano
// - sem cache: aguarda (awaitIfEmpty) ou devolve o fallback e busca em background

const refreshing = new Set<string>(); // refreshes em background em andamento
const inflight = new Map<string, Promise<unknown>>(); // buscas síncronas (dedupe)

export async function swr<T>(
  baseKey: string,
  ttlMs: number,
  fn: () => Promise<T>,
  opts: { awaitIfEmpty?: boolean; fallback?: T } = {}
): Promise<T> {
  const key = `${baseKey}-${currentAccountId()}`;
  const cache = await readCache<T>(key);
  if (cache && Date.now() - cache.at < ttlMs) return cache.value;

  // Preserva o token da conta ao rodar (inclusive em background).
  const acct = currentAccount();
  const run = () => (acct ? runWithAccount(acct, fn) : fn());

  // Sem cache algum e queremos o dado correto já → busca síncrona (com dedupe).
  if (!cache && opts.awaitIfEmpty) {
    const existing = inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const p = run()
      .then(async (v) => {
        await writeCache(key, v);
        return v;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  // Tem cache vencido (ou não vamos esperar) → atualiza em background, devolve o que há.
  if (!refreshing.has(key)) {
    refreshing.add(key);
    Promise.resolve()
      .then(run)
      .then((v) => writeCache(key, v))
      .catch(() => {})
      .finally(() => refreshing.delete(key));
  }
  return cache ? cache.value : (opts.fallback as T);
}
