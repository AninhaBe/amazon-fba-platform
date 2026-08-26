import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  AssinaturaStripeInvalida,
  TOLERANCIA_PADRAO_SEGUNDOS,
  verificarAssinaturaStripe,
} from "../src/lib/billing/stripeSignature.ts";

// Valor de teste, sem relação com o segredo real — este vive só em
// STRIPE_WEBHOOK_SECRET, no ambiente.
const SEGREDO = "segredo-de-teste-sem-valor";
const AGORA = new Date("2026-08-26T12:00:00Z").getTime();
const CORPO = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });

function assinar(corpo, { segredo = SEGREDO, t = Math.floor(AGORA / 1000) } = {}) {
  const v1 = crypto.createHmac("sha256", segredo).update(`${t}.${corpo}`).digest("hex");
  return { t, v1, cabecalho: `t=${t},v1=${v1}` };
}

const entrada = (extra) => ({ corpo: CORPO, segredo: SEGREDO, agora: AGORA, ...extra });

test("assinatura legítima passa", () => {
  const { cabecalho } = assinar(CORPO);
  assert.doesNotThrow(() => verificarAssinaturaStripe(entrada({ cabecalho })));
});

test("cabeçalho ausente, vazio ou sem esquema v1 é recusado", () => {
  for (const cabecalho of [null, undefined, "", "   ", "t=123", "v1=abc", "lixo"]) {
    assert.throws(() => verificarAssinaturaStripe(entrada({ cabecalho })), AssinaturaStripeInvalida);
  }
});

test("assinatura de outro segredo é recusada", () => {
  const { cabecalho } = assinar(CORPO, { segredo: "outro-segredo-de-teste" });
  assert.throws(() => verificarAssinaturaStripe(entrada({ cabecalho })), /não confere/i);
});

test("corpo adulterado depois de assinado é recusado", () => {
  const { cabecalho } = assinar(CORPO);
  const adulterado = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", extra: 1 });
  assert.throws(
    () => verificarAssinaturaStripe(entrada({ cabecalho, corpo: adulterado })),
    /não confere/i
  );
});

test("reserializar o JSON quebra a assinatura — por isso a rota usa o corpo bruto", () => {
  const original = '{"type": "checkout.session.completed", "id": "evt_1", "nota": "caf\u00e9"}';
  const { cabecalho } = assinar(original);
  assert.doesNotThrow(() => verificarAssinaturaStripe(entrada({ cabecalho, corpo: original })));
  assert.throws(
    () => verificarAssinaturaStripe(entrada({ cabecalho, corpo: JSON.stringify(JSON.parse(original)) })),
    /não confere/i
  );
});

test("carimbo velho é recusado: replay de evento legítimo capturado antes", () => {
  const velho = Math.floor(AGORA / 1000) - TOLERANCIA_PADRAO_SEGUNDOS - 1;
  const { cabecalho } = assinar(CORPO, { t: velho });
  assert.throws(() => verificarAssinaturaStripe(entrada({ cabecalho })), /tolerância/i);
});

test("carimbo no futuro além da janela também é recusado", () => {
  const futuro = Math.floor(AGORA / 1000) + TOLERANCIA_PADRAO_SEGUNDOS + 1;
  const { cabecalho } = assinar(CORPO, { t: futuro });
  assert.throws(() => verificarAssinaturaStripe(entrada({ cabecalho })), /tolerância/i);
});

test("carimbo na borda da janela ainda passa", () => {
  const borda = Math.floor(AGORA / 1000) - TOLERANCIA_PADRAO_SEGUNDOS;
  const { cabecalho } = assinar(CORPO, { t: borda });
  assert.doesNotThrow(() => verificarAssinaturaStripe(entrada({ cabecalho })));
});

test("rotação de segredo: basta um dos v1 bater", () => {
  const bom = assinar(CORPO);
  const ruim = assinar(CORPO, { segredo: "segredo-antigo-de-teste" });
  assert.doesNotThrow(() =>
    verificarAssinaturaStripe(entrada({ cabecalho: `t=${bom.t},v1=${ruim.v1},v1=${bom.v1}` }))
  );
});

test("v1 com tamanho errado não derruba a verificação (timingSafeEqual lança em buffers diferentes)", () => {
  const { t } = assinar(CORPO);
  assert.throws(
    () => verificarAssinaturaStripe(entrada({ cabecalho: `t=${t},v1=abcdef` })),
    AssinaturaStripeInvalida
  );
});

test("segredo ausente nunca vira 'deixa passar'", () => {
  const { cabecalho } = assinar(CORPO);
  assert.throws(
    () => verificarAssinaturaStripe(entrada({ cabecalho, segredo: "" })),
    /não configurado/i
  );
});
