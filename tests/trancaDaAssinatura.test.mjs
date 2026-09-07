import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// A TRANCA — decidida pela dona do produto em 07/09/2026: "vencida/cortada
// bloqueia tudo, qualquer rota do app redireciona para a reativacao".
//
// ⚠️ O QUE ESTES TESTES PROVAM E O QUE NAO PROVAM, escrito porque a diferenca ja
// custou caro aqui. Eles provam que os DOIS portoes chamam a MESMA decisao e
// agem sobre ela. Nao provam que o Postgres devolve o que se espera — isso foi
// medido a parte em 07/09/2026, com PREPARE contra o banco de producao, e o
// comportamento fim-a-fim se prova com a conta cortada de verdade depois do
// deploy. A decisao em si (a fronteira) tem teste de comportamento proprio em
// `tests/acessoDaAssinatura.test.mjs`.

test("a rota de dado NEGA quando a decisao nega — e a decisao vem de lerAcesso", async () => {
  const codigo = semComentarios(await fonte("src/lib/workspaceContext.ts"));
  // Ancorado na chamada inteira e na ramificacao, nao no identificador: casar
  // apenas "lerAcesso" ficaria verde depois de alguem apagar o if e deixar o
  // import — a familia de defeito que este projeto ja pegou tres vezes.
  assert.ok(codigo.includes("const acesso = await lerAcesso(String(workspaceId))"), "o portao das rotas nao le o acesso");
  assert.ok(codigo.includes("if (!acesso.liberado) {"), "o portao nao ramifica sobre a decisao");
  assert.ok(codigo.includes("{ status: 403 }"), "o portao nao devolve 403");
});

test("a navegacao REDIRECIONA quando a decisao nega", async () => {
  const codigo = semComentarios(await fonte("src/app/(app)/layout.tsx"));
  assert.ok(codigo.includes("const acesso = await lerAcesso(String(workspaceId))"), "a casca nao le o acesso");
  assert.ok(
    codigo.includes("if (!acesso.liberado) redirect(`/reativar?motivo=${acesso.motivo}`)"),
    "a casca nao manda para a reativacao"
  );
});

test("a pagina de reativacao fica FORA do grupo (app)", async () => {
  // Dentro do grupo, a propria tranca a barraria e mandaria para ela mesma:
  // laco de redirecionamento e nenhuma tela para quem esta cortado.
  const { access } = await import("node:fs/promises").then((m) => ({ access: m.access }));
  await access(new URL("../src/app/reativar/page.tsx", import.meta.url));
  await assert.rejects(access(new URL("../src/app/(app)/reativar/page.tsx", import.meta.url)));
});

test("a rota de checkout e a UNICA excecao nova — e ela existe", async () => {
  const codigo = semComentarios(await fonte("src/app/api/billing/checkout/route.ts"));
  // Sem esta excecao a tranca vira prisao: quem foi cortado nao consegue pagar.
  assert.ok(codigo.includes("{ allowExpiredTrial: true }"), "a rota de pagamento seria barrada pela propria tranca");
  // E o workspace continua vindo da sessao, nunca do corpo.
  assert.ok(codigo.includes("currentWorkspaceId()"), "o workspace tem de vir do escopo autenticado");
  assert.ok(!codigo.includes("body.workspaceId") && !codigo.includes("searchParams.get(\"workspace"), "workspace nao pode vir do cliente");
});

test("quem passa allowExpiredTrial esta contado — crescer essa lista e decisao, nao acidente", async () => {
  const alvos = ["src/app/api/trial/route.ts", "src/app/api/billing/checkout/route.ts"];
  let total = 0;
  for (const alvo of alvos) total += (semComentarios(await fonte(alvo)).match(/allowExpiredTrial: true/g) ?? []).length;
  // /api/trial usa duas vezes (alimenta o aviso), o checkout uma.
  assert.equal(total, 3, "mudou quem ignora a tranca — confira se a rota nova pode mesmo ignorar");
});
