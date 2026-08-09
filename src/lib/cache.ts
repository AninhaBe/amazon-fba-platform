// Cache em memória por conta ativa. Guarda a PROMISE — então várias rotas
// pedindo o mesmo dado ao mesmo tempo compartilham uma única chamada à SP-API
// (evita estourar o rate limit).
//
// TTL, despejo e teto de memória vivem em `memoryCache.ts`; aqui só entra o
// namespacing, que é o que impede a conta A de ver o cache da conta B.

import { currentAccountId } from "./accountContext";
import { optionalWorkspaceId } from "./workspaceScope";
import { cachedByKey } from "./memoryCache";

export { cacheSize, clearCache, MAX_ENTRIES } from "./memoryCache";

export function cached<T>(rawKey: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const key = `${optionalWorkspaceId() ?? "public"}|${currentAccountId()}|${rawKey}`;
  return cachedByKey(key, ttlMs, fn);
}
