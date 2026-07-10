import { AsyncLocalStorage } from "async_hooks";

// Contexto da conta ativa por requisição. Evita ter que passar o token por todas
// as funções: o handler define a conta uma vez e spapi/cache leem daqui.

export interface AccountCtx {
  sellerId: string; // "default" = conta dona (token do .env)
  refreshToken: string;
}

const als = new AsyncLocalStorage<AccountCtx>();

export function runWithAccount<T>(ctx: AccountCtx, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}

export function currentAccount(): AccountCtx | undefined {
  return als.getStore();
}

/** Id da conta ativa (para namespacing de cache). "default" quando fora de contexto. */
export function currentAccountId(): string {
  return als.getStore()?.sellerId ?? "default";
}

/** Refresh token da conta ativa; undefined cai para o token do .env. */
export function currentRefreshToken(): string | undefined {
  return als.getStore()?.refreshToken;
}
