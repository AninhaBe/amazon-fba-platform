import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { avaliarAnuncio, contarAlertas } from "../src/lib/anuncioContraMargem.ts";

// Frente de Ads (pedido da Ana: "quero ver ACOS, TACOS e afins, direto dos
// canais"). Esta é a peça que vira DECISÃO: ACOS da fonte contra a margem real
// que só o NEXO tem.

test("ZERO DA FONTE NÃO É ZERO: gasto sem venda não pode virar 'ACOS 0%'", () => {
  // O caso medido pelo Delta na sonda do PADS: R$ 0,52 gastos, 1 clique,
  // nenhuma venda — e o ML devolveu acos = 0.
  const v = avaliarAnuncio({ cost: 0.52, sales: 0, purchases: 0, acos: 0, margemRealPct: 30 });
  assert.equal(v.situacao, "gasto-sem-venda");
  assert.match(v.frase, /não teve venda atribuída/);
  assert.match(v.frase, /R\$/, "a frase diz quanto saiu do bolso");
  assert.equal(v.acao, "Revise o anúncio ou pause a campanha");
  // O que NÃO pode acontecer: ler como desempenho excelente.
  assert.doesNotMatch(v.frase, /ACOS de 0/);
  assert.notEqual(v.situacao, "lucra");
});

test("sem gasto e sem venda é ausência de atividade, não alarme", () => {
  const v = avaliarAnuncio({ cost: 0, sales: 0, purchases: 0, acos: null, margemRealPct: 25 });
  assert.equal(v.situacao, "sem-atividade");
  assert.equal(v.acao, null);
});

test("o veredito que justifica a frente: ACOS acima da margem = paga para vender", () => {
  const v = avaliarAnuncio({ cost: 18, sales: 100, purchases: 3, acos: 18, margemRealPct: 14 });
  assert.equal(v.situacao, "paga-para-vender");
  assert.equal(v.frase, "ACOS de 18% num produto de margem 14% — você paga para vender");
  assert.equal(v.acao, "Reduza o lance ou ajuste o preço");
  // Empate também é prejuízo: o anúncio come a margem inteira.
  assert.equal(avaliarAnuncio({ cost: 14, sales: 100, purchases: 2, acos: 14, margemRealPct: 14 }).situacao, "paga-para-vender");
});

test("ACOS abaixo da margem lucra — e a frase diz os dois números", () => {
  const v = avaliarAnuncio({ cost: 8, sales: 100, purchases: 4, acos: 8, margemRealPct: 22 });
  assert.equal(v.situacao, "lucra");
  assert.match(v.frase, /8%/);
  assert.match(v.frase, /22%/);
  assert.equal(v.acao, null);
});

test("sem margem real NÃO há veredito — vira pendência de cadastro, nunca palpite", () => {
  const v = avaliarAnuncio({ cost: 30, sales: 200, purchases: 5, acos: 15, margemRealPct: null });
  assert.equal(v.situacao, "margem-desconhecida");
  assert.equal(v.acao, "Cadastre o custo deste produto");
  assert.doesNotMatch(v.frase, /paga para vender|cabe na margem/);
  // E sem ACOS da fonte também não inventamos: não recalculamos por conta própria.
  const semAcos = avaliarAnuncio({ cost: 30, sales: 200, purchases: 5, acos: null, margemRealPct: 20 });
  assert.equal(semAcos.situacao, "margem-desconhecida");
  assert.match(semAcos.frase, /o canal não informou o ACOS/);
});

test("a ordem das perguntas protege o pior caso de sumir atrás de uma pendência", () => {
  // Gastou, não vendeu E não tem custo cadastrado: tem que continuar sendo
  // "gasto sem venda", não "cadastre o custo".
  const v = avaliarAnuncio({ cost: 40, sales: 0, purchases: 0, acos: 0, margemRealPct: null });
  assert.equal(v.situacao, "gasto-sem-venda");
});

test("a contagem para a chamada do briefing separa os dois alertas", () => {
  const linhas = [
    { cost: 10, sales: 0, purchases: 0, acos: 0, margemRealPct: 20 },
    { cost: 20, sales: 100, purchases: 2, acos: 20, margemRealPct: 15 },
    { cost: 5, sales: 90, purchases: 3, acos: 5, margemRealPct: 30 },
    { cost: 0, sales: 0, purchases: 0, acos: null, margemRealPct: 10 },
  ];
  assert.deepEqual(contarAlertas(linhas), { pagaParaVender: 1, gastoSemVenda: 1 });
});

test("o módulo NÃO recalcula ACOS — a métrica é da fonte, por decisão registrada", async () => {
  const fonte = await readFile(new URL("../src/lib/anuncioContraMargem.ts", import.meta.url), "utf8");
  // Nenhuma divisão de custo por venda: recalcular divergiria do painel do canal.
  assert.doesNotMatch(fonte, /cost\s*\/\s*sales/);
  assert.match(fonte, /NÃO recalcula/);
  assert.match(fonte, /janela de atribuição/);
});
