import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CICLO_ESPERADO_MIN,
  FATOR_DE_ALERTA,
  formatarDefasagem,
  piorSaturacao,
  saturacaoDoSync,
} from "../src/lib/saturacaoDoSync.ts";

// Monitor Unificado, E0 (28/08/2026): "Sincronizado há X min" nos quatro
// monitores, com alerta quando a defasagem passa de 3× o ciclo do canal.

const MIN = 60_000;
const now = 1_700_000_000_000;
const ha = (minutos) => new Date(now - minutos * MIN).toISOString();

// ⚠️ TESTE QUE TRAVA A REGRA (exigência explícita do plano aprovado): conta em
// primeira sincronização NUNCA dispara alarme — nem afirma "sincronizado".
test("primeira sincronização é silêncio obrigatório — sem alarme falso em conta recém-conectada", () => {
  // Recém-conectada: nada preenchido ainda.
  assert.deepEqual(
    saturacaoDoSync({ coveredFrom: null, lastSuccessAt: null, cicloEsperadoMin: 2, agoraMs: now }),
    { estado: "silencio" }
  );
  // Kick disparou mas o primeiro ciclo ainda não fechou: covered_from vazio.
  assert.deepEqual(
    saturacaoDoSync({ coveredFrom: null, lastSuccessAt: ha(500), cicloEsperadoMin: 2, agoraMs: now }),
    { estado: "silencio" }
  );
  // Cobertura marcada sem sucesso registrado: afirmar sincronismo seria inventar.
  assert.deepEqual(
    saturacaoDoSync({ coveredFrom: ha(0), lastSuccessAt: null, cicloEsperadoMin: 2, agoraMs: now }),
    { estado: "silencio" }
  );
  // Timestamp corrompido não vira alarme.
  assert.deepEqual(
    saturacaoDoSync({ coveredFrom: ha(0), lastSuccessAt: "não-é-data", cicloEsperadoMin: 2, agoraMs: now }),
    { estado: "silencio" }
  );
});

test("dentro de 3× o ciclo é sincronizado; além disso é atrasado, com o ciclo no resultado", () => {
  const base = { coveredFrom: ha(60 * 24), cicloEsperadoMin: 2, agoraMs: now };
  // 6 min = exatamente 3× o ciclo de 2 min: ainda não é notícia.
  assert.deepEqual(saturacaoDoSync({ ...base, lastSuccessAt: ha(6) }), {
    estado: "sincronizado",
    minutosAtras: 6,
    cicloEsperadoMin: 2,
  });
  assert.deepEqual(saturacaoDoSync({ ...base, lastSuccessAt: ha(7) }), {
    estado: "atrasado",
    minutosAtras: 7,
    cicloEsperadoMin: 2,
  });
  // Canal de ciclo longo não alarma no ritmo do canal curto.
  assert.equal(
    saturacaoDoSync({ ...base, cicloEsperadoMin: 10, lastSuccessAt: ha(25) }).estado,
    "sincronizado"
  );
  // Relógio do cliente atrás do servidor não vira defasagem negativa.
  assert.equal(saturacaoDoSync({ ...base, lastSuccessAt: ha(-3) }).minutosAtras, 0);
});

test("os quatro canais têm ciclo esperado e o fator de alerta é 3", () => {
  assert.deepEqual(Object.keys(CICLO_ESPERADO_MIN).sort(), ["amazon", "mercado_livre", "shopee", "tiktok_shop"]);
  for (const ciclo of Object.values(CICLO_ESPERADO_MIN)) assert.ok(ciclo > 0);
  assert.equal(FATOR_DE_ALERTA, 3);
});

test("com várias conexões a tela mostra a pior: atrasado > sincronizado, mais defasado primeiro", () => {
  const sync5 = { estado: "sincronizado", minutosAtras: 5, cicloEsperadoMin: 2 };
  const sync1 = { estado: "sincronizado", minutosAtras: 1, cicloEsperadoMin: 2 };
  const atras30 = { estado: "atrasado", minutosAtras: 30, cicloEsperadoMin: 2 };
  const atras90 = { estado: "atrasado", minutosAtras: 90, cicloEsperadoMin: 2 };
  assert.deepEqual(piorSaturacao([sync1, atras30, sync5]), atras30);
  assert.deepEqual(piorSaturacao([atras30, atras90]), atras90);
  assert.deepEqual(piorSaturacao([sync1, sync5]), sync5);
  // Conexão nova no meio não silencia nem alarma as demais.
  assert.deepEqual(piorSaturacao([{ estado: "silencio" }, sync5]), sync5);
  assert.deepEqual(piorSaturacao([{ estado: "silencio" }]), { estado: "silencio" });
  assert.deepEqual(piorSaturacao([]), { estado: "silencio" });
});

test("defasagem legível: minutos até 2 h, horas depois — sem falsa precisão", () => {
  assert.equal(formatarDefasagem(0), "menos de 1 min");
  assert.equal(formatarDefasagem(7), "7 min");
  assert.equal(formatarDefasagem(119), "119 min");
  assert.equal(formatarDefasagem(120), "2 h");
  assert.equal(formatarDefasagem(750), "12 h");
});

test("o componente é silencioso em silêncio e o alerta diz o ciclo esperado", async () => {
  const fonte = await readFile(new URL("../src/app/components/EstadoDoSync.tsx", import.meta.url), "utf8");
  assert.match(fonte, /estado\.estado === "silencio"\) return null/, "silêncio tem que render nada");
  assert.match(fonte, /ciclo esperado/, "o texto do alerta carrega o ciclo esperado do canal");
  assert.match(fonte, /Sincronizado há/);
  // Falha da rota nunca derruba o monitor: o fetch tem catch.
  assert.match(fonte, /\.catch\(/);
});

test("os quatro monitores renderizam o estado do sync (Shopee/TikTok só na aba monitor)", async () => {
  const monitores = [
    ["../src/app/monitor/page.tsx", /<EstadoDoSync provider="amazon" \/>/],
    ["../src/app/components/MercadoLivreWorkspace.tsx", /<EstadoDoSync provider="mercado_livre" \/>/],
    // E3 (28/08/2026): o monitor virou componente próprio (ShopeeMonitorContent),
    // que só renderiza para kind=monitor — o gate mudou de forma, não de fato.
    ["../src/app/components/ShopeeModulePage.tsx", /<EstadoDoSync provider="shopee" connectionId=\{connectionId\}\/>/],
    // E2 (28/08/2026): o monitor virou componente próprio (MonitorContent),
    // que só renderiza para kind=monitor — o gate mudou de forma, não de fato.
    ["../src/app/components/TikTokModulePage.tsx", /<EstadoDoSync provider="tiktok_shop"/],
  ];
  for (const [arquivo, padrao] of monitores) {
    const fonte = await readFile(new URL(arquivo, import.meta.url), "utf8");
    assert.match(fonte, padrao, `${arquivo} precisa da linha de estado do sync`);
  }
});

test("a rota de estado é escopada por workspace e só aceita canal conhecido", async () => {
  const rota = await readFile(new URL("../src/app/api/sync-estado/route.ts", import.meta.url), "utf8");
  assert.match(rota, /withAuthenticatedWorkspace/);
  assert.match(rota, /workspace_id = \$1/, "a query TEM que filtrar por workspace — cache sem escopo já vazou dado uma vez");
  assert.match(rota, /currentWorkspaceId\(\)/);
  assert.match(rota, /provider in CICLO_ESPERADO_MIN/, "allowlist de canal, não string livre");
  // Só metadado de sync sai daqui — nenhum número de negócio.
  assert.doesNotMatch(rota, /revenue|gross|profit/i);
});
