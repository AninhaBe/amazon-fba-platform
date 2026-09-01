import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeAmazonFinanceFees } from "../src/lib/integrations/amazonCanonical.ts";

// ⚠️ O DEFEITO QUE ESTES TESTES REPROVAM — medido em 01/09/2026, achado pelo
// Delta: 456 linhas com `fee_type = 'estimated'` em
// `workspace_channel_order_fees`, a tabela da tarifa REAL. A migration 0022
// tinha apagado 552 linhas iguais no mesmo dia.
//
// Por que isso e grave mesmo sem corromper numero hoje: a primeira ramificacao
// da view `workspace_channel_order_fees_efetivas` le a tabela real INTEIRA e
// carimba `basis = 'actual'`. Uma linha estimada gravada la volta a tela como
// tarifa OFICIAL da Amazon — perde-se exatamente a marca que nos separa do
// concorrente, que exibe tarifa de tabela sem marca nenhuma.
//
// 📌 A INVESTIGACAO CONCLUIU QUE O PRODUTOR JA ESTAVA MORTO, e o que restou foi
// residuo do estimador antes da troca do dia: 227 dos 228 pedidos com linha
// fantasma tambem tem linha na tabela nova — o mesmo estimador, nos mesmos
// pedidos, antes e depois. Estes testes existem para que ele CONTINUE morto.

test("o mapeador da Amazon nunca produz 'estimated' — nem para um tipo com esse nome", () => {
  // Comportamento, nao texto: qualquer rotulo desconhecido cai em `other`.
  // `other` e honesto (nao sabemos a natureza); `estimated` seria a PROCEDENCIA
  // ocupando a coluna da NATUREZA, que e a confusao que a 0022 desfez.
  const fees = normalizeAmazonFinanceFees(
    {
      ShipmentEventList: [{
        AmazonOrderId: "TEST-1",
        ShipmentItemList: [{
          ItemFeeList: [
            { FeeType: "Estimated", FeeAmount: { CurrencyCode: "BRL", Amount: -3.47 } },
            { FeeType: "EstimatedReferralFee", FeeAmount: { CurrencyCode: "BRL", Amount: -1.19 } },
            { FeeType: "Commission", FeeAmount: { CurrencyCode: "BRL", Amount: -5.0 } },
          ],
        }],
      }],
    },
    "BRL",
  );
  const tipos = new Set(fees.map((f) => f.feeType));
  assert.ok(tipos.size > 0, "o normalizador precisa ter produzido alguma tarifa");
  assert.ok(!tipos.has("estimated"), "procedencia nao pode ocupar a coluna de natureza");
  assert.ok(tipos.has("other"), "rotulo desconhecido cai em other, que e a resposta honesta");
  assert.ok(tipos.has("commission"), "e o que E conhecido continua sendo classificado");
});

test("o vocabulario canonico NAO tem 'estimated' — e e o tipo que torna a escrita impossivel", async () => {
  // Os tres unicos INSERT em `workspace_channel_order_fees` recebem
  // `CanonicalFee[]`. Se a uniao nao admite o valor, nenhum caminho em
  // TypeScript consegue grava-lo — a garantia e do compilador, nao de disciplina.
  const fonte = await readFile(new URL("../src/lib/integrations/canonical.ts", import.meta.url), "utf8");
  const inicio = fonte.indexOf("export type CanonicalFeeType");
  assert.notEqual(inicio, -1, "a uniao mudou de nome — reancore esta guarda");
  const uniao = fonte.slice(inicio, fonte.indexOf(";", inicio));
  assert.doesNotMatch(uniao, /"estimated"/, "voltou a procedencia para dentro da natureza");
  // E os valores que a view soma pela lista positiva continuam existindo.
  for (const esperado of ["commission", "fulfillment", "refund", "other"]) {
    assert.match(uniao, new RegExp(`"${esperado}"`), `${esperado} sumiu do vocabulario`);
  }
});

test("o estimador escreve na tabela NOVA, e a antiga nao aparece no seu codigo", async () => {
  // ⚠️ ASSERCAO QUE PROIBE STRING OLHA O FONTE SEM COMENTARIO (AGENTS.md): o
  // comentario deste modulo EXPLICA que ele escrevia na tabela antiga, e cita o
  // nome dela. Casar o fonte cru reprovaria a documentacao da propria correcao.
  const fonte = await readFile(
    new URL("../src/lib/integrations/amazonTarifaEstimada.ts", import.meta.url),
    "utf8",
  );
  const codigo = fonte
    .split("\n")
    .map((linha) => linha.replace(/\r$/, "").replace(/\s*--.*$/, "").replace(/\s*\/\/.*$/, ""))
    .filter((linha) => !linha.trim().startsWith("*") && !linha.trim().startsWith("/*"))
    .join("\n");
  assert.match(codigo, /INSERT INTO workspace_channel_order_fee_estimates/,
    "o estimador precisa gravar na tabela de estimativa");
  assert.doesNotMatch(codigo, /INSERT INTO workspace_channel_order_fees\b/,
    "voltou a gravar estimativa na tabela da tarifa real");
});
