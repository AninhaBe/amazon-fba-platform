import test from "node:test";
import assert from "node:assert/strict";
import {
  activeConnectionCount,
  connectionRemovalCopy,
  isRemovableProvider,
  providerState,
} from "../src/app/integracoes/IntegrationsPageModel.ts";

test("estado do provider respeita o status operacional das conexões", () => {
  assert.equal(providerState([{ status: "connected" }], { planned: false, configured: true }), "connected");
  assert.equal(providerState([{ status: "attention" }], { planned: false, configured: true }), "attention");
  assert.equal(providerState([{ status: "disconnected" }], { planned: false, configured: true }), "disconnected");
});

test("conexão saudável prevalece quando existem várias lojas", () => {
  assert.equal(providerState([{ status: "attention" }, { status: "connected" }], { planned: false, configured: true }), "connected");
});

test("sem conexões distingue disponível, não configurado e planejado", () => {
  assert.equal(providerState([], { planned: false, configured: true }), "available");
  assert.equal(providerState([], { planned: false, configured: false }), "unconfigured");
  assert.equal(providerState([], { planned: true, configured: false }), "planned");
});

test("resumo conta apenas conexões efetivamente conectadas", () => {
  assert.equal(activeConnectionCount([
    { connections: [{ status: "connected" }, { status: "attention" }] },
    { connections: [{ status: "disconnected" }] },
  ]), 1);
});

test("issue isolado deixa somente o provider afetado em atencao", () => {
  assert.equal(providerState([], { planned: false, configured: true, issueStatus: "attention" }), "attention");
  assert.equal(providerState([], { planned: false, configured: true }), "available");
});

test("remoção Shopee explica que apaga somente o estado local", () => {
  const copy = connectionRemovalCopy("shopee", "Loja principal");

  assert.equal(copy.button, "Remover do SellerCore");
  assert.match(copy.confirm, /credenciais, sincronizações e os dados locais/i);
  assert.match(copy.confirm, /não será revogado na Shopee/i);
  assert.match(copy.confirm, /painel da Shopee/i);
  assert.match(copy.success ?? "", /apenas do SellerCore/i);
  assert.match(copy.success ?? "", /não foi revogado/i);
});

test("outros providers preservam a ação existente de desconexão", () => {
  assert.deepEqual(connectionRemovalCopy("mercado_livre", "Conta ML"), {
    button: "Desconectar",
    confirm: "Desconectar Conta ML?",
  });
  assert.equal(isRemovableProvider("amazon"), false);
  assert.equal(isRemovableProvider("shopee"), true);
});
