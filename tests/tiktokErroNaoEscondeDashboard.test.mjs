import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Regra de produto (28/08/2026, a mesma validada na Shopee na regressão da
// UTILEIRA): erro de sync com overview cheio NÃO esconde o dashboard do TikTok
// — vira banner interno. Takeover de tela só quando não há dado nenhum.

test("erro transitório e reauth só tomam a tela SEM dado; com overview viram banner", async () => {
  const fonte = await readFile(new URL("../src/app/components/TikTokWorkspace.tsx", import.meta.url), "utf8");
  assert.match(fonte, /const temDado = Boolean\(data\.overview && data\.coverage\)/);
  assert.match(fonte, /syncPhase === "retryable_error" && !temDado\) return <SyncState/);
  assert.match(fonte, /syncPhase === "reauth_required" && !temDado\) return <SyncState/);
  // O banner interno cobre exatamente as duas fases que deixaram de engolir a tela.
  assert.match(fonte, /\(syncPhase === "retryable_error" \|\| syncPhase === "reauth_required"\) && \(\s*<AvisoDeSyncInterrompido/);
  // Primeira sincronização continua tomando a tela — sem dado não há dashboard.
  assert.match(fonte, /syncPhase === "first_sync"\) return <SyncState/);
});

test("o banner respeita o motivo: erro não-retryable não ganha botão de repetir", async () => {
  const fonte = await readFile(new URL("../src/app/components/TikTokWorkspace.tsx", import.meta.url), "utf8");
  assert.match(fonte, /detalhe\.retryable !== false && .*Tentar novamente/);
  // Reauth aponta a ação certa: reconectar, não repetir.
  assert.match(fonte, /Autorização da loja expirou/);
  assert.match(fonte, /Reconectar loja/);
});

test("o subtítulo do header não mente 'Sincronizando' durante erro", async () => {
  const fonte = await readFile(new URL("../src/app/components/TikTokWorkspace.tsx", import.meta.url), "utf8");
  assert.match(fonte, /"Sincronização interrompida"/);
});
