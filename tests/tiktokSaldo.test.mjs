import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calcularSaldoTiktok } from "../src/lib/integrations/tiktokSaldo.ts";

// Formas colhidas das duas leituras financeiras que o TikTok expõe e que o
// ledger já persiste (docs/tiktok-modules-api.md e tiktokFinancialLedger.ts):
//
// - `/finance/202507/orders/unsettled` → transação com `settlement_state`
//   `unsettled` e `settlement_amount`. NÃO traz data de liberação.
// - `/finance/202309/payments` → repasse com `expected_time` e `paid_time`. É a
//   única data de liberação que a API prova.

const AGORA = new Date("2026-08-23T15:00:00Z");

const retida = (id, valor, extra = {}) => ({
  transactionId: id,
  orderId: `pedido-${id}`,
  statementId: null,
  occurredAt: "2026-08-20T12:00:00Z",
  currency: "BRL",
  settlementAmount: valor,
  settlementState: "unsettled",
  ...extra,
});

const liquidada = (id, extrato) => ({
  transactionId: id,
  orderId: `pedido-${id}`,
  statementId: extrato,
  occurredAt: "2026-08-10T12:00:00Z",
  currency: "BRL",
  settlementAmount: 40,
  settlementState: "settled",
});

const repasse = (id, extra = {}) => ({
  paymentId: id,
  statementId: null,
  amount: 40,
  currency: "BRL",
  paidAt: null,
  expectedAt: null,
  ...extra,
});

test("retido soma só o que ainda não tem extrato; liquidado não entra duas vezes", () => {
  const saldo = calcularSaldoTiktok({
    agora: AGORA,
    ledger: [retida("t1", 30.5), retida("t2", 12.25), liquidada("t3", "E1")],
    pagamentos: [repasse("p1", { statementId: "E1", amount: 40, expectedAt: "2026-08-28T12:00:00Z" })],
  });

  // O pedido sai de `unsettled` quando entra num extrato, e é o extrato que
  // gera o pagamento: retido e a liberar nunca descrevem o mesmo dinheiro.
  assert.equal(saldo.retido, 42.75);
  assert.equal(saldo.retidoVendas, 2);
  assert.equal(saldo.aLiberar, 40);
  assert.equal(saldo.currency, "BRL");
  assert.equal(saldo.liberado, null, "sem repasse pago, liberado é desconhecido — não zero");
});

test("venda retida sem valor informado não vira zero: vira contagem e pendência", () => {
  const saldo = calcularSaldoTiktok({
    agora: AGORA,
    ledger: [retida("t1", null), retida("t2", null)],
    pagamentos: [],
  });

  assert.equal(saldo.retido, null, "nenhuma parcela conhecida ⇒ desconhecido, nunca 0");
  assert.equal(saldo.retidoVendas, 0);
  assert.equal(saldo.retidoSemValor, 2);
  const pendencia = saldo.pendencias.find((item) => item.codigo === "RETENCAO_SEM_VALOR");
  assert.equal(pendencia?.quantidade, 2);
  assert.match(pendencia?.texto ?? "", /^2 vendas retidas sem valor/);
});

test("valor conhecido convive com valor ausente sem contaminar o total", () => {
  const saldo = calcularSaldoTiktok({
    agora: AGORA,
    ledger: [retida("t1", 30), retida("t2", null)],
    pagamentos: [],
  });

  assert.equal(saldo.retido, 30);
  assert.equal(saldo.retidoVendas, 1);
  assert.equal(saldo.retidoSemValor, 1);
});

test("zero é fato e sobrevive: repasse de 0,00 não é lido como ausente", () => {
  const saldo = calcularSaldoTiktok({
    agora: AGORA,
    ledger: [retida("t1", 0)],
    pagamentos: [repasse("p1", { amount: 0, paidAt: "2026-08-21T12:00:00Z" })],
  });

  assert.equal(saldo.retido, 0);
  assert.equal(saldo.retidoVendas, 1);
  assert.equal(saldo.retidoSemValor, 0);
  assert.equal(saldo.liberado, 0);
  assert.equal(saldo.pendencias.length, 0);
});

test("a liberação é agrupada pelo dia de São Paulo, não pelo dia UTC", () => {
  // 14/09 02:30 UTC é 13/09 23:30 em São Paulo. Agrupar por UTC anteciparia o
  // caixa da vendedora em um dia inteiro.
  const saldo = calcularSaldoTiktok({
    agora: AGORA,
    ledger: [],
    pagamentos: [
      repasse("p1", { amount: 100, expectedAt: "2026-09-14T02:30:00Z" }),
      repasse("p2", { amount: 25.5, expectedAt: "2026-09-13T13:00:00Z" }),
    ],
  });

  assert.equal(saldo.liberacoes.length, 1);
  assert.equal(saldo.liberacoes[0].date, "2026-09-13");
  assert.equal(saldo.liberacoes[0].amount, 125.5);
  assert.equal(saldo.liberacoes[0].pagamentos, 2);
  assert.equal(saldo.aLiberar, 125.5);
});

test("quantas vendas caem na data só é afirmado quando o extrato foi lido", () => {
  const saldo = calcularSaldoTiktok({
    agora: AGORA,
    ledger: [liquidada("t1", "E1"), liquidada("t2", "E1")],
    pagamentos: [
      repasse("p1", { statementId: "E1", expectedAt: "2026-08-28T12:00:00Z" }),
      repasse("p2", { statementId: "E9", expectedAt: "2026-08-29T12:00:00Z" }),
    ],
  });

  const [comExtrato, semExtrato] = saldo.liberacoes;
  assert.equal(comExtrato.vendas, 2);
  assert.equal(semExtrato.vendas, null, "extrato fora da leitura ⇒ contagem desconhecida, nunca 0");
});

test("estorno no extrato a pagar não é contado como venda", () => {
  // A 0005 declara settlement_state IN ('unsettled','settled','reversed') e
  // nada no schema proíbe um estorno ligado a order_id dentro de um extrato a
  // pagar. Contá-lo junto faria a tela afirmar 3 vendas numa data em que
  // caíram 2 vendas e 1 estorno.
  const estorno = { ...liquidada("t9", "E1"), settlementState: "reversed" };
  const saldo = calcularSaldoTiktok({
    agora: AGORA,
    ledger: [liquidada("t1", "E1"), liquidada("t2", "E1"), estorno],
    pagamentos: [repasse("p1", { statementId: "E1", amount: 60, expectedAt: "2026-08-28T12:00:00Z" })],
  });

  assert.equal(saldo.liberacoes[0].vendas, 2);
  assert.equal(saldo.liberacoes[0].estornos, 1);
});

test("extrato só com estorno tem zero venda como fato, e não como desconhecido", () => {
  const saldo = calcularSaldoTiktok({
    agora: AGORA,
    ledger: [{ ...liquidada("t9", "E1"), settlementState: "reversed" }],
    pagamentos: [
      repasse("p1", { statementId: "E1", amount: 10, expectedAt: "2026-08-28T12:00:00Z" }),
      repasse("p2", { statementId: "E9", amount: 10, expectedAt: "2026-08-29T12:00:00Z" }),
    ],
  });

  // Extrato lido e sem linha de venda: zero é fato.
  assert.equal(saldo.liberacoes[0].vendas, 0);
  assert.equal(saldo.liberacoes[0].estornos, 1);
  // Extrato que nem foi lido continua desconhecido nas duas contagens.
  assert.equal(saldo.liberacoes[1].vendas, null);
  assert.equal(saldo.liberacoes[1].estornos, null);
});

test("settlement_state fora dos três declarados falha alto em vez de virar venda", () => {
  // O ramo implícito anterior ("tudo que não é unsettled") transformaria
  // qualquer estado novo em venda silenciosamente — mesmo padrão do status de
  // pedido não mapeado.
  assert.throws(
    () =>
      calcularSaldoTiktok({
        agora: AGORA,
        ledger: [{ ...liquidada("t1", "E1"), settlementState: "on_hold" }],
        pagamentos: [],
      }),
    /settlement_state sem tratamento: on_hold/,
  );
});

test("data prevista vencida sem repasse é marcada como atrasada e não some da lista", () => {
  const saldo = calcularSaldoTiktok({
    agora: AGORA,
    ledger: [],
    pagamentos: [
      repasse("p1", { amount: 80, expectedAt: "2026-08-18T12:00:00Z" }),
      repasse("p2", { amount: 20, expectedAt: "2026-08-30T12:00:00Z" }),
    ],
  });

  assert.equal(saldo.liberacoes[0].atrasada, true);
  assert.equal(saldo.liberacoes[1].atrasada, false);
  assert.equal(saldo.aLiberar, 100);
  assert.equal(saldo.proximaLiberacao?.date, "2026-08-30", "a próxima é a que ainda vai vencer");
});

test("repasse já pago conta como liberado e não como a liberar", () => {
  const saldo = calcularSaldoTiktok({
    agora: AGORA,
    ledger: [],
    pagamentos: [
      repasse("p1", { amount: 60, paidAt: "2026-08-19T12:00:00Z", expectedAt: "2026-08-18T12:00:00Z" }),
      repasse("p2", { amount: 15, expectedAt: "2026-08-30T12:00:00Z" }),
    ],
  });

  assert.equal(saldo.liberado, 60);
  assert.equal(saldo.liberadoPagamentos, 1);
  assert.equal(saldo.aLiberar, 15);
  assert.equal(saldo.liberacoes.length, 1);
});

test("repasse sem data prevista aparece com número em vez de ser somado a um dia qualquer", () => {
  const saldo = calcularSaldoTiktok({
    agora: AGORA,
    ledger: [],
    pagamentos: [repasse("p1", { amount: 45 }), repasse("p2", { amount: null })],
  });

  assert.equal(saldo.liberacoes.length, 0);
  assert.equal(saldo.repassesSemDataPrevista.pagamentos, 2);
  assert.equal(saldo.repassesSemDataPrevista.valor, 45);
  assert.equal(saldo.pendencias.find((p) => p.codigo === "REPASSE_SEM_DATA_PREVISTA")?.quantidade, 2);
  assert.equal(saldo.pendencias.find((p) => p.codigo === "LIBERACAO_SEM_VALOR")?.quantidade, 1);
});

test("leitura truncada é dita com número, nunca extrapolada", () => {
  const saldo = calcularSaldoTiktok({
    agora: AGORA,
    ledger: [retida("t1", 10)],
    pagamentos: [repasse("p1", { amount: 5, expectedAt: "2026-08-30T12:00:00Z" })],
    ledgerForaDaLeitura: 1412,
    pagamentosForaDaLeitura: 3,
  });

  assert.equal(saldo.retido, 10, "o total exibido é o lido — sem projetar o resto");
  assert.equal(saldo.leitura.movimentacoesForaDaLeitura, 1412);
  assert.equal(saldo.leitura.pagamentosForaDaLeitura, 3);
  const textos = saldo.pendencias.map((item) => item.texto).join(" ");
  assert.match(textos, /1\.412 movimentações do período ficaram fora deste total/);
  assert.match(textos, /3 repasses do período ficaram fora deste total/);
  assert.doesNotMatch(textos, /parcial|incomplet/i);
});

test("nada lido não vira saldo zerado", () => {
  const saldo = calcularSaldoTiktok({ agora: AGORA, ledger: [], pagamentos: [] });

  assert.equal(saldo.currency, null);
  assert.equal(saldo.retido, null);
  assert.equal(saldo.aLiberar, null);
  assert.equal(saldo.liberado, null);
  assert.equal(saldo.proximaLiberacao, null);
  assert.deepEqual(saldo.pendencias, []);
  assert.equal(saldo.leitura.movimentacoesLidas, 0);
});

test("dado corrompido falha alto em vez de virar número", () => {
  assert.throws(
    () => calcularSaldoTiktok({ agora: AGORA, ledger: [retida("t1", Number.NaN)], pagamentos: [] }),
    /settlement_amount/,
  );
  assert.throws(
    () => calcularSaldoTiktok({ agora: AGORA, ledger: [retida("t1", 10, { currency: "R$" })], pagamentos: [] }),
    /moeda ISO/,
  );
  assert.throws(
    () => calcularSaldoTiktok({ agora: AGORA, ledger: [], pagamentos: [repasse("p1", { expectedAt: "amanhã" })] }),
    /expected_time/,
  );
  assert.throws(
    () =>
      calcularSaldoTiktok({
        agora: AGORA,
        ledger: [retida("t1", 10), retida("t2", 10, { currency: "USD" })],
        pagamentos: [],
      }),
    /moedas diferentes/,
  );
});

test("a rota exige sessão e fica escopada a workspace e conexão", async () => {
  const rota = await readFile(new URL("../src/app/api/integrations/tiktok/saldo/route.ts", import.meta.url), "utf8");

  // tiktokGet carrega withAuthenticatedWorkspace e os erros seguros
  // (CONNECTION_ID_REQUIRED, INVALID_CONNECTION_ID, CONNECTION_NOT_FOUND,
  // OWNERSHIP_CONFLICT). Reimplementar isso aqui abriria a rota.
  assert.match(rota, /tiktokGet\(request, readSaldo\)/);
  assert.match(rota, /FROM workspace_financial_payments/);
  assert.match(rota, /FROM workspace_financial_transactions/);
  // As duas consultas — e só elas — precisam do mesmo escopo.
  assert.equal((rota.match(/workspace_id=\$1 AND provider=\$2 AND connection_id=\$3/g) ?? []).length, 2);
  assert.doesNotMatch(rota, /console\.(log|error|warn)/, "nada de log com dado de conta");
});

test("o painel diz o que falta com número e não se desculpa com adjetivo", async () => {
  const componente = await readFile(new URL("../src/app/components/TikTokSaldo.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(componente, /parcial|incomplet/i);
  assert.match(componente, /saldo\.pendencias/);
  assert.match(componente, /Nenhuma movimentação financeira sincronizada/);
  assert.match(componente, /não é o saldo da sua conta bancária/);
  // O dia já vem no fuso de São Paulo; passá-lo por brDate devolveria o dia
  // anterior. Ver o comentário de `diaBr` no componente.
  assert.doesNotMatch(componente, /brDate/);
});
