import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// A8 (frente Dados-Urgente, 28/08/2026): 34 webhooks ML presos em 'processing'
// desde 21/07 — claim que morria no meio deixava o evento zumbi para sempre,
// porque o claim só aceitava pending/error e o ML não reenvia notificação
// antiga. Estes guardas prendem o mecanismo de retomada + desistência terminal.

test("claim reclama processing órfão (worker morto), nunca processing vivo", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/mercadoLivreWebhook.ts", import.meta.url), "utf8");
  const claim = fonte.slice(fonte.indexOf("export async function processMercadoLivreEvent"));
  assert.match(claim, /status = 'processing'\s*\n\s*AND \(processing_at IS NULL OR processing_at < now\(\) - interval/);
});

test("desistência é terminal com rastro: teto de tentativas, marcação [TERMINAL] e log", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/mercadoLivreWebhook.ts", import.meta.url), "utf8");
  assert.match(fonte, /MAX_EVENT_ATTEMPTS = 5/);
  assert.match(fonte, /row\.attempts > MAX_EVENT_ATTEMPTS/);
  assert.match(fonte, /\[TERMINAL\] desistido após/);
  assert.match(fonte, /console\.error\("\[webhook-ml\] evento desistido/);
});

test("a varredura exclui terminais, anda do mais antigo e roda em lote pequeno", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/mercadoLivreWebhook.ts", import.meta.url), "utf8");
  const sweeper = fonte.slice(
    fonte.indexOf("export async function retomarEventosPresosMercadoLivre"),
    fonte.indexOf("export async function processMercadoLivreEvent")
  );
  assert.match(sweeper, /NOT LIKE '\[TERMINAL\]%'/);
  assert.match(sweeper, /ORDER BY received_at/);
  assert.match(sweeper, /LIMIT \$3/);
});

test("o cron do ML chama a varredura como best-effort, sem derrubar a ingestão", async () => {
  const rota = await readFile(new URL("../src/app/api/cron/mercado-livre-sync/route.ts", import.meta.url), "utf8");
  assert.match(rota, /retomarEventosPresosMercadoLivre/);
  assert.match(rota, /eventosRetomados/);
  // A varredura vem DEPOIS do sync principal e dentro de try/catch próprio.
  const syncIdx = rota.indexOf("runScheduledMercadoLivreSync()");
  const sweepIdx = rota.indexOf("retomarEventosPresosMercadoLivre()");
  assert.ok(syncIdx > -1 && sweepIdx > syncIdx);
});

test("reprocessar é idempotente: as escritas do webhook são upserts por chave externa", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/mercadoLivreWebhook.ts", import.meta.url), "utf8");
  const conflicts = fonte.match(/ON CONFLICT \(workspace_id, provider, connection_id, external_/g) ?? [];
  assert.ok(conflicts.length >= 2, "pedido e remessa precisam continuar upserts idempotentes");
});
