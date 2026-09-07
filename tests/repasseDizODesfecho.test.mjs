import test from "node:test";
import assert from "node:assert/strict";
import { calcularSaldo } from "../src/lib/amazonBalance.ts";

// ⚠️ O CARD DE REPASSE DIZ O QUE A API JA SABIA — e ninguem lia.
//
// 🔴 INCIDENTE REAL (05-06/09/2026). A vendedora perguntou: *"os saques que
// estou fazendo estao indo pra onde?"*. Medido na Finances API: **SETE
// transferencias com FundTransferStatus = Failed**, incluindo as quatro que o
// painel dela exibia como "pagamentos recentes" de 01/09. **O painel mostrava a
// TENTATIVA; o desfecho so existia na API, e nos nao o liamos.** Ela trocou a
// conta bancaria em 06/09; R$ 382,44 ficaram represados.
//
// 📌 Por isso este modulo passa a expor tres coisas, e cada uma tem um defeito
// atras dela:
//   aguardandoTransferencia -> os R$ 382,44 que ninguem via
//   ultimaTransferencia     -> o "Failed" que teria avisado semanas antes
//   traceId                 -> o unico jeito de casar com o extrato do banco
//
// ⚠️ E NAO HA "PROXIMO REPASSE ~DIA X", de proposito. A API nao publica data
// futura: `FundTransferDate` so aparece DEPOIS da tentativa. Daria para inferir
// pela cadencia, mas a desta conta e irregular (05/07, 16/08, 29/08, 01/09) e a
// tela estaria chutando. **Data errada de dinheiro e pior que data nenhuma** —
// quem sentir falta dela, a ausencia E o desenho.

const grupo = (over = {}) => ({
  processingStatus: "Closed",
  originalTotal: { currencyAmount: 100, currencyCode: "BRL" },
  startDate: "2026-09-01T00:00:00.000Z",
  ...over,
});

test("o que espera transferencia", async (t) => {
  await t.test("🔴 soma os grupos Pending — era o dinheiro invisivel", () => {
    const saldo = calcularSaldo([
      grupo({ processingStatus: "Pending", originalTotal: { currencyAmount: 204.29 } }),
      grupo({ processingStatus: "Pending", originalTotal: { currencyAmount: 133.82 } }),
      grupo({ processingStatus: "Pending", originalTotal: { currencyAmount: 44.33 } }),
      grupo({ processingStatus: "Open", originalTotal: { currencyAmount: 10 } }),
    ], []);
    // Os R$ 382,44 exatos que estavam represados na conta dela.
    assert.equal(saldo.aguardandoTransferencia, 382.44);
    // E o Open NAO entra: sao perguntas diferentes (o que matura x o que espera).
    assert.equal(saldo.disponivel, 10);
  });

  await t.test("🔴 sem grupo fechado e null, nunca zero", () => {
    // Zero afirmaria "nao ha nada esperando". Ausencia de grupo e "nao sei".
    assert.equal(calcularSaldo([grupo({ processingStatus: "Open" })], []).aguardandoTransferencia, null);
  });
});

test("o desfecho da ultima transferencia", async (t) => {
  const comFalha = [
    grupo({ fundTransferStatus: "Failed", fundTransferDate: "2026-09-01T17:09:00.000Z",
            originalTotal: { currencyAmount: 153.85 }, accountTail: "550" }),
    grupo({ fundTransferStatus: "Failed", fundTransferDate: "2026-08-29T15:16:00.000Z",
            originalTotal: { currencyAmount: 89.81 }, traceId: "DASYCPU3DV4Y474", accountTail: "550" }),
  ];

  await t.test("🔴 devolve a MAIS RECENTE, com status, data e valor", () => {
    const u = calcularSaldo(comFalha, []).ultimaTransferencia;
    assert.equal(u.status, "Failed");
    assert.equal(u.data, "2026-09-01T17:09:00.000Z");
    assert.equal(u.valor, 153.85);
    assert.equal(u.contaFinal, "550");
  });

  await t.test("🔴 NAO filtra por sucesso — era o Failed que precisava aparecer", () => {
    // Se alguem "melhorar" isto mostrando so o ultimo repasse BEM-SUCEDIDO, a
    // tela volta a esconder exatamente o que a vendedora precisava ver.
    const u = calcularSaldo(comFalha, []).ultimaTransferencia;
    assert.notEqual(u, null);
    assert.equal(u.status, "Failed");
  });

  await t.test("traceId vem quando existe", () => {
    const so = calcularSaldo([comFalha[1]], []).ultimaTransferencia;
    assert.equal(so.traceId, "DASYCPU3DV4Y474");
  });

  await t.test("🔴 e e null quando NAO existe — nunca traco vazio", () => {
    // Medido: 1 de 12 transferencias tinha trace. String vazia fingiria
    // rastreio e mandaria a vendedora procurar um codigo que nao existe.
    assert.equal(calcularSaldo(comFalha, []).ultimaTransferencia.traceId, null);
  });

  await t.test("sem transferencia nenhuma, e null", () => {
    assert.equal(calcularSaldo([grupo({ processingStatus: "Open" })], []).ultimaTransferencia, null);
  });
});
