import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { sementeDaContagem, identidadeDePeriodo } from "../src/app/components/efeitoDeNumero.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

/**
 * O EFEITO DE TROCA DE NUMERO — ordem da dona do produto em 12/09/2026:
 * *"importante, manter o efeito de troca de numero que tinha na versao
 * anterior"*.
 *
 * ⚠️ ESTE TESTE EXERCITA A TROCA DE VALOR, e nao o nome de uma
 * classe de CSS. Casar `AnimatedNumber` no fonte provaria que o componente esta
 * escrito, nunca que o numero ROLA — e foi justamente assim que o efeito se
 * perdeu no v3 sem nada ficar vermelho: o componente continuou no repositorio,
 * so parou de ser chamado pela faixa.
 */

test("mesmo periodo, valor novo: a contagem parte do numero ANTERIOR", () => {
  // E o efeito em si. Sem isto o numero troca de uma vez, que e o que ela viu
  // sumir.
  const lembrado = { valor: 325.91, periodo: "2026-09-01|2026-09-12" };
  assert.equal(sementeDaContagem(lembrado, "2026-09-01|2026-09-12", 412.5), 325.91);
});

test("periodo diferente: a contagem parte do ZERO, nunca do numero alheio", () => {
  // ⚠️ O defeito medido em 28/08/2026: R$ 325,91 de "hoje"
  // embaixo do rotulo "7 dias". Zero nao se confunde com total de recorte
  // nenhum, e o movimento diz sozinho que e animacao, nao afirmacao.
  const lembrado = { valor: 325.91, periodo: "2026-09-01|2026-09-12" };
  assert.equal(sementeDaContagem(lembrado, "2026-09-05|2026-09-12", 88.4), 0);
});

test("estreia: entra no valor real, sem contar", () => {
  assert.equal(sementeDaContagem(undefined, "2026-09-01|2026-09-12", 1000), 1000);
});

test("sem periodo declarado, nao herda numero de recorte nenhum", () => {
  const lembrado = { valor: 325.91, periodo: "2026-09-01|2026-09-12" };
  assert.equal(sementeDaContagem(lembrado, undefined, 77), 77);
});

test("a identidade do recorte ignora a hora — duas respostas do MESMO recorte nao sao troca", () => {
  // Cache e revalidacao chegam com `to` diferente no milissegundo; sem cortar
  // no dia, o componente leria isso como periodo novo e reiniciaria do zero.
  const a = identidadeDePeriodo("2026-09-01", "2026-09-12T22:24:40.014Z");
  const b = identidadeDePeriodo("2026-09-01", "2026-09-12T22:24:41.902Z");
  assert.equal(a, b);
});

test("a FAIXA COMPARTILHADA liga o efeito — e so quando ha numero para rolar", async () => {
  const faixa = await fonte("src/app/components/FaixaDoPeriodoV3.tsx");
  const codigo = faixa.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  // A chamada de render inteira: casar so "AnimatedNumber" deixaria passar um
  // import esquecido com a chamada apagada — que e exatamente como o efeito se
  // perdeu da primeira vez.
  assert.ok(
    codigo.includes("{c.bruto != null && c.formatar ? ("),
    "a faixa parou de condicionar o efeito a existir numero — travessao nao rola",
  );
  assert.ok(
    codigo.includes("<AnimatedNumber id={`faixa-${c.id}`} periodo={identidadeDoPeriodo} value={c.bruto} format={c.formatar} />"),
    "a faixa parou de desenhar o efeito de troca de numero",
  );
});

test("o ML voltou a mandar o valor bruto — o canal que perdeu o efeito e o primeiro a prova-lo", async () => {
  const ml = await fonte("src/app/components/MercadoLivreWorkspace.tsx");
  const codigo = ml.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const campo of [
    "bruto: overview.metrics.revenue30d",
    "bruto: overview.profit.fees",
    "bruto: overview.profit.cogs",
    "bruto: overview.profit.estimatedProfit",
  ]) {
    assert.ok(codigo.includes(campo), `a coluna perdeu o valor bruto: ${campo}`);
  }
  assert.ok(codigo.includes("identidadeDoPeriodo: identidadePeriodo") || codigo.includes("identidadeDoPeriodo: identidadeDePeriodo("),
    "a faixa do ML ficou sem identidade de recorte: a troca de periodo voltaria a contar a partir do numero do periodo anterior");
});
