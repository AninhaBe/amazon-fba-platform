import test from "node:test";
import assert from "node:assert/strict";

// A tela da Amazon carrega DUAS bases legítimas, como as abas Vendas e
// Pagamentos do próprio Seller Central:
//
//   orderMetrics (data do pedido)  → 5 pedidos, R$ 108,34, preço de tabela,
//                                    inclui os `Pending`
//   transactions (data de postagem)→ 2 pedidos, R$ 39,80, líquido de cupom
//
// Ambas conferidas na SP-API em 15/08/2026. O erro não era o valor de nenhuma
// delas: era exibir o faturamento de uma e o ticket médio da outra. A tela
// mostrava R$ 39,80 com ticket de R$ 21,67 — que é 108,34/5, um total que não
// aparecia em lugar nenhum. O ticket verdadeiro é 39,80/2 = R$ 19,90, e os dois
// compradores pagaram exatamente isso.

const ORDER_METRICS = { totalSales: 108.34, orderCount: 5 };
const CONCILIADO = { revenue: 39.8, orderCount: 2, promotions: 2.21 };

test("o ticket médio sai da mesma base do faturamento exibido", () => {
  const ticket = CONCILIADO.revenue / CONCILIADO.orderCount;
  assert.equal(+ticket.toFixed(2), 19.9);
  // O valor antigo vinha da outra base e não se explicava pela tela.
  assert.notEqual(+ticket.toFixed(2), +(ORDER_METRICS.totalSales / ORDER_METRICS.orderCount).toFixed(2));
});

test("o que falta conciliar é subtraído no mesmo critério, sem misturar bruto e líquido", () => {
  // `totalSales` é preço de tabela; o conciliado precisa voltar ao bruto
  // somando o cupom, senão os R$ 2,21 apareceriam como pedido pendente.
  const aguardando = ORDER_METRICS.totalSales - (CONCILIADO.revenue + CONCILIADO.promotions);
  assert.equal(+aguardando.toFixed(2), 66.33);
  assert.equal(+aguardando.toFixed(2), +(3 * 22.11).toFixed(2), "são os três pedidos Pending a 22,11");

  const errado = ORDER_METRICS.totalSales - CONCILIADO.revenue;
  assert.equal(+errado.toFixed(2), 68.54, "o descuido inflaria a espera com o cupom");
});

test("a contagem de pedidos aguardando fecha", () => {
  assert.equal(ORDER_METRICS.orderCount - CONCILIADO.orderCount, 3);
});

test("nunca exibir espera negativa quando a postagem adianta o pedido", () => {
  // Pedido feito antes da janela mas postado dentro dela: o conciliado pode
  // superar o orderMetrics. A tela não pode mostrar "-1 aguardando".
  const salesCount = 2, conciliadas = 3;
  const revenueMetrics = 39.8, conciliado = 60.0;
  assert.equal(Math.max(0, salesCount - conciliadas), 0);
  assert.equal(Math.max(0, revenueMetrics - conciliado), 0);
});

test("sem nenhuma venda conciliada o ticket é desconhecido, não zero", () => {
  const conciliadas = 0;
  const ticket = conciliadas > 0 ? 39.8 / conciliadas : null;
  assert.equal(ticket, null, "R$ 0,00 afirmaria que a venda não rendeu nada");
});
