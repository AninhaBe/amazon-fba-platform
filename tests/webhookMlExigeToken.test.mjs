import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import "../scripts/ts-resolver.mjs";

const { avaliarOrigemDoWebhook } = await import("../src/lib/integrations/webhookMlToken.ts");

const rota = () => readFile(new URL("../src/app/api/webhooks/mercado-livre/route.ts", import.meta.url), "utf8");
const semComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const SEGREDO = "segredo-de-verdade";

// O WEBHOOK DO ML ESTAVA ABERTO — qualquer um podia postar nele. O ML nao assina
// as notificacoes (a Shopee assina, com HMAC), entao o unico segredo possivel e
// um token na URL cadastrada no DevCenter.
//
// ⚠️ ESTE ARQUIVO JA MUDOU DE INTENCAO, no mesmo dia, e o registro fica aqui
// porque teste que inverte sem dizer por que e o primeiro a ser afrouxado
// depois:
//
//   07/09 tarde:  requisicao SEM token ENTRAVA (janela de convivencia com prazo
//                 declarado em FIM_DA_CONVIVENCIA), e havia um teste que ficava
//                 vermelho sozinho na data para obrigar o fechamento.
//   07/09 noite:  a janela morreu com os quatro passos cumpridos e MEDIDOS —
//                 env no Fly, URL no DevCenter, 33 pushes "aceito COM token" e
//                 ZERO "SEM token" nos logs do Fly, e entao a remocao.
//
// A guarda de data saiu junto: ela existia para forcar esta decisao, e a decisao
// foi tomada. Manter uma guarda que ja cumpriu o proposito e ruido.

test("token correto entra", () => {
  const d = avaliarOrigemDoWebhook({ tokenRecebido: SEGREDO, tokenEsperado: SEGREDO });
  assert.equal(d.aceito, true);
  assert.equal(d.via, "token");
});

test("SEM token NAO entra mais — a janela de convivencia acabou", () => {
  // Ate a tarde de 07/09/2026 isto era `true`. A inversao e o produto de uma
  // medicao, nao de uma opiniao.
  const d = avaliarOrigemDoWebhook({ tokenRecebido: null, tokenEsperado: SEGREDO });
  assert.equal(d.aceito, false);
  assert.equal(d.via, "recusado");
});

test("token errado nao entra", () => {
  assert.equal(avaliarOrigemDoWebhook({ tokenRecebido: "chute", tokenEsperado: SEGREDO }).aceito, false);
});

test("SEM segredo configurado, NINGUEM entra — fechadura sem chave nao e porta aberta", () => {
  // Enquanto a janela existiu, env ausente deixava passar: era a unica forma de
  // nao fechar o webhook antes de alguem ter como configura-la. Com a janela
  // fechada, a permissao morre junto — foi a amarra exigida no visto da decisao.
  for (const vazio of [null, undefined, "", "   "]) {
    assert.equal(avaliarOrigemDoWebhook({ tokenRecebido: null, tokenEsperado: vazio }).aceito, false);
    assert.equal(avaliarOrigemDoWebhook({ tokenRecebido: "qualquer", tokenEsperado: vazio }).aceito, false);
  }
});

test("a comparacao do token nao vaza pelo tempo, e nao aceita prefixo", () => {
  // Sem tempo constante, o tempo de resposta entrega o tamanho do prefixo certo.
  for (const chute of [SEGREDO.slice(0, -1), SEGREDO + "x", "", " " + SEGREDO]) {
    assert.equal(avaliarOrigemDoWebhook({ tokenRecebido: chute, tokenEsperado: SEGREDO }).aceito, false, `"${chute}" passou`);
  }
});

test("nao sobrou nenhum resto da janela no codigo", async () => {
  // ⚠️ Salvaguarda temporaria que sobrevive a limitacao que a justificou e a
  // familia de defeito que este projeto ja pagou caro (31/08/2026). O oposto
  // tambem vale: resto de janela morta confunde quem ler depois.
  const politica = semComentarios(
    await readFile(new URL("../src/lib/integrations/webhookMlToken.ts", import.meta.url), "utf8")
  );
  assert.ok(!politica.includes("FIM_DA_CONVIVENCIA"), "a constante da janela ficou no codigo");
  assert.ok(!politica.includes("convivencia"), "sobrou a via de convivencia na politica");
  const codigo = semComentarios(await rota());
  assert.ok(!codigo.includes("convivencia"), "a rota ainda fala em convivencia");
  assert.ok(!codigo.includes("agora:"), "a rota ainda passa a data para a politica");
});

test("origem recusada devolve 404 SECO — 401 e 403 confirmam que a rota existe", async () => {
  const codigo = semComentarios(await rota());
  assert.ok(codigo.includes('new NextResponse("Not Found", { status: 404 })'), "a recusa nao e 404");
  assert.ok(!codigo.includes("status: 401"), "a rota devolve 401 em algum caminho");
  assert.ok(!codigo.includes("status: 403"), "a rota devolve 403 em algum caminho");
});

test("a origem e conferida ANTES de ler o corpo — senao o forjado carimba last_push_at", async () => {
  // ⚠️ ESTA E A ORDEM QUE PROTEGE O VIGIA. `last_push_at` e carimbado dentro do
  // processamento; se um evento forjado chegasse la, um atacante mascararia
  // varredura parada como saudavel.
  //
  // Comparacao de POSICAO, e com PRESENCA exigida antes: `indexOf` devolve -1
  // para o que nao existe, e -1 e menor que tudo — sem exigir presenca, a
  // asserção fica verde justamente quando o codigo muda de forma.
  const codigo = semComentarios(await rota());
  const decide = codigo.indexOf("avaliarOrigemDoWebhook({");
  const recusa = codigo.indexOf("if (!origem.aceito) return naoEncontrado();");
  const leCorpo = codigo.indexOf("await req.text()");
  const enfileira = codigo.indexOf("enqueueMercadoLivreNotification(");
  assert.ok(decide > -1 && recusa > -1 && leCorpo > -1 && enfileira > -1, "sumiu um dos passos");
  assert.ok(decide < recusa, "decide depois de recusar?");
  assert.ok(recusa < leCorpo, "le o corpo antes de recusar a origem");
  assert.ok(recusa < enfileira, "enfileira antes de recusar a origem");
});

test("a resposta NAO revela se o user_id casou com alguma conexao", async () => {
  const codigo = semComentarios(await rota());
  assert.ok(codigo.includes("{ received: true }"), "a resposta mudou de forma");
  assert.ok(!codigo.includes("queued: queued.length"), "a contagem de enfileirados voltou a resposta");
});

test("o GET de diagnostico nao diz mais nada alem de service e configured", async () => {
  const codigo = semComentarios(await rota());
  const corpo = codigo.slice(codigo.indexOf("export async function GET()"), codigo.indexOf("function naoEncontrado"));
  assert.ok(!/token/i.test(corpo), "o GET passou a falar de token");
  assert.ok(!/connection|workspace|user_id/i.test(corpo), "o GET passou a revelar dado de conexao");
});
