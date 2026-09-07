import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { aplicarIntencao } from "../src/lib/billing/assinatura.ts";
import { decidirAcesso } from "../src/lib/billing/acesso.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// OS DOIS CAMINHOS ATE A CONTA ATIVA, no modelo v3 (07/09/2026). Sem trial, a
// ordem "cria conta -> paga" deixou de ser a unica, e a outra ja existia sem
// ninguem ter olhado: o webhook CONVIDA por e-mail quando o pagamento chega de
// alguem que ainda nao tem conta.
//
// ⚠️ Os dois precisam funcionar, e o defeito de cada um e diferente: no caminho
// A, pagar e nao liberar; no caminho B, convidar de novo quem ja tem senha.

function deps(registro) {
  return {
    buscarWorkspacePorEmail: async (email) => registro.contas[email] ?? null,
    convidarPorEmail: async (email) => {
      registro.convites.push(email);
      registro.contas[email] = "w-convidado";
      return "w-convidado";
    },
    buscarWorkspacePorStripe: async () => registro.porStripe ?? null,
    lerAssinatura: async () => registro.anterior ?? null,
    gravarAssinatura: async (w, estado) => registro.gravadas.push({ w, status: estado.status }),
    liberarAcesso: async (w) => registro.liberados.push(w),
    bloquearAcesso: async () => {},
    avisar: async (tipo, dados) => registro.avisos.push({ tipo, ...dados }),
  };
}

const novo = () => ({ contas: {}, convites: [], gravadas: [], liberados: [], avisos: [], anterior: null, porStripe: null });
const PAGAMENTO = { id: "evt_p", type: "checkout.session.completed", objeto: {} };

test("CAMINHO A — ja tem conta, depois paga: libera SEM convidar de novo", async () => {
  // Convidar de novo mandaria "crie sua senha" para quem ja tem senha.
  const r = novo();
  r.contas["quem@paga.com"] = "w-existente";
  const saida = await aplicarIntencao(
    PAGAMENTO,
    { acao: "liberar", email: "quem@paga.com", clienteId: "cus_1", assinaturaId: "sub_1" },
    deps(r)
  );
  assert.equal(saida.desfecho, "assinatura_confirmada");
  assert.deepEqual(r.convites, [], "convidou quem ja tinha conta");
  assert.deepEqual(r.liberados, ["w-existente"]);
  assert.deepEqual(r.gravadas.map((g) => g.status), ["ativa"]);
});

test("CAMINHO B — paga ANTES de ter conta: convida e ja deixa ativa", async () => {
  const r = novo();
  const saida = await aplicarIntencao(
    PAGAMENTO,
    { acao: "liberar", email: "novo@cliente.com", clienteId: "cus_2", assinaturaId: "sub_2" },
    deps(r)
  );
  assert.equal(saida.desfecho, "conta_convidada");
  assert.deepEqual(r.convites, ["novo@cliente.com"]);
  assert.deepEqual(r.gravadas.map((g) => g.status), ["ativa"]);
  // E o e-mail de boas-vindas precisa ser o da conta NOVA, que fala da senha.
  assert.equal(r.avisos[0].tipo, "boas-vindas");
  assert.equal(r.avisos[0].contaNova, true);
});

test("no caminho B a assinatura fica ATIVA antes de a pessoa criar a senha", async () => {
  // Se a conta so ficasse ativa depois da senha, a pessoa pagaria, entraria e
  // seria mandada de volta para pagar. O estado que a tranca le e a assinatura,
  // e ela ja esta gravada quando o convite sai.
  const r = novo();
  await aplicarIntencao(PAGAMENTO, { acao: "liberar", email: "novo@cliente.com", clienteId: null, assinaturaId: null }, deps(r));
  assert.equal(decidirAcesso({ admin: false, assinatura: { status: r.gravadas[0].status } }).liberado, true);
});

test("pagamento sem e-mail e sem cliente conhecido NAO inventa conta", async () => {
  // Adivinhar de quem e o pagamento seria mexer no workspace errado.
  const r = novo();
  const saida = await aplicarIntencao(PAGAMENTO, { acao: "liberar", email: null, clienteId: null, assinaturaId: null }, deps(r));
  assert.equal(saida.desfecho, "conta_nao_encontrada");
  assert.deepEqual(r.convites, []);
  assert.deepEqual(r.liberados, []);
});

test("a pagina de assinar serve os DOIS — quem nunca assinou e quem cancelou", async () => {
  const codigo = semComentarios(await fonte("src/app/reativar/page.tsx"));
  // Quem nunca assinou nao pode ler "sua assinatura foi encerrada".
  assert.ok(codigo.includes('acesso.motivo === "assinatura-cortada"'), "a pagina nao distingue os dois casos");
  assert.ok(codigo.includes("Assine para começar a usar o NEXO."), "falta o titulo de quem nunca assinou");
  // E a garantia aparece no ponto da decisao, nao so na landing.
  assert.ok(codigo.includes("dias de garantia"), "a garantia sumiu da tela onde a pessoa decide pagar");
});
