import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { diaEmBrasilia, janelaDeDias } from "../src/app/components/janelaDeDias.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

// O DEFEITO QUE ESTE ARQUIVO REPROVA — medido em 01/09/2026, DANO ATIVO em
// producao, nao risco latente.
//
// O modulo do TikTok convertia `days` em datas com `toISOString()`, que e UTC.
// Brasilia e UTC-3, entao das 21:00 as 23:59 o dia que saia dali era o de
// AMANHA. E a rota nao reinterpreta: `periodRequest` ancora o que recebe em
// -03:00 e usa como veio. Resultado medido as 22h BRT:
//
//   Hoje      cliente pedia 02/09..02/09   deveria ser 01/09..01/09
//   7 dias    cliente pedia 27/08..02/09   deveria ser 26/08..01/09
//
// Em "Hoje" a janela inteira caia no FUTURO e a tela vinha VAZIA; nas outras,
// perdia o dia mais antigo e incluia um dia que nao aconteceu. Tres horas por
// dia, e justo o fim do dia, quando ela fecha o caixa e confere contra o painel
// do canal.

// 2026-09-01, 22:00 em Brasilia = 2026-09-02T01:00Z. E o instante em que a
// conversao antiga errava.
const NOITE = new Date(Date.UTC(2026, 8, 2, 1, 0, 0));
const MANHA = new Date(Date.UTC(2026, 8, 1, 15, 0, 0)); // 12:00 BRT

test("as 22h de Brasilia, HOJE continua sendo hoje", () => {
  assert.equal(diaEmBrasilia(NOITE), "2026-09-01", "o dia virou antes da meia-noite de Brasilia");
  // A conversao antiga, verbatim, para deixar o contraste no proprio teste:
  assert.equal(NOITE.toISOString().slice(0, 10), "2026-09-02", "e ESTE era o valor que ia para a rota");

  const hoje = janelaDeDias("today", NOITE);
  assert.deepEqual(hoje, { from: "2026-09-01", to: "2026-09-01" }, "a janela de Hoje caiu no futuro de novo");
});

test("as janelas de 7, 15 e 30 nao perdem o dia mais antigo", () => {
  assert.deepEqual(janelaDeDias("7", NOITE), { from: "2026-08-26", to: "2026-09-01" });
  assert.deepEqual(janelaDeDias("15", NOITE), { from: "2026-08-18", to: "2026-09-01" });
  assert.deepEqual(janelaDeDias("30", NOITE), { from: "2026-08-03", to: "2026-09-01" });
});

test("de manha o resultado e o mesmo — o conserto nao troca um erro por outro", () => {
  assert.equal(diaEmBrasilia(MANHA), "2026-09-01");
  assert.deepEqual(janelaDeDias("today", MANHA), { from: "2026-09-01", to: "2026-09-01" });
  assert.deepEqual(janelaDeDias("7", MANHA), { from: "2026-08-26", to: "2026-09-01" });
});

test("a janela e por DIA-CALENDARIO, como periodFromDays — nao por 24h moveis", () => {
  // Mesma definicao de src/lib/period.ts: N=1 e so hoje. Duas definicoes
  // divergem, a questao e so quando.
  assert.deepEqual(janelaDeDias("1", MANHA), { from: "2026-09-01", to: "2026-09-01" });
  // E atravessar a virada do mes nao pode escorregar um dia.
  const primeiroDoMes = new Date(Date.UTC(2026, 8, 1, 15, 0, 0));
  assert.deepEqual(janelaDeDias("2", primeiroDoMes), { from: "2026-08-31", to: "2026-09-01" });
});

test("o TikTok nao converte data na mao em lugar nenhum", async () => {
  for (const arquivo of [
    "src/app/components/TikTokModulePage.tsx",
    "src/app/components/TikTokModulesModel.ts",
  ]) {
    const codigo = await fonte(arquivo);
    const semComentarios = codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(
      !/toISOString\(\)\.slice\(0, ?10\)/.test(semComentarios),
      `${arquivo}: voltou a tirar a data de um ISO em UTC`,
    );
    assert.ok(!/setDate\(/.test(semComentarios), `${arquivo}: voltou a calcular data na mao`);
    assert.match(codigo, /janelaDeDias\(/, `${arquivo}: precisa usar a janela compartilhada`);
  }
});

test("a expressao do dia de Brasilia mora num lugar so", async () => {
  // Era uma copia no filtro e outra, ERRADA, no modulo do TikTok. Duas copias
  // de uma regra de data e como a segunda fica para tras.
  const filtro = await fonte("src/app/components/DashboardPeriodFilter.tsx");
  assert.match(filtro, /const today = diaEmBrasilia\(\);/);
  assert.ok(
    !/new Intl\.DateTimeFormat\("en-CA"/.test(filtro),
    "o filtro voltou a ter a propria copia do dia de Brasilia",
  );
});
