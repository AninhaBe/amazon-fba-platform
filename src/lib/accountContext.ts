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

import { optionalWorkspaceId } from "./workspaceScope";

/**
 * Prefixo OBRIGATÓRIO de toda chave de cache que guarda dado de conta.
 *
 * Em 20/08/2026 as chaves eram só `transactions:${period}` — sem workspace nem
 * conta. Com duas contas Amazon no mesmo marketplace, trocar de conta servia os
 * números da anterior por até 10 minutos: a vendedora viu o faturamento do sócio
 * como se fosse o dela. Num NEXO multiusuário isso seria um usuário lendo dado
 * de outro.
 *
 * `currentAccountId()` foi criado exatamente "para namespacing de cache" e nunca
 * tinha sido usado pelas chaves.
 */
export function cacheScope(): string {
  return `${optionalWorkspaceId() ?? "no-ws"}:${currentAccountId()}`;
}
