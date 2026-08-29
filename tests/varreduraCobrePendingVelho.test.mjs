import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 29/08/2026: 207 eventos do webhook do ML parados de 28/08 11:21 a 14:52 —
// TREZE HORAS — com attempts=0 e SEM erro. Nao estavam falhando: estavam sendo
// ignorados. A varredura cobria `processing` orfao e `error`, e deixava de fora
// justamente o estado em que o evento nasce.
//
// E ninguem percebeu porque a varredura periodica do sync ENCOBRIA a falha.

const fonte = () => readFile(new URL("../src/lib/integrations/mercadoLivreWebhook.ts", import.meta.url), "utf8");

test("a varredura cobre os TRES estados presos, nao dois", async () => {
  const src = await fonte();
  assert.match(src, /status = 'processing'/, "processing orfao");
  assert.match(src, /status = 'error'/, "error retryavel");
  assert.match(src, /status = 'pending'/, "pending velho — o que faltava e deixou 207 parados");
});

test("pending RECENTE nao e roubado — ele esta sendo processado agora", async () => {
  const src = await fonte();
  // Sem o teto de tempo, a varredura competiria com o proprio webhook.
  assert.match(src, /status = 'pending'\s*\n\s*AND received_at < now\(\) - interval/);
});

test("a rede de seguranca ANUNCIA quando salva — senao vira anestesia", async () => {
  const cron = await readFile(new URL("../src/app/api/cron/mercado-livre-sync/route.ts", import.meta.url), "utf8");
  assert.match(cron, /if \(eventosRetomados > 0\)/);
  assert.match(cron, /console\.warn/);
  // A frase precisa dizer que isso e SINTOMA, nao rotina.
  assert.match(cron, /push falhando e sendo encoberto/);
});

test("o motivo esta escrito no codigo, para nao ser removido por simplificacao", async () => {
  const src = await fonte();
  assert.match(src, /207 eventos parados/);
  assert.match(src, /Redundancia que mascara falha/i);
});
