import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ⚠️ A SEGUNDA FORMA DA FAMILIA, achada pela vendedora em 01/09/2026 no Shopee.
//
// Ela somou os tres cards da tela — Faturamento R$ 15.734,08 menos Taxas
// R$ 4.306,24 menos Custo R$ 7.020,48 = R$ 4.407,36 — e o Lucro exibido era
// R$ 4.266,39. A diferenca de R$ 140,97 era o IMPOSTO, que nao tem card.
//
// E ao conferir a diferenca apareceu o defeito de verdade: o imposto incidia
// sobre `processedRevenue` (pagos + enviados, R$ 14.097,09) enquanto o lucro
// partia do FATURAMENTO (com os pendentes, R$ 15.734,08). Subestimado em
// ~R$ 16,37 — numerador de um universo, subtracao de outro.
//
// 📌 CHEGOU POR REPLICACAO INCOMPLETA, e essa e a licao: quando a base do lucro
// passou a ser o faturamento, o numerador se moveu e o imposto ficou para tras.
// Mover uma base exige mover TODO componente que incide sobre ela.
//
// 📌 E A VARREDURA REVERSA ACHOU O SEGUNDO CANAL: o Mercado Livre tinha o mesmo
// defeito, pelo mesmo motivo, e ninguem tinha reclamado dele. Amazon corrigida
// em 31/08; Shopee e ML aqui; TikTok ja estava correto (imposto e lucro leem o
// mesmo `revenue`). Os quatro canais conferidos antes de dar a familia por
// encerrada.

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentario = (texto) =>
  texto
    .split("\n")
    .map((l) => l.replace(/\r$/, "").replace(/\s*\/\/.*$/, "").replace(/\s*--.*$/, ""))
    .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
    .join("\n");

/** A variavel de que a formula do lucro parte, e a de que o imposto parte. */
async function basesDe(caminho, ancoraDoLucro) {
  const codigo = semComentario(await fonte(caminho));
  const imposto = /const tax(?:es)? = [^;]*?([A-Za-z_][A-Za-z0-9_.]*) \* tax_?[Rr]ate/.exec(codigo);
  const lucro = new RegExp(`const ${ancoraDoLucro} = [^;]*`).exec(codigo);
  assert.ok(imposto, `${caminho}: nao achei o calculo do imposto — reancore esta guarda`);
  assert.ok(lucro, `${caminho}: nao achei a formula do lucro — reancore esta guarda`);
  return { baseDoImposto: imposto[1], formulaDoLucro: lucro[0] };
}

test("SHOPEE: o imposto incide sobre a mesma base do lucro", async () => {
  const { baseDoImposto, formulaDoLucro } = await basesDe(
    "src/lib/integrations/shopeeOverviewCanonical.ts", "estimatedProfit");
  assert.equal(baseDoImposto, "faturamento");
  assert.match(formulaDoLucro, /faturamento -/,
    "o lucro tem de partir da mesma variavel que o imposto");
  assert.notEqual(baseDoImposto, "processedRevenue",
    "processedRevenue nao inclui o pendente; o faturamento inclui");
});

test("MERCADO LIVRE: idem — achado pela varredura, sem ninguem reclamar", async () => {
  const { baseDoImposto, formulaDoLucro } = await basesDe(
    "src/lib/integrations/mercadoLivreOverviewCanonical.ts", "estimatedProfit");
  assert.equal(baseDoImposto, "faturamentoDoLucro");
  assert.match(formulaDoLucro, /faturamentoDoLucro -/);
});

test("TIKTOK: ja estava correto — imposto e lucro leem o mesmo revenue", async () => {
  const codigo = semComentario(await fonte("src/lib/integrations/tiktokFinancialV2.ts"));
  assert.match(codigo, /const tax = taxKnown \? \+\(revenue! \* input\.taxRate! \/ 100\)/);
  assert.match(codigo, /const profit = complete \? \+\(revenue! -/,
    "o lucro parte do mesmo revenue do imposto");
});

test("nenhum canal calcula imposto sobre processedRevenue", async () => {
  // ⚠️ A guarda que vale para o futuro: `processedRevenue` continua existindo e
  // sendo util (e a receita ja conciliada), mas nao pode voltar a ser base de
  // imposto em canal nenhum enquanto o lucro partir do faturamento.
  for (const caminho of [
    "src/lib/integrations/shopeeOverviewCanonical.ts",
    "src/lib/integrations/mercadoLivreOverviewCanonical.ts",
    "src/lib/integrations/amazonOverviewCanonical.ts",
  ]) {
    const codigo = semComentario(await fonte(caminho));
    assert.doesNotMatch(codigo, /processedRevenue \* tax/i, `${caminho}: imposto sobre a base errada`);
    assert.doesNotMatch(codigo, /amazonTaxAmount\(processedRevenue/, `${caminho}: idem`);
  }
});

test("a AMAZON continua com imposto sobre a base do lucro (corrigido em 31/08)", async () => {
  const codigo = semComentario(await fonte("src/lib/integrations/amazonOverviewCanonical.ts"));
  assert.match(codigo, /amazonTaxAmount\(receitaDoLucro, taxRate\)/,
    "o imposto da Amazon parte da base do lucro, nao da receita apurada");
});
