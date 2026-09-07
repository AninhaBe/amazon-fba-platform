import test from "node:test";
import assert from "node:assert/strict";
import { montarAviso } from "../src/lib/billing/emailsDaAssinatura.ts";
import { aplicarIntencao } from "../src/lib/billing/assinatura.ts";

// Os dois e-mails da assinatura, pedidos pela dona em 07/09/2026.

test("nenhum e-mail afirma valor — o preco mora na Stripe", () => {
  // Repetir o preco aqui seria segunda fonte da verdade sobre dinheiro: no dia
  // em que ele mudar no painel, o e-mail mente. O recibo com valor e da Stripe.
  for (const tipo of ["boas-vindas", "pagamento-falhou", "cancelado-com-reembolso", "cancelado-sem-reembolso"]) {
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

test("cancelamento dentro da garantia diz que o dinheiro voltou; fora, nao promete nada", () => {
  const com = montarAviso("cancelado-com-reembolso", { contaNova: false }).texto;
  assert.match(com, /devolvido/);
  // O prazo do estorno e do BANCO, nao nosso: prometer data seria mentir.
  assert.match(com, /prazo para o estorno/);

  const sem = montarAviso("cancelado-sem-reembolso", { contaNova: false }).texto;
  assert.ok(!/devolvid|estorn|reembols/i.test(sem), "e-mail sem reembolso nao pode falar em devolucao");
  assert.match(sem, /garantia já haviam passado|acesso vale até/);
});

test("os dois e-mails de cancelamento dizem que o dado continua guardado", () => {
  // A pessoa que cancela precisa saber que voltar nao custa o historico — e e
  // verdade: bloquear e gravar uma data, nada e apagado.
  for (const tipo of ["cancelado-com-reembolso", "cancelado-sem-reembolso"]) {
    assert.match(montarAviso(tipo, { contaNova: false }).texto, /continuam guardados|seguem onde estavam/);
  }
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
    reembolsarSeDentroDaGarantia: async () => registro.reembolso ?? null,
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

test("cancelar DENTRO da garantia manda o e-mail de reembolso; fora, o outro", async () => {
  // O defeito que isto reprova: um e-mail so para os dois casos faria a pessoa
  // que perdeu a janela esperar dinheiro que nao vem — ou a que ganhou nao
  // saber que ganhou.
  const evento = { id: "evt_c1", type: "customer.subscription.deleted", objeto: {} };
  const intencao = { acao: "cortar", motivo: "assinatura cancelada", clienteId: "cus_1", assinaturaId: "sub_1" };

  const dentro = { avisos: [], workspaceExistente: "w-1", anterior: { status: "ativa", email: "quem@paga.com" },
                   reembolso: { reembolsar: true, motivo: "dentro-da-garantia", reembolsoId: "re_1", falha: null } };
  await aplicarIntencao(evento, intencao, deps(dentro));
  assert.deepEqual(dentro.avisos.map((a) => a.tipo), ["cancelado-com-reembolso"]);

  const fora = { avisos: [], workspaceExistente: "w-1", anterior: { status: "ativa", email: "quem@paga.com" },
                 reembolso: { reembolsar: false, motivo: "fora-da-garantia", reembolsoId: null, falha: null } };
  await aplicarIntencao(evento, intencao, deps(fora));
  assert.deepEqual(fora.avisos.map((a) => a.tipo), ["cancelado-sem-reembolso"]);
});

test("o desfecho registra o que aconteceu com o dinheiro", async () => {
  // Sem isto, o ledger diria so "acesso_cortado" e ninguem saberia, olhando
  // depois, se a garantia foi honrada naquele cancelamento.
  const registro = { avisos: [], workspaceExistente: "w-1", anterior: { status: "ativa", email: "a@b.com" },
                     reembolso: { reembolsar: true, motivo: "dentro-da-garantia", reembolsoId: "re_9", falha: null } };
  const r = await aplicarIntencao(
    { id: "evt_c2", type: "customer.subscription.deleted", objeto: {} },
    { acao: "cortar", motivo: "cancelada", clienteId: "cus_1", assinaturaId: "sub_1" },
    deps(registro)
  );
  assert.match(r.detalhe, /dentro-da-garantia/);
  assert.match(r.detalhe, /re_9/);
});

test("reembolso que FALHA nao impede o corte", async () => {
  // O corte protege o produto; o reembolso e dinheiro. Se a falha do segundo
  // derrubasse o primeiro, a conta cancelada continuaria aberta.
  const registro = { avisos: [], workspaceExistente: "w-1", anterior: { status: "ativa", email: "a@b.com" },
                     reembolso: { reembolsar: false, motivo: "sem-cobranca-conhecida", reembolsoId: null, falha: "Stripe fora do ar" } };
  const r = await aplicarIntencao(
    { id: "evt_c3", type: "customer.subscription.deleted", objeto: {} },
    { acao: "cortar", motivo: "cancelada", clienteId: "cus_1", assinaturaId: "sub_1" },
    deps(registro)
  );
  assert.equal(r.desfecho, "acesso_cortado");
  assert.match(r.detalhe, /falhou: Stripe fora do ar/);
});
