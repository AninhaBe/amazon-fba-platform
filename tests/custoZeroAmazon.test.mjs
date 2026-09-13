import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { custoNaDataOuNull } = await import("../src/lib/costStore.ts");

const entradaZero = {
  id: "SKU-ZERO",
  sku: "SKU-ZERO",
  cost: 0,
  updatedAt: "2026-01-01T00:00:00.000Z",
  history: [{ cost: 0, from: "2026-01-01T00:00:00.000Z" }],
};

test("custo Amazon cadastrado como zero continua conhecido", () => {
  assert.equal(custoNaDataOuNull(entradaZero, "2026-09-12T12:00:00.000Z"), 0);
  assert.equal(custoNaDataOuNull(undefined, "2026-09-12T12:00:00.000Z"), null);
});

test("os produtores Amazon distinguem cadastro ausente de custo zero", async () => {
  // Defeito real reprovado: custo cadastrado como 0 virava null e fazia a venda,
  // o painel e a curva ABC afirmarem que faltava cadastrar custo.
  const arquivos = [
    "../src/lib/amazonProfitability.ts",
    "../src/lib/integrations/amazonAbc.ts",
    "../src/lib/integrations/amazonOverviewCanonical.ts",
  ];
  for (const arquivo of arquivos) {
    const fonte = await readFile(new URL(arquivo, import.meta.url), "utf8");
    const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/cost(?:Entry)?\s*&&\s*cost(?:Entry)?\.cost\s*>\s*0/.test(codigo), `${arquivo}: custo zero voltou a significar ausência`);
    assert.ok(!/unitCost\s*>\s*0/.test(codigo), `${arquivo}: o valor, e não a presença do cadastro, voltou a decidir se o custo é conhecido`);
    assert.match(codigo, /custoNaDataOuNull\(/, `${arquivo}: o produtor deixou de preservar null e zero na mesma fronteira`);
  }
});
