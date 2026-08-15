import test from "node:test";
import assert from "node:assert/strict";

// A tela dizia "Aguardando dados" para qualquer cálculo incompleto. Ana leu isso
// como falha nossa — "parece que não temos dados, mas na real a Amazon que não
// tem". O Seller Central, no mesmo pedido, diz o motivo: "Pendente · Aguardando
// verificação do pagamento". Cada pendência precisa nomear DE QUEM depende.
//
// Réplica de `motivoPendente` em `OrderProfitabilityTable.tsx`. É lógica de
// produto, não de apresentação: se as duas divergirem, o teste é a referência.

function motivoPendente(line) {
  if (line.revenueKnown === false)
    return { titulo: "Aguardando pagamento", ajuda: "O canal informa o valor ao aprovar o pagamento", deNos: false };
  if (line.productCost == null)
    return { titulo: "Custo não cadastrado", ajuda: `Cadastre o custo de ${line.sku || "este produto"}`, deNos: true };
  return { titulo: "Tarifas não postadas", ajuda: "Entram quando o canal liquida o pedido", deNos: false };
}

test("pedido pendente aponta o canal, não a nossa leitura", () => {
  // 701-7251196-0106632: `Pending`, sem ItemPrice. Custo cadastrado normalmente.
  const m = motivoPendente({ revenueKnown: false, productCost: 6.82, marketplaceFees: null, sku: "kit-clips-320" });
  assert.equal(m.titulo, "Aguardando pagamento");
  assert.equal(m.deNos, false, "a espera é da Amazon — não pode pedir ação da vendedora");
});

test("custo ausente é a única pendência que pede ação dela", () => {
  const m = motivoPendente({ revenueKnown: true, productCost: null, marketplaceFees: 0, sku: "martelo-borracha" });
  assert.equal(m.deNos, true);
  assert.match(m.ajuda, /martelo-borracha/, "diz QUAL SKU cadastrar");
});

test("venda enviada com tarifa pendente culpa a tarifa, não o custo", () => {
  const m = motivoPendente({ revenueKnown: true, productCost: 6.82, marketplaceFees: null, sku: "kit-clips-320" });
  assert.equal(m.titulo, "Tarifas não postadas");
  assert.equal(m.deNos, false);
});

test("pagamento pendente tem precedência sobre custo ausente", () => {
  // Sem o valor da venda, cadastrar o custo não fecharia o cálculo — mandar a
  // vendedora agir aqui seria mandá-la fazer algo que não resolve.
  const m = motivoPendente({ revenueKnown: false, productCost: null, marketplaceFees: null, sku: "kit-clips-320" });
  assert.equal(m.titulo, "Aguardando pagamento");
  assert.equal(m.deNos, false);
});

test("nenhum motivo usa o rótulo genérico que causou a confusão", () => {
  const casos = [
    { revenueKnown: false, productCost: 6.82, marketplaceFees: null },
    { revenueKnown: true, productCost: null, marketplaceFees: 0 },
    { revenueKnown: true, productCost: 6.82, marketplaceFees: null },
  ];
  for (const caso of casos) {
    const m = motivoPendente(caso);
    assert.notEqual(m.titulo, "Aguardando dados");
    assert.notEqual(m.titulo, "Cálculo incompleto");
    assert.ok(m.ajuda.length > 0, "todo motivo explica o que acontece a seguir");
  }
});
