import test from "node:test";
import assert from "node:assert/strict";

import { colunasDoPeriodoAmazon, colunaDeTaxas, margemDoPeriodoAmazon } from "../src/app/(app)/amazon/amazonPainelV3.ts";

/**
 * A faixa de 8 colunas da Amazon (aprovada pela dona do produto em 12/09/2026).
 *
 * ⚠️ TODO DADO AQUI E FABRICADO, dos dois lados de cada
 * fronteira. A conta dela tem tarifa estimada e aliquota cadastrada hoje; um
 * teste que so usasse o estado dela nunca exercitaria "sem estimativa" nem
 * "sem aliquota", que sao exatamente onde a faixa nasce errada em silencio.
 */

/**
 * ⚠️ O `Intl.NumberFormat` PT-BR usa ESPACO NAO-QUEBRAVEL (U+00A0)
 * entre "R$" e o numero. Comparar com o espaco comum reprova a tela CERTA — e
 * teste que fica vermelho por formatacao ensina a ignorar vermelho, que e tao
 * ruim quanto teste que nunca falha. Normalizar aqui e consertar a fragilidade,
 * nao o sintoma.
 */
const texto = (s) => String(s).replace(/ /g, " ");

const BASE = {
  moeda: "BRL",
  faturamento: 1000,
  pedidosPagos: 20,
  tarifas: 150,
  logisticaFba: 80,
  custoDosProdutos: 400,
  anuncio: 120,
  aliquota: 8.5,
  imposto: 85,
  lucro: 165,
  margemPct: 16.5,
};

test("a faixa tem OITO colunas, na ordem aprovada", () => {
  const colunas = colunasDoPeriodoAmazon(BASE);
  assert.deepEqual(colunas.map((c) => c.id),
    ["vendeu", "taxas", "logistica", "custo", "anuncio", "imposto", "lucro"],
    "a ordem ou a composicao da faixa mudou");
  // A oitava e a margem, que o PainelV3 desenha como coluna propria.
  assert.ok(margemDoPeriodoAmazon(BASE).valor.endsWith("%"));
});

test("TARIFA ESTIMADA E PARTE DO TOTAL — somar contaria duas vezes", () => {
  // ⚠️ A ARMADILHA MAIS CARA DESTA LEVA. O produtor calcula as
  // duas no MESMO `WHERE`: o total soma todas as linhas de tarifa e a estimada
  // e o subconjunto com `basis = 'estimated'`. Se a tela somasse, o custo
  // apareceria inflado e a margem espremida, sem nada ficar vermelho.
  const comEstimativa = colunaDeTaxas({ ...BASE, tarifas: 100, tarifasEstimadas: 30, pedidosComTarifaEstimada: 4 });
  assert.equal(texto(comEstimativa.valor), "R$ 100,00", "a estimativa foi SOMADA ao total das taxas");
  assert.match(texto(comEstimativa.share), /inclui R\$ 30,00 estimados em 4 pedido\(s\)/,
    "o rastro da estimativa sumiu da linha visivel");
  assert.match(texto(comEstimativa.dica), /substituida na liquidacao|substituída na liquidação/,
    "a dica parou de dizer que a estimativa e trocada na liquidacao");
});

test("sem estimativa, a linha volta a ser a porcentagem — e a dica nao fala de estimativa", () => {
  const semEstimativa = colunaDeTaxas({ ...BASE, tarifas: 150, tarifasEstimadas: 0 });
  assert.equal(texto(semEstimativa.valor), "R$ 150,00");
  assert.equal(texto(semEstimativa.share), "15% da venda");
  assert.ok(!/estimad/i.test(semEstimativa.share), "falou de estimativa onde nao ha nenhuma");
});

test("o FRETE DO COMPRADOR nao vira coluna nem custo — so dica", () => {
  const colunas = colunasDoPeriodoAmazon({ ...BASE, freteDoComprador: 40 });
  assert.ok(!colunas.some((c) => /comprador/i.test(c.rotulo)),
    "o frete do comprador virou coluna: ele nao sai do bolso dela");
  const taxas = colunas.find((c) => c.id === "taxas");
  assert.match(texto(taxas.dica), /comprador pagou R\$ 40,00/, "a dica parou de explicar o frete do comprador");
});

test("ANUNCIO tem coluna propria e diz que entra no lucro — a diferenca para o ML", () => {
  const colunas = colunasDoPeriodoAmazon(BASE);
  const anuncio = colunas.find((c) => c.id === "anuncio");
  assert.equal(texto(anuncio.valor), "R$ 120,00");
  assert.match(texto(anuncio.dica), /Entra no lucro/i,
    "a coluna parou de dizer que o anuncio entra no lucro — no ML ele NAO entra, e a diferenca e a razao da coluna existir");
});

test("anuncio DESCONHECIDO e travessao, nunca zero", () => {
  const colunas = colunasDoPeriodoAmazon({ ...BASE, anuncio: null });
  const anuncio = colunas.find((c) => c.id === "anuncio");
  assert.equal(anuncio.valor, "—", "gasto desconhecido virou R$ 0,00 — a tela passa a afirmar que ela nao anunciou");
  assert.equal(anuncio.tom, "vazio");
});

test("IMPOSTO segue a ADR-038 do canal, nao a regra do ML", () => {
  // Com aliquota: valor e rastro do percentual.
  const com = colunasDoPeriodoAmazon(BASE).find((c) => c.id === "imposto");
  assert.equal(texto(com.valor), "R$ 85,00");
  assert.equal(texto(com.share), "alíquota de 8,5%");
  // Sem aliquota: a CONTA usa zero (ADR-038) e a TELA diz que ninguem cadastrou.
  const sem = colunasDoPeriodoAmazon({ ...BASE, aliquota: null, imposto: null }).find((c) => c.id === "imposto");
  assert.equal(sem.valor, "—");
  assert.equal(sem.share, "alíquota não configurada",
    "o rastro da aliquota ausente sumiu — a tela afirma imposto sem dizer que ninguem o configurou");
});

test("a COR do lucro e estado: verde so no positivo, vermelho no prejuizo", () => {
  // ⚠️ O defeito que o ML teve ate 11/09/2026: `tom: "positivo"`
  // para qualquer lucro nao-nulo, e mes negativo saia VERDE.
  const lucro = (v) => colunasDoPeriodoAmazon({ ...BASE, lucro: v }).find((c) => c.id === "lucro").tom;
  assert.equal(lucro(165), "positivo");
  assert.equal(lucro(-42), "negativo", "prejuizo saiu verde");
  assert.equal(lucro(null), "vazio");
});

test("a MARGEM nunca aparece sozinha", () => {
  const comFalta = margemDoPeriodoAmazon({ ...BASE, faltas: ["26 unidade(s) sem custo", "tarifa de 3 pedidos"] });
  assert.equal(comFalta.nota, "falta 26 unidade(s) sem custo, tarifa de 3 pedidos");
  const comBase = margemDoPeriodoAmazon({ ...BASE, baseDoResultado: "sobre R$ 748,56 apurados" });
  assert.equal(texto(comBase.nota), "sobre R$ 748,56 apurados");
  const semNada = margemDoPeriodoAmazon(BASE);
  assert.equal(typeof semNada.nota, "string", "a nota da margem virou undefined e some da tela");
});

test("as colunas da Amazon levam o valor BRUTO — sem ele o numero nao rola", () => {
  // ⚠️ ORDEM DELA (12/09/2026): manter o efeito de troca de
  // numero. A peca so anima o que recebe cru; coluna que manda so texto pronto
  // perde o efeito em silencio, que foi o que aconteceu no v3 do ML.
  const colunas = colunasDoPeriodoAmazon(BASE);
  for (const id of ["vendeu", "taxas", "logistica", "custo", "anuncio", "imposto", "lucro"]) {
    const c = colunas.find((x) => x.id === id);
    assert.equal(typeof c.formatar, "function", `a coluna ${id} ficou sem formatador`);
    assert.equal(typeof c.bruto, "number", `a coluna ${id} parou de mandar o valor bruto`);
  }
  // E o desconhecido continua SEM efeito: contar do zero pareceria "caiu a zero".
  const semAnuncio = colunasDoPeriodoAmazon({ ...BASE, anuncio: null }).find((c) => c.id === "anuncio");
  assert.equal(semAnuncio.bruto, null, "travessao ganhou contagem: ausencia viraria queda na tela");
});
