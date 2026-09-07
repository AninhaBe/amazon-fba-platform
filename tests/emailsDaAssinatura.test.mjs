import test from "node:test";
import assert from "node:assert/strict";
import { montarAviso } from "../src/lib/billing/emailsDaAssinatura.ts";
import { aplicarIntencao } from "../src/lib/billing/assinatura.ts";

// Os dois e-mails da assinatura, pedidos pela dona em 07/09/2026.

test("nenhum e-mail afirma valor — o preco mora na Stripe", () => {
  // Repetir o preco aqui seria segunda fonte da verdade sobre dinheiro: no dia
  // em que ele mudar no painel, o e-mail mente. O recibo com valor e da Stripe.
  for (const tipo of ["boas-vindas", "pagamento-falhou"]) {
    for (const contaNova of [true, false]) {
      const { assunto, texto } = montarAviso(tipo, { contaNova });
      assert.ok(!/R\$|\d+,\d{2}|\b99\b/.test(texto + assunto), `${tipo} cita valor`);
    }
  }
});

test("boas-vindas de conta NOVA fala da senha; de quem voltou, nao", () => {
  const nova = montarAviso("boas-vindas", { contaNova: true }).texto;
  const volta = montarAviso("boas-vindas", { contaNova: false }).texto;
  assert.match(nova, /criar sua senha/);
  assert.ok(!/criar sua senha/.test(volta), "quem ja tem senha nao pode receber 'crie sua senha'");
  assert.match(volta, /continuam/);
});

test("o aviso de cobranca recusada NAO diz que a conta foi cortada", () => {
  // Medido no proprio codigo: invoice.payment_failed cai em "ignorar" e nao
  // corta ninguem (stripeEvent.ts). Um e-mail dizendo o contrario seria uma
  // mentira que faria a pessoa achar que perdeu o acesso.
  const texto = montarAviso("pagamento-falhou", { contaNova: false }).texto;
  assert.match(texto, /continuam disponíveis/);
  assert.ok(!/encerrad|cortad|bloquead/i.test(texto));
});

function deps(registro) {
  return {
    buscarWorkspacePorEmail: async () => registro.workspaceExistente ?? null,
    convidarPorEmail: async () => "w-novo",
    buscarWorkspacePorStripe: async () => registro.workspaceExistente ?? null,
    lerAssinatura: async () => registro.anterior ?? null,
    gravarAssinatura: async () => {},
    liberarAcesso: async () => {},
    bloquearAcesso: async () => {},
    avisar: async (tipo, dados) => registro.avisos.push({ tipo, ...dados }),
  };
}

test("boas-vindas sai na TRANSICAO e NAO se repete a cada renovacao", async () => {
  // O defeito que isto reprova: customer.subscription.updated chega a cada
  // renovacao e a cada troca de cartao. Boas-vindas em todas vira spam, e a
  // pessoa aprende a ignorar justamente o e-mail que importa.
  const evento = { id: "evt_1", type: "checkout.session.completed", objeto: {} };
  const intencao = { acao: "liberar", email: "quem@paga.com", clienteId: "cus_1", assinaturaId: "sub_1" };

  const primeira = { avisos: [], workspaceExistente: "w-1", anterior: null };
  await aplicarIntencao(evento, intencao, deps(primeira));
  assert.equal(primeira.avisos.length, 1, "a primeira ativacao tem de avisar");
  assert.equal(primeira.avisos[0].tipo, "boas-vindas");

  const renovacao = { avisos: [], workspaceExistente: "w-1", anterior: { status: "ativa", email: "quem@paga.com" } };
  await aplicarIntencao(evento, intencao, deps(renovacao));
  assert.equal(renovacao.avisos.length, 0, "renovacao nao pode mandar boas-vindas de novo");

  const reativacao = { avisos: [], workspaceExistente: "w-1", anterior: { status: "cortada", email: "quem@paga.com" } };
  await aplicarIntencao(evento, intencao, deps(reativacao));
  assert.equal(reativacao.avisos.length, 1, "quem volta depois de cortado tem de ser avisado");
  assert.equal(reativacao.avisos[0].contaNova, false);
});

test("cobranca recusada avisa, mesmo sendo evento que NAO altera acesso", async () => {
  // O buraco que isto reprova: o evento cai em "ignorar", entao ficar calado era
  // o comportamento natural — e a assinatura morreria sem a pessoa saber por que.
  const registro = { avisos: [], workspaceExistente: "w-1", anterior: { status: "ativa", email: "quem@paga.com" } };
  const evento = { id: "evt_2", type: "invoice.payment_failed", objeto: { customer: "cus_1", subscription: "sub_1" } };
  const resultado = await aplicarIntencao(evento, { acao: "ignorar", motivo: "transitoria" }, deps(registro));
  assert.equal(resultado.desfecho, "ignorado", "o evento continua nao alterando acesso");
  assert.deepEqual(registro.avisos.map((a) => a.tipo), ["pagamento-falhou"]);
  assert.equal(registro.avisos[0].email, "quem@paga.com");
});

test("e-mail que falha NAO derruba o processamento do pagamento", async () => {
  // Sem isto, a Stripe reentregaria o evento e a pessoa receberia o aviso duas
  // vezes — ou o ledger marcaria erro num pagamento que deu certo.
  const base = deps({ avisos: [], workspaceExistente: "w-1", anterior: null });
  const quebrado = { ...base, avisar: async () => { throw new Error("Resend fora do ar"); } };
  const evento = { id: "evt_3", type: "checkout.session.completed", objeto: {} };
  const r = await aplicarIntencao(evento, { acao: "liberar", email: "a@b.com", clienteId: null, assinaturaId: null }, quebrado);
  assert.equal(r.desfecho, "assinatura_confirmada");
});
