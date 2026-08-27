import test from "node:test";
import assert from "node:assert/strict";
import {
  rotuloConciliacao,
  rotuloStatusPedido,
  rotuloStatusProduto,
  rotuloStatusShopee,
} from "../src/app/components/statusDeExibicao.ts";
import { tiktokMappedStatuses, tiktokStatusIfMapped } from "../src/lib/integrations/tiktokCanonical.ts";
import { TIKTOK_CATALOG_STATUSES } from "../src/lib/integrations/tiktokModuleContract.ts";

// A ingestao e fail-closed: status fora do `MAPA_STATUS` NAO vira "pending" nem
// some — ele explode e chega na tela com nome e contagem. A camada de exibicao
// tem que ser a mesma filosofia do outro lado: status que ela nao conhece
// aparece CRU, nunca traduzido por chute e nunca escondido atras de
// "Desconhecido" ou "—". Valor cru na tela e o unico aviso de que a API mandou
// algo novo; apagar esse aviso e apagar o motivo de alguem ir corrigir o mapa.

test("status fora do mapa continua cru na tela, nunca traduzido por chute", () => {
  // O token da API sobrevive inteiro: quem le a tela consegue copiar o valor e
  // procurar no codigo qual mapa precisa da linha nova.
  assert.equal(rotuloStatusPedido("status_novo_da_api"), "status novo da api");
  assert.equal(rotuloStatusProduto("under_review"), "under review");
  assert.equal(rotuloConciliacao("estorno_em_analise"), "estorno em analise");
  assert.equal(rotuloStatusShopee("NOVO_STATUS_V2"), "novo status v2");
});

test("desconhecido nao vira rotulo generico, travessao nem string vazia", () => {
  for (const rotulo of [rotuloStatusPedido, rotuloStatusProduto, rotuloConciliacao, rotuloStatusShopee]) {
    const saida = rotulo("PARCELA_RETIDA");
    assert.notEqual(saida, "Desconhecido");
    assert.notEqual(saida, "—");
    assert.notEqual(saida, "");
    // Nao pode cair no rotulo de nenhum status conhecido: chute silencioso e
    // pior que valor cru, porque ninguem descobre que existe um status novo.
    assert.notEqual(saida, "Pendente");
    assert.notEqual(saida, "Pago");
    assert.notEqual(saida, "Cancelado");
    assert.ok(saida.toLowerCase().includes("parcela retida"));
  }
});

test("string vazia nao inventa status", () => {
  assert.equal(rotuloStatusPedido(""), "");
  assert.equal(rotuloStatusProduto(""), "");
  assert.equal(rotuloStatusShopee(""), "");
});

test("todo status que a ingestao do TikTok consegue produzir tem rotulo em PT", () => {
  // O complemento do fail-open: cru so pode aparecer para o que a ingestao
  // TAMBEM rejeitaria. Status que ela aceita e grava no canonico nunca pode
  // chegar em ingles na tela — foi exatamente o defeito ('paid', 'delivered',
  // 'pending' no Monitor) que este teste existe para nao voltar.
  const canonicos = new Set(tiktokMappedStatuses().map((provider) => tiktokStatusIfMapped(provider)));
  assert.ok(canonicos.size > 0);
  for (const status of canonicos) {
    const rotulo = rotuloStatusPedido(status);
    assert.notEqual(rotulo, status, `status canonico "${status}" ficou cru na tela`);
    assert.match(rotulo, /^[A-ZÀ-Ú]/, `status canonico "${status}" deveria ter rotulo em PT`);
  }
});

test("todo status de anuncio do contrato TikTok tem rotulo em PT", () => {
  for (const status of TIKTOK_CATALOG_STATUSES) {
    const rotulo = rotuloStatusProduto(status);
    assert.notEqual(rotulo, status, `status de anuncio "${status}" ficou cru na tela`);
  }
});

test("a nomenclatura e a mesma da casa nos quatro canais", () => {
  // Nao e enfeite: 'Enviado' na Shopee e 'shipped' no TikTok descrevem o mesmo
  // estado, e a casa ja decidiu como chama cada um. Se alguem trocar uma
  // palavra aqui, os canais voltam a divergir sem ninguem perceber.
  assert.equal(rotuloStatusPedido("pending"), "Pendente");
  assert.equal(rotuloStatusPedido("paid"), "Pago");
  assert.equal(rotuloStatusPedido("shipped"), "Enviado");
  assert.equal(rotuloStatusPedido("delivered"), "Entregue");
  assert.equal(rotuloStatusPedido("cancelled"), "Cancelado");
  assert.equal(rotuloStatusPedido("refunded"), "Reembolsado");

  assert.equal(rotuloStatusProduto("active"), "Ativo");
  assert.equal(rotuloStatusProduto("paused"), "Pausado");
  assert.equal(rotuloStatusProduto("closed"), "Encerrado");

  assert.equal(rotuloConciliacao("complete"), "Conciliado");
  assert.equal(rotuloConciliacao("pending"), "Aguardando extrato");

  // A Shopee mostra o status DO PROVEDOR no monitor; quando o valor ja vem
  // normalizado, ela le igual ao resto da casa.
  assert.equal(rotuloStatusShopee("READY_TO_SHIP"), "Pronto para envio");
  assert.equal(rotuloStatusShopee("INVOICE_PENDING"), "Aguardando NF-e");
  assert.equal(rotuloStatusShopee("paid"), "Pago");
});
