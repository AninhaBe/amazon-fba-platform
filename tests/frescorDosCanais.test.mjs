import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Frescor do sync: os DOIS portões de cada canal precisam concordar.
//
// Cada canal tem dois filtros em série — o scheduler decide SE a conexão entra
// no lote, o `FRESH_FOR_MS` do sync decide SE a janela abre. Quando divergem,
// vale o mais lento, e o valor curto do outro arquivo não serve para nada.
//
// Foi assim que o Mercado Livre ficou com 8h42 de defasagem no painel enquanto
// a Amazon estava com 3 minutos (23/08/2026). A Amazon tinha baixado de 6h para
// 2min em 21/08 (ADR-023) e ninguém replicou. A Shopee estava pior: scheduler em
// 6 horas contra `FRESH_FOR_MS` de 10 minutos, em desacordo consigo mesma.
//
// Este teste é a trava. Ele lê os arquivos porque o objetivo é comparar o que
// está ESCRITO nos dois lugares — importar os módulos esconderia justamente a
// divergência que interessa.

const ler = (caminho) => fs.readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

/** `FRESH_FOR_MS = 2 * 60_000` → 120000 */
function frescorEmMs(arquivo) {
  const m = ler(arquivo).match(/FRESH_FOR_MS\s*=\s*([^;]+);/);
  assert.ok(m, `FRESH_FOR_MS não encontrado em ${arquivo}`);
  const valor = Function(`"use strict"; return (${m[1].replaceAll("_", "")});`)();
  assert.ok(Number.isFinite(valor), `FRESH_FOR_MS ilegível em ${arquivo}`);
  return valor;
}

/** `now() - interval '2 minutes'` → 120000 */
function intervaloDoSchedulerEmMs(arquivo) {
  const texto = ler(arquivo);
  const m = texto.match(/last_success_at[\s\S]{0,80}?interval '(\d+)\s+(minute|minutes|hour|hours)'/);
  if (!m) return null; // canal que já usa o próprio FRESH_FOR_MS por parâmetro
  const unidade = m[2].startsWith("hour") ? 60 * 60_000 : 60_000;
  return Number(m[1]) * unidade;
}

const CANAIS = [
  { nome: "Amazon", sync: "src/lib/integrations/amazonSync.ts", scheduler: "src/lib/integrations/amazonScheduler.ts" },
  { nome: "Mercado Livre", sync: "src/lib/integrations/mercadoLivreSync.ts", scheduler: "src/lib/integrations/mercadoLivreScheduler.ts" },
  { nome: "Shopee", sync: "src/lib/integrations/shopeeSync.ts", scheduler: "src/lib/integrations/shopeeScheduler.ts" },
  { nome: "TikTok", sync: "src/lib/integrations/tiktokSync.ts", scheduler: "src/lib/integrations/tiktokScheduler.ts" },
];

const TETO_MS = 15 * 60_000;

for (const canal of CANAIS) {
  test(`${canal.nome}: os dois portões de frescor concordam`, () => {
    const doSync = frescorEmMs(canal.sync);
    const doScheduler = intervaloDoSchedulerEmMs(canal.scheduler);
    if (doScheduler === null) return; // amarrado por parâmetro: não pode divergir
    assert.equal(
      doScheduler,
      doSync,
      `${canal.nome}: scheduler usa ${doScheduler / 60_000}min e o sync usa ${doSync / 60_000}min. ` +
        "Vale o mais lento — alinhe os dois ou faça o scheduler consumir FRESH_FOR_MS."
    );
  });

  test(`${canal.nome}: frescor não passa de 15 minutos`, () => {
    assert.ok(
      frescorEmMs(canal.sync) <= TETO_MS,
      `${canal.nome}: ${frescorEmMs(canal.sync) / 60_000} minutos. O produto é vendido como tempo real; ` +
        "acima de 15 minutos a tela mostra dado velho sem a pessoa saber."
    );
  });
}
