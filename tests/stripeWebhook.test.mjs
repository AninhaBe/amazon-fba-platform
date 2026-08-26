import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
// Os módulos de `src/lib` usam import relativo sem extensão ("./stripeSignature").
// O resolver registra o hook que resolve isso sob --experimental-strip-types; por
// isso a importação do módulo sob teste é dinâmica: precisa vir DEPOIS do hook.
import "../scripts/ts-resolver.mjs";

const { processarWebhookStripe } = await import("../src/lib/billing/webhookStripe.ts");

// Valor de teste, sem relação com o segredo real (que só existe em
// STRIPE_WEBHOOK_SECRET, no ambiente).
const SEGREDO = "segredo-de-teste-sem-valor";
const AGORA = new Date("2026-08-26T12:00:00Z");
const EMAIL = "vendedora@exemplo.com.br";

const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

/**
 * Mundo em memória com a MESMA semântica das implementações reais:
 * `reivindicar` decide sem await, como o `INSERT ... ON CONFLICT ... WHERE` da
 * 0013 decide numa instrução só; convidar um e-mail que já tem conta explode,
 * como o Supabase faria.
 */
function mundo({ usuarios = {} } = {}) {
  const estado = {
    usuarios: new Map(Object.entries(usuarios)),
    convites: [],
    assinaturas: new Map(),
    acesso: new Map(),
    eventos: new Map(),
    // Dados que a pessoa já tinha antes de assinar. Nenhum caminho pode sumir com eles.
    canaisConectados: new Map(Object.values(usuarios).map((ws) => [ws, ["mercado_livre"]])),
    falharEm: null,
  };

  const registro = {
    async reivindicar(evento) {
      if (estado.eventos.has(evento.id)) return false;
      estado.eventos.set(evento.id, { tipo: evento.type, processado: false });
      return true;
    },
    async concluir(id, resultado) {
      estado.eventos.set(id, { ...estado.eventos.get(id), processado: true, ...resultado });
    },
    async devolver(id) {
      if (!estado.eventos.get(id)?.processado) estado.eventos.delete(id);
    },
  };

  const assinatura = {
    async buscarWorkspacePorEmail(email) {
      return estado.usuarios.get(email) ?? null;
    },
    async convidarPorEmail(email) {
      assert.ok(!estado.usuarios.has(email), `convite para ${email}, que já tem conta`);
      const workspaceId = `ws-${estado.usuarios.size + 1}`;
      estado.usuarios.set(email, workspaceId);
      estado.convites.push(email);
      return workspaceId;
    },
    async buscarWorkspacePorStripe(clienteId, assinaturaId) {
      for (const [workspaceId, valor] of estado.assinaturas) {
        if (clienteId && valor.stripeCustomerId === clienteId) return workspaceId;
        if (assinaturaId && valor.stripeSubscriptionId === assinaturaId) return workspaceId;
      }
      return null;
    },
    async lerAssinatura(workspaceId) {
      return estado.assinaturas.get(workspaceId) ?? null;
    },
    async gravarAssinatura(workspaceId, valor) {
      if (estado.falharEm === "gravarAssinatura") throw new Error("banco fora do ar");
      estado.assinaturas.set(workspaceId, valor);
    },
    async liberarAcesso(workspaceId) {
      estado.acesso.set(workspaceId, { bloqueado: false });
    },
    async bloquearAcesso(workspaceId, bloqueio) {
      estado.acesso.set(workspaceId, {
        bloqueado: true,
        encerradoEm: bloqueio.encerradoEm.toISOString(),
        nota: bloqueio.nota,
      });
    },
  };

  return { estado, deps: { registro, assinatura } };
}

function entrega(evento, { segredo = SEGREDO, agora = AGORA, t, cabecalho } = {}) {
  const corpo = JSON.stringify(evento);
  const carimbo = t ?? Math.floor(agora.getTime() / 1000);
  const v1 = crypto.createHmac("sha256", segredo).update(`${carimbo}.${corpo}`).digest("hex");
  return {
    corpo,
    cabecalhoAssinatura: cabecalho === undefined ? `t=${carimbo},v1=${v1}` : cabecalho,
    segredo: SEGREDO,
    agora,
  };
}

const sessao = (extra = {}) => ({
  id: "evt_checkout_1",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_1",
      customer: "cus_1",
      subscription: "sub_1",
      customer_details: { email: EMAIL },
      payment_status: "paid",
      ...extra,
    },
  },
});

function nadaAconteceu(estado) {
  assert.deepEqual(estado.convites, []);
  assert.equal(estado.eventos.size, 0);
  assert.equal(estado.assinaturas.size, 0);
  assert.equal(estado.acesso.size, 0);
}

// ── 1. Assinatura ──────────────────────────────────────────────────────────

test("POST sem assinatura responde 400 e não cria nada", async () => {
  const { estado, deps } = mundo();
  const resposta = await processarWebhookStripe(entrega(sessao(), { cabecalho: null }), deps);
  assert.equal(resposta.status, 400);
  nadaAconteceu(estado);
});

test("assinatura de outro segredo responde 400 e não cria nada", async () => {
  const { estado, deps } = mundo();
  const resposta = await processarWebhookStripe(
    entrega(sessao(), { segredo: "segredo-errado-de-teste" }),
    deps
  );
  assert.equal(resposta.status, 400);
  nadaAconteceu(estado);
});

test("carimbo velho responde 400 e não cria nada", async () => {
  const { estado, deps } = mundo();
  const resposta = await processarWebhookStripe(
    entrega(sessao(), { t: Math.floor(AGORA.getTime() / 1000) - 600 }),
    deps
  );
  assert.equal(resposta.status, 400);
  assert.match(String(resposta.corpo.error), /tolerância/i);
  nadaAconteceu(estado);
});

test("corpo que não é evento da Stripe responde 400", async () => {
  const { estado, deps } = mundo();
  const resposta = await processarWebhookStripe(entrega({ id: "evt_1", type: "x" }), deps);
  assert.equal(resposta.status, 400);
  nadaAconteceu(estado);
});

test("sem STRIPE_WEBHOOK_SECRET o endpoint fecha (503), nunca aceita sem verificar", async () => {
  const { estado, deps } = mundo();
  const resposta = await processarWebhookStripe({ ...entrega(sessao()), segredo: undefined }, deps);
  assert.equal(resposta.status, 503);
  nadaAconteceu(estado);
});

// ── 2. Pagamento de verdade ────────────────────────────────────────────────

test("checkout.session.completed com payment_status unpaid não cria nada (Pix ainda não pago)", async () => {
  const { estado, deps } = mundo();
  const resposta = await processarWebhookStripe(entrega(sessao({ payment_status: "unpaid" })), deps);
  assert.equal(resposta.status, 200);
  assert.equal(resposta.corpo.desfecho, "ignorado");
  assert.deepEqual(estado.convites, []);
  assert.equal(estado.assinaturas.size, 0);
  assert.equal(estado.acesso.size, 0);
});

test("async_payment_succeeded (Pix confirmado) cria a conta e libera o acesso", async () => {
  const { estado, deps } = mundo();
  const evento = {
    ...sessao({ payment_status: "paid" }),
    id: "evt_pix_1",
    type: "checkout.session.async_payment_succeeded",
  };
  const resposta = await processarWebhookStripe(entrega(evento), deps);
  assert.equal(resposta.status, 200);
  assert.equal(resposta.corpo.desfecho, "conta_convidada");
  assert.deepEqual(estado.convites, [EMAIL]);
  const workspaceId = estado.usuarios.get(EMAIL);
  assert.equal(estado.acesso.get(workspaceId).bloqueado, false);
  assert.equal(estado.assinaturas.get(workspaceId).status, "ativa");
  assert.equal(estado.assinaturas.get(workspaceId).stripeCustomerId, "cus_1");
});

test("completed pago também libera — o caminho do cartão não espera evento assíncrono", async () => {
  const { estado, deps } = mundo();
  await processarWebhookStripe(entrega(sessao()), deps);
  assert.deepEqual(estado.convites, [EMAIL]);
});

test("assinatura 100% coberta por cupom (no_payment_required) libera", async () => {
  const { estado, deps } = mundo();
  await processarWebhookStripe(entrega(sessao({ payment_status: "no_payment_required" })), deps);
  assert.deepEqual(estado.convites, [EMAIL]);
});

// ── 3. Idempotência ────────────────────────────────────────────────────────

test("o mesmo evento entregue duas vezes gera um único convite", async () => {
  const { estado, deps } = mundo();
  const entregue = entrega(sessao());
  const primeira = await processarWebhookStripe(entregue, deps);
  const segunda = await processarWebhookStripe(entregue, deps);
  assert.equal(primeira.corpo.desfecho, "conta_convidada");
  assert.equal(segunda.corpo.duplicado, true);
  assert.deepEqual(estado.convites, [EMAIL]);
});

test("duas entregas em paralelo do mesmo evento geram um único convite", async () => {
  const { estado, deps } = mundo();
  const entregue = entrega(sessao());
  const respostas = await Promise.all([
    processarWebhookStripe(entregue, deps),
    processarWebhookStripe(entregue, deps),
  ]);
  assert.deepEqual(estado.convites, [EMAIL]);
  assert.equal(respostas.filter((r) => r.corpo.duplicado).length, 1);
});

test("efeito que falha no meio devolve a reserva: a retentativa da Stripe funciona", async () => {
  const { estado, deps } = mundo();
  estado.falharEm = "gravarAssinatura";
  const entregue = entrega(sessao());
  const primeira = await processarWebhookStripe(entregue, deps);
  assert.equal(primeira.status, 503);
  assert.equal(estado.eventos.size, 0, "reserva órfã travaria a compra para sempre");

  estado.falharEm = null;
  const segunda = await processarWebhookStripe(entregue, deps);
  assert.equal(segunda.status, 200);
  assert.equal(estado.assinaturas.get(estado.usuarios.get(EMAIL)).status, "ativa");
});

// ── 4. Conta que já existe ─────────────────────────────────────────────────

test("compra com e-mail que já tem conta converte sem segundo convite", async () => {
  const { estado, deps } = mundo({ usuarios: { [EMAIL]: "ws-existente" } });
  const resposta = await processarWebhookStripe(entrega(sessao()), deps);
  assert.equal(resposta.corpo.desfecho, "assinatura_confirmada");
  assert.deepEqual(estado.convites, [], "quem já tem senha não recebe 'crie sua senha'");
  assert.equal(estado.assinaturas.get("ws-existente").status, "ativa");
  assert.equal(estado.acesso.get("ws-existente").bloqueado, false);
  assert.deepEqual(
    estado.canaisConectados.get("ws-existente"),
    ["mercado_livre"],
    "o que a pessoa conectou no trial continua lá"
  );
});

test("e-mail é comparado em minúsculas: MAIÚSCULA no checkout não vira conta nova", async () => {
  const { estado, deps } = mundo({ usuarios: { [EMAIL]: "ws-existente" } });
  const evento = sessao({ customer_details: { email: EMAIL.toUpperCase() } });
  await processarWebhookStripe(entrega(evento), deps);
  assert.deepEqual(estado.convites, []);
});

// ── 5. Corte reversível ────────────────────────────────────────────────────

async function comAssinaturaAtiva() {
  const { estado, deps } = mundo();
  await processarWebhookStripe(entrega(sessao()), deps);
  return { estado, deps, workspaceId: estado.usuarios.get(EMAIL) };
}

test("customer.subscription.deleted corta o acesso sem apagar nada", async () => {
  const { estado, deps, workspaceId } = await comAssinaturaAtiva();
  const resposta = await processarWebhookStripe(
    entrega({
      id: "evt_sub_deleted",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_1", customer: "cus_1", status: "canceled" } },
    }),
    deps
  );
  assert.equal(resposta.corpo.desfecho, "acesso_cortado");
  assert.equal(estado.acesso.get(workspaceId).bloqueado, true);
  assert.equal(estado.assinaturas.get(workspaceId).status, "cortada");
  assert.ok(estado.usuarios.has(EMAIL), "a conta continua existindo");
  assert.match(estado.acesso.get(workspaceId).nota, /continuam aqui/i);
});

test("assinatura em unpaid corta; voltar para active devolve o acesso", async () => {
  const { estado, deps, workspaceId } = await comAssinaturaAtiva();
  await processarWebhookStripe(
    entrega({
      id: "evt_sub_unpaid",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", customer: "cus_1", status: "unpaid" } },
    }),
    deps
  );
  assert.equal(estado.acesso.get(workspaceId).bloqueado, true);
  assert.match(estado.acesso.get(workspaceId).nota, /pagamento em aberto/i);

  await processarWebhookStripe(
    entrega({
      id: "evt_sub_active",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", customer: "cus_1", status: "active" } },
    }),
    deps
  );
  assert.equal(estado.acesso.get(workspaceId).bloqueado, false, "voltar é mudar uma data");
  assert.equal(estado.assinaturas.get(workspaceId).status, "ativa");
  assert.deepEqual(estado.convites, [EMAIL], "restaurar não manda convite de novo");
});

test("o primeiro invoice.payment_failed NÃO corta o acesso", async () => {
  const { estado, deps, workspaceId } = await comAssinaturaAtiva();
  const resposta = await processarWebhookStripe(
    entrega({
      id: "evt_invoice_falhou",
      type: "invoice.payment_failed",
      data: { object: { id: "in_1", customer: "cus_1", subscription: "sub_1", attempt_count: 1 } },
    }),
    deps
  );
  assert.equal(resposta.corpo.desfecho, "ignorado");
  assert.equal(estado.acesso.get(workspaceId).bloqueado, false, "cartão vencido é transitório");
  assert.equal(estado.assinaturas.get(workspaceId).status, "ativa");
});

test("past_due também não corta", async () => {
  const { estado, deps, workspaceId } = await comAssinaturaAtiva();
  await processarWebhookStripe(
    entrega({
      id: "evt_sub_past_due",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", customer: "cus_1", status: "past_due" } },
    }),
    deps
  );
  assert.equal(estado.acesso.get(workspaceId).bloqueado, false);
});

test("corte de cliente desconhecido não escolhe workspace nenhum", async () => {
  const { estado, deps } = await comAssinaturaAtiva();
  const resposta = await processarWebhookStripe(
    entrega({
      id: "evt_sub_outro",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_999", customer: "cus_999", status: "canceled" } },
    }),
    deps
  );
  assert.equal(resposta.corpo.desfecho, "conta_nao_encontrada");
  assert.equal(estado.acesso.get(estado.usuarios.get(EMAIL)).bloqueado, false);
});

// ── 6. Contrato com o resto do sistema ─────────────────────────────────────

test("a rota assina sobre o corpo bruto e delega a decisão para src/lib/billing", () => {
  const rota = fonte("src/app/api/webhooks/stripe/route.ts");
  assert.match(rota, /req\.text\(\)/);
  assert.doesNotMatch(rota, /req\.json\(\)/);
  assert.match(rota, /stripe-signature/);
  assert.match(rota, /process\.env\.STRIPE_WEBHOOK_SECRET/);
});

test("o webhook passa pelo proxy sem sessão, como o do Mercado Livre", () => {
  assert.match(fonte("src/lib/supabase/proxy.ts"), /"\/api\/webhooks\/stripe"/);
});

test("a reserva do evento é atômica e retoma reserva órfã", () => {
  const runtime = fonte("src/lib/billing/runtime.ts");
  assert.match(runtime, /ON CONFLICT \(event_id\) DO UPDATE/);
  assert.match(runtime, /processed_at IS NULL/);
  assert.match(runtime, /RETURNING event_id/);
  assert.match(fonte("migrations/0013_webhook_da_stripe.sql"), /event_id\s+text\s+PRIMARY KEY/);
});

test("o convite cai em /auth/confirm?next=/nova-senha e a chave vem do ambiente", () => {
  const runtime = fonte("src/lib/billing/runtime.ts");
  assert.match(runtime, /\/auth\/confirm\?next=\/nova-senha/);
  assert.match(runtime, /process\.env\.SUPABASE_SECRET_KEY/);
  assert.match(runtime, /inviteUserByEmail/);
});

test("nenhum segredo literal em src/lib/billing", () => {
  for (const arquivo of [
    "src/lib/billing/runtime.ts",
    "src/lib/billing/webhookStripe.ts",
    "src/lib/billing/stripeSignature.ts",
    "src/lib/billing/stripeEvent.ts",
    "src/lib/billing/assinatura.ts",
    "src/app/api/webhooks/stripe/route.ts",
  ]) {
    assert.doesNotMatch(fonte(arquivo), /whsec_|sk_live|sk_test|sb_secret/);
  }
});

test("o bloqueio reusa o mecanismo do trial em vez de inventar um segundo portão", () => {
  const runtime = fonte("src/lib/billing/runtime.ts");
  assert.match(runtime, /from "\.\.\/trial"/);
  assert.match(runtime, /clearTrial/);
  assert.match(runtime, /setTrial/);
  // O 403 TRIAL_EXPIRED continua saindo de um lugar só.
  assert.match(fonte("src/lib/workspaceContext.ts"), /TRIAL_EXPIRED/);
});
