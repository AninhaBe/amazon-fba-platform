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
  opts: { awaitIfEmpty?: boolean; fallback?: T; awaitIfStaleMs?: number } = {}
): Promise<T> {
  const key = `${baseKey}-${currentAccountId()}`;
  const cache = await readCache<T>(key);
  if (cache && Date.now() - cache.at < ttlMs) return cache.value;

  // Preserva o token da conta ao rodar (inclusive em background).
  const acct = currentAccount();
  const run = () => (acct ? runWithAccount(acct, fn) : fn());

  // Cache VENCIDO e o chamador não aceita dado velho (número que precisa bater
  // com a origem agora, como o faturamento do dia): espera a revalidação até um
  // teto e só cai no stale se a origem demorar demais.
  //
  // Sem isto, servir stale mostrava o número de ANTES da venda: medido em
  // 22/08/2026 — venda às 17:32 no Seller Central, tela do NEXO ainda em R$ 0,00
  // porque o cache das 17:00 foi entregue e a atualização foi para segundo plano.
  // O teto preserva o orçamento de resposta do ADR-017: origem lenta não trava a tela.
  if (cache && opts.awaitIfStaleMs) {
    const emCurso = inflight.get(key) as Promise<T> | undefined;
    const p =
      emCurso ??
      run()
        .then(async (v) => {
          await writeCache(key, v);
          return v;
        })
        .finally(() => inflight.delete(key));
    if (!emCurso) inflight.set(key, p);
    return Promise.race([
      p.catch(() => cache.value),
      new Promise<T>((resolve) => setTimeout(() => resolve(cache.value), opts.awaitIfStaleMs)),
    ]);
  }

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
