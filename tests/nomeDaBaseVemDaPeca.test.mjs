import test from "node:test";
import assert from "node:assert/strict";
import { declaracaoDeBase, nomeDaBase } from "../src/app/components/baseDaMargem.ts";

/**
 * ⚠️ ESTA GUARDA E SOBRE A PROCEDENCIA DO TEXTO, NAO SOBRE O TEXTO.
 *
 * A varredura de frases explicativas foi MEDIDA antes de virar guarda e
 * reprovada: gatilho de texto deu 84 achados, ZERO mentiras vivas e ~95% de
 * falso positivo, e o teste de recall matou de vez — ela nao teria pego nenhum
 * dos dois casos reais do dia (um era ternario, o outro nao era string). O
 * registro esta em `docs/achado-frase-com-validade-nao-vira-guarda.md`.
 *
 * O que sobra com poder e julgar DE ONDE A FRASE VEIO: o vocabulario que nomeia
 * a base de um numero sai de `baseDaMargem.ts` e de lugar nenhum mais. Isso e
 * verificavel sem adivinhar intencao, e a peca e funcao pura — da para chamar e
 * conferir a saida, que e a resposta certa a familia "guarda que depende da
 * forma do codigo" (`docs/achado-guarda-que-depende-da-forma.md`).
 */

test("nomeDaBase NOMEIA quando nao ha divergencia — e nao inventa 'sobre vendas'", () => {
  // O defeito que isto reprova: rotear o monitor e o modulo da Shopee por
  // `declaracaoDeBase`, que devolve null sem divergencia, trocaria
  // "sobre a receita processada" por "sobre vendas" — perda de especificidade
  // travestida de refatoracao. Medido em 01/09/2026, antes de aplicar.
  const monitor = { baseApurada: 1000, faturamentoExibido: 1000, moeda: "BRL", rotuloDaBase: "a receita" };
  assert.equal(nomeDaBase(monitor), "sobre a receita");

  const shopee = { baseApurada: 500, faturamentoExibido: 500, moeda: "BRL", rotuloDaBase: "a receita processada" };
  assert.equal(nomeDaBase(shopee), "sobre a receita processada");

  // E quando o backend mandar `revenueDoLucro`, o nome acompanha o campo usado.
  const shopeeComFaturamento = { ...shopee, rotuloDaBase: "o faturamento" };
  assert.equal(nomeDaBase(shopeeComFaturamento), "sobre o faturamento");
});

test("e DELEGA quando ha divergencia — a declaracao continua ganhando do nome", () => {
  const comDivergencia = { baseApurada: 748.56, faturamentoExibido: 1068.37, moeda: "BRL", rotuloDaBase: "a receita" };
  assert.equal(nomeDaBase(comDivergencia), declaracaoDeBase(comDivergencia));
  assert.match(nomeDaBase(comDivergencia), /apurados de/);
});
