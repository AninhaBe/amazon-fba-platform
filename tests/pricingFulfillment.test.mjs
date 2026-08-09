import test from "node:test";
import assert from "node:assert/strict";
import { parseCompetitiveSummary } from "../src/lib/fulfillmentPricing.ts";

// Formato confirmado ao vivo em 09/08/2026 contra o nicho "varal de inox":
// o ASIN vem em body.asin (o `request` devolvido volta vazio) e a logística
// em fulfillmentType — AFN = FBA, MFN = o vendedor envia.
const resposta = (asin, ofertas, destaque) => ({
  status: { statusCode: 200 },
  body: {
    asin,
    marketplaceId: "A2Q3Y263D00KWC",
    lowestPricedOffers: [
      {
        offers: ofertas.map(([fulfillmentType, amount]) => ({
          fulfillmentType,
          listingPrice: { amount, currencyCode: "BRL" },
        })),
      },
    ],
    ...(destaque
      ? { featuredBuyingOptions: [{ segmentedFeaturedOffers: [{ fulfillmentType: destaque }] }] }
      : {}),
  },
});

test("pega o menor preço entre as ofertas FBA, ignorando as do vendedor", () => {
  const mapa = parseCompetitiveSummary({
    responses: [resposta("B0AAA", [["MFN", 12.5], ["AFN", 21.9], ["AFN", 18.4]], "AFN")],
  });
  const r = mapa.get("B0AAA");
  assert.equal(r.fbaPrice, 18.4);
  assert.equal(r.lowestPrice, 12.5, "o menor geral considera qualquer logística");
  assert.equal(r.featured, "fba");
});

test("sem oferta FBA o preço é null, nunca zero", () => {
  const mapa = parseCompetitiveSummary({
    responses: [resposta("B0BBB", [["MFN", 78.8]], "MFN")],
  });
  const r = mapa.get("B0BBB");
  assert.equal(r.fbaPrice, null, "ausência de FBA não pode virar 0 — inflaria o piso do nicho");
  assert.equal(r.lowestPrice, 78.8);
  assert.equal(r.featured, "seller");
});

test("identifica o ASIN pelo corpo, não pela ordem da requisição", () => {
  const mapa = parseCompetitiveSummary({
    responses: [
      resposta("B0CCC", [["AFN", 15.9]]),
      resposta("B0DDD", [["AFN", 27.9]]),
    ],
  });
  assert.equal(mapa.get("B0CCC").fbaPrice, 15.9);
  assert.equal(mapa.get("B0DDD").fbaPrice, 27.9);
});

test("resposta sem asin é descartada em vez de virar entrada vazia", () => {
  const mapa = parseCompetitiveSummary({
    responses: [{ status: { statusCode: 200 }, body: { lowestPricedOffers: [] } }],
  });
  assert.equal(mapa.size, 0);
});

test("oferta sem preço numérico não entra na conta", () => {
  const mapa = parseCompetitiveSummary({
    responses: [
      {
        status: { statusCode: 200 },
        body: {
          asin: "B0EEE",
          lowestPricedOffers: [
            { offers: [{ fulfillmentType: "AFN", listingPrice: {} }, { fulfillmentType: "AFN", listingPrice: { amount: 9.9, currencyCode: "BRL" } }] },
          ],
        },
      },
    ],
  });
  assert.equal(mapa.get("B0EEE").fbaPrice, 9.9);
});

test("lote vazio ou sem respostas devolve mapa vazio", () => {
  assert.equal(parseCompetitiveSummary({}).size, 0);
  assert.equal(parseCompetitiveSummary({ responses: [] }).size, 0);
});

test("sem oferta em destaque, featured fica null", () => {
  const mapa = parseCompetitiveSummary({ responses: [resposta("B0FFF", [["AFN", 10]])] });
  assert.equal(mapa.get("B0FFF").featured, null);
});
