import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { custoDoEstoqueNoFull } from "../src/lib/integrations/mercadoLivreFullStock.ts";

const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

const oferta = (extra) => ({
  externalProductId: "MLB1", sku: "SKU-A", title: "Produto A",
  availableQty: 10, userProductId: null, ...extra,
});
const custoFixo = (tabela) => (item) => (item.sku && tabela[item.sku] != null ? tabela[item.sku] : null);

test("total é a soma manual dos itens com custo", () => {
  const r = custoDoEstoqueNoFull(
    [
      oferta({ externalProductId: "MLB1", sku: "SKU-A", availableQty: 10 }),
      oferta({ externalProductId: "MLB2", sku: "SKU-B", availableQty: 4, title: "Produto B" }),
    ],
    custoFixo({ "SKU-A": 24.61, "SKU-B": 5.5 })
  );
  // 10 × 24,61 = 246,10 · 4 × 5,50 = 22,00
  assert.equal(r.total, 268.1);
  assert.equal(r.unidades, 14);
  assert.equal(r.unidadesComCusto, 14);
  assert.equal(r.itensSemCusto, 0);
  assert.deepEqual(r.itens.map((i) => i.subtotal), [246.1, 22]);
});

test("item sem custo fica FORA do total, com subtotal null e contado na pendência", () => {
  const r = custoDoEstoqueNoFull(
    [
      oferta({ externalProductId: "MLB1", sku: "SKU-A", availableQty: 10 }),
      oferta({ externalProductId: "MLB2", sku: "SKU-SEM", availableQty: 7, title: "Sem custo" }),
    ],
    custoFixo({ "SKU-A": 24.61 })
  );
  assert.equal(r.total, 246.1, "o total conta só o que tem custo — não extrapola o resto");
  assert.equal(r.itensSemCusto, 1);
  assert.equal(r.unidadesSemCusto, 7);
  assert.equal(r.unidadesComCusto, 10);
  const semCusto = r.itens.find((i) => i.sku === "SKU-SEM");
  assert.equal(semCusto.custoUnitario, null, "custo desconhecido é null, nunca zero");
  assert.equal(semCusto.subtotal, null, "sem custo não se estima subtotal");
});

test("nenhum item com custo: total é null, não R$ 0,00", () => {
  const r = custoDoEstoqueNoFull([oferta({ availableQty: 5 })], () => null);
  assert.equal(r.total, null, "zero afirmaria que não há capital parado; o fato é que não se sabe");
  assert.equal(r.unidades, 5);
  assert.equal(r.itensSemCusto, 1);
});

// ── A regra que evita triplicar o capital ───────────────────────────────────

test("ofertas que dividem estoque contam UMA vez, pelo máximo — não pela soma", () => {
  // Caso real medido em 27/08/2026: AREIA-MAGICA-300G em 3 ofertas Full, 159
  // unidades em cada. Somar daria 477 e triplicaria o capital.
  const r = custoDoEstoqueNoFull(
    [
      oferta({ externalProductId: "MLB6291798002", sku: "AREIA-MAGICA-300G", availableQty: 159 }),
      oferta({ externalProductId: "MLB4477057081", sku: "AREIA-MAGICA-300G", availableQty: 159 }),
      oferta({ externalProductId: "MLB6955574150", sku: "AREIA-MAGICA-300G", availableQty: 159 }),
    ],
    custoFixo({ "AREIA-MAGICA-300G": 2 })
  );
  assert.equal(r.itens.length, 1, "é um estoque só");
  assert.equal(r.itens[0].qtyFull, 159);
  assert.equal(r.itens[0].ofertas.length, 3);
  assert.equal(r.itens[0].agrupadoPor, "sku");
  assert.equal(r.total, 318, "159 × 2 — não 477 × 2");
});

test("user_product_id manda mais que o SKU quando existe", () => {
  const r = custoDoEstoqueNoFull(
    [
      oferta({ externalProductId: "MLB1", sku: "MESMO", availableQty: 10, userProductId: "UP-1" }),
      oferta({ externalProductId: "MLB2", sku: "MESMO", availableQty: 4, userProductId: "UP-2" }),
    ],
    custoFixo({ MESMO: 3 })
  );
  assert.equal(r.itens.length, 2, "estoques distintos no ML não podem colapsar pelo SKU");
  assert.deepEqual(r.itens.map((i) => i.agrupadoPor), ["user_product", "user_product"]);
  assert.equal(r.total, 42); // 10×3 + 4×3
});

test("oferta sem user_product_id e sem SKU fica sozinha e diz por quê", () => {
  const r = custoDoEstoqueNoFull(
    [oferta({ externalProductId: "MLB9", sku: null, availableQty: 3 })],
    () => null
  );
  assert.equal(r.itens[0].agrupadoPor, "oferta");
  assert.equal(r.itens.length, 1);
});

test("estoque zerado não é capital parado: fica fora da lista", () => {
  const r = custoDoEstoqueNoFull(
    [
      oferta({ externalProductId: "MLB1", sku: "SKU-A", availableQty: 0 }),
      oferta({ externalProductId: "MLB2", sku: "SKU-B", availableQty: 2, title: "B" }),
    ],
    custoFixo({ "SKU-A": 10, "SKU-B": 10 })
  );
  assert.equal(r.itens.length, 1);
  assert.equal(r.itens[0].sku, "SKU-B");
  assert.equal(r.total, 20);
});

test("maior capital primeiro; sem custo por último", () => {
  const r = custoDoEstoqueNoFull(
    [
      oferta({ externalProductId: "MLB1", sku: "BARATO", availableQty: 2, title: "Barato" }),
      oferta({ externalProductId: "MLB2", sku: "SEM", availableQty: 99, title: "Sem custo" }),
      oferta({ externalProductId: "MLB3", sku: "CARO", availableQty: 5, title: "Caro" }),
    ],
    custoFixo({ BARATO: 1, CARO: 50 })
  );
  assert.deepEqual(r.itens.map((i) => i.sku), ["CARO", "BARATO", "SEM"]);
});

// ── Vigência do custo (ADR-004) e contrato com o resto do sistema ───────────

test("a rota usa o custo VIGENTE HOJE, pelo mesmo caminho do lucro", () => {
  const rota = fonte("src/app/api/integrations/mercado-livre/full/route.ts");
  assert.match(rota, /costAt\(entrada, hoje\)/, "vigência de hoje: é foto do estoque atual");
  assert.match(rota, /new Date\(\)\.toISOString\(\)/);
  assert.match(rota, /mercadoLivreCostEntry/, "mesma resolução de custo que o lucro usa");
  assert.match(rota, /custo > 0 \? custo : null/, "custo zero é ausência de cadastro, não item de graça");
});

test("a rota não filtra por status do anúncio e não chama a API do ML", () => {
  const rota = fonte("src/app/api/integrations/mercado-livre/full/route.ts");
  assert.match(rota, /fulfillment = 'platform'/);
  assert.doesNotMatch(rota, /AND status/, "anúncio fechado com estoque no Full ainda é capital parado");
  assert.doesNotMatch(rota, /mercadoLivreFetch|fetch\(/, "lê só o canônico: nenhuma chamada nova ao ML");
});

test("estados previstos para a tela existem na rota", () => {
  const rota = fonte("src/app/api/integrations/mercado-livre/full/route.ts");
  for (const estado of ["sem_conexao", "sync_pendente", "sem_itens_no_full", "ok"]) {
    assert.ok(rota.includes(`"${estado}"`), `falta o estado ${estado}`);
  }
});
