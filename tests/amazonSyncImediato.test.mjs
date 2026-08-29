import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { nextAmazonOrderWindow } from "../src/lib/integrations/amazonSyncControl.ts";

const DAY = 86_400_000;
const now = 1_700_000_000_000;

// Frente K (27/08/2026): conectar a conta dispara o sync na hora, com a janela
// recente primeiro. Mesmos guardas dos outros três canais (*SyncImediato).

test("janela de pedidos avança para trás até o alvo e conclui ao alcançá-lo", () => {
  const move = nextAmazonOrderWindow({
    windowFromMs: now - 7 * DAY,
    targetFromMs: now - 27 * DAY,
    windowMs: 7 * DAY,
  });
  assert.deepEqual(move, { kind: "advance", nextToMs: now - 7 * DAY, nextFromMs: now - 14 * DAY });
  assert.deepEqual(
    nextAmazonOrderWindow({ windowFromMs: now - 27 * DAY, targetFromMs: now - 27 * DAY, windowMs: 7 * DAY }),
    { kind: "complete" }
  );
});

test("reabertura incremental (alvo estreitado pelo covered_to) fecha em complete sem redisparar backfill", () => {
  const move = nextAmazonOrderWindow({
    windowFromMs: now - 2 * 60_000,
    targetFromMs: now - 2 * 60_000,
    windowMs: 7 * DAY,
  });
  assert.deepEqual(move, { kind: "complete" });
});

test("callback da Amazon cria a linha de estado e dispara o sync fora do redirect", async () => {
  const callback = await readFile(new URL("../src/app/api/auth/callback/route.ts", import.meta.url), "utf8");
  const saveIdx = callback.indexOf("await saveAccount(");
  const ensureIdx = callback.indexOf("ensureAmazonSyncState(amazonConnectionId(sellerId))");
  const kickIdx = callback.indexOf("depoisDaResposta(");
  const redirectIdx = callback.indexOf("NextResponse.redirect(`${baseUrl}/?connected=1`)");
  assert.ok(saveIdx > -1 && ensureIdx > -1 && kickIdx > -1 && redirectIdx > -1);
  assert.ok(saveIdx < ensureIdx && ensureIdx < kickIdx && kickIdx < redirectIdx,
    "linha de estado nasce depois do save, kick depois dela, e nada segura o redirect");
  assert.match(callback, /runAmazonSyncBatch\(account, KICK_MAX_STEPS\)/);
});

test("scheduler prioriza conta que nunca fechou uma janela e mantém o LEFT JOIN do filtro demo", async () => {
  const scheduler = await readFile(new URL("../src/lib/integrations/amazonScheduler.ts", import.meta.url), "utf8");
  assert.match(scheduler, /WHEN sync\.covered_from IS NULL THEN 0/);
  // Conexão Amazon real não tem linha em workspace_integrations: um JOIN
  // interno pararia o sync das contas vivas em silêncio (medido em 27/08/2026).
  assert.match(scheduler, /LEFT JOIN workspace_integrations/);
});

test("checkpoints do sync são cercados pelo token do lease (fencing)", async () => {
  const sync = await readFile(new URL("../src/lib/integrations/amazonSync.ts", import.meta.url), "utf8");
  assert.match(sync, /lease_until::text AS ownership_token/);
  assert.match(sync, /AmazonLeaseLostError/);
  // Todo UPDATE de checkpoint dentro do passo carrega a cláusula do token —
  // inclusive o avanço por NextToken e o caminho de erro.
  const stepBody = sync.slice(sync.indexOf("export async function runAmazonSyncStep"));
  const guardas = stepBody.match(/AND lease_until::text = \$\d+/g) ?? [];
  assert.ok(guardas.length >= 5, `esperava >=5 cláusulas de fencing no passo, achei ${guardas.length}`);
  // A reabertura não é dona de lease: só mexe no cursor com a linha livre.
  const reopenBody = sync.slice(sync.indexOf("async function requestAmazonSync"), sync.indexOf("export async function runAmazonSyncStep"));
  assert.match(reopenBody, /lease_until IS NULL OR lease_until < now\(\)/);
});

test("seed de conta nova é o mês vigente e conta antiga não é reaberta pela regra", async () => {
  const sync = await readFile(new URL("../src/lib/integrations/amazonSync.ts", import.meta.url), "utf8");
  assert.match(sync, /inicioDoMesVigente\(now\)/);
  // Conexão existente segue com o alvo já gravado: o seed só insere quando a
  // linha não existe.
  assert.match(sync, /ON CONFLICT \(workspace_id, provider, connection_id\) DO NOTHING/);
  assert.doesNotMatch(sync, /AMAZON_HISTORY_DAYS/, "o knob de fase 2 foi descartado (decisão da Ana, 27/08/2026)");
});
