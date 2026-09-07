import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import "../scripts/ts-resolver.mjs";

const {
  avaliarOrigemDoWebhook,
  convivenciaVencida,
  FIM_DA_CONVIVENCIA,
} = await import("../src/lib/integrations/webhookMlToken.ts");

const rota = () => readFile(new URL("../src/app/api/webhooks/mercado-livre/route.ts", import.meta.url), "utf8");
const semComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const SEGREDO = "segredo-de-verdade";
const DENTRO = new Date(Date.parse(FIM_DA_CONVIVENCIA) - 60_000);
const DEPOIS = new Date(Date.parse(FIM_DA_CONVIVENCIA) + 60_000);

// O WEBHOOK DO ML ESTAVA ABERTO — qualquer um podia postar nele. O ML nao assina
// as notificacoes (a Shopee assina, com HMAC), entao o unico segredo possivel e
// um token na URL cadastrada no DevCenter.

test("token correto entra; token errado NAO entra, nem durante a convivencia", () => {
  // Quem manda token ERRADO nao e o chamador legado: o legado nao manda token
  // nenhum. Deixar token errado passar durante a janela seria abrir a porta que
  // a janela existe para nao arrombar.
  const ok = avaliarOrigemDoWebhook({ tokenRecebido: SEGREDO, tokenEsperado: SEGREDO, agora: DENTRO });
  assert.equal(ok.aceito, true);
  assert.equal(ok.via, "token");

  const errado = avaliarOrigemDoWebhook({ tokenRecebido: "chute", tokenEsperado: SEGREDO, agora: DENTRO });
  assert.equal(errado.aceito, false, "token errado passou durante a convivencia");
  assert.equal(errado.via, "recusado");
});

test("SEM token entra so ate a data declarada — e depois nao entra mais", () => {
  // A janela existe porque a URL nova precisa ser cadastrada no DevCenter do ML
  // antes de a antiga fechar, e o cadastro e ato de pessoa.
  const dentro = avaliarOrigemDoWebhook({ tokenRecebido: null, tokenEsperado: SEGREDO, agora: DENTRO });
  assert.equal(dentro.aceito, true);
  assert.equal(dentro.via, "convivencia", "a via precisa dizer que foi pela janela, nao pelo token");

  const depois = avaliarOrigemDoWebhook({ tokenRecebido: null, tokenEsperado: SEGREDO, agora: DEPOIS });
  assert.equal(depois.aceito, false, "a janela nao fechou sozinha na data declarada");
});

test("A JANELA TEM PRAZO E ELE E CONFERIVEL — este teste fica vermelho sozinho", () => {
  // ⚠️ ESTE E O TESTE QUE IMPEDE A SALVAGUARDA TEMPORARIA DE VIRAR PERMANENTE.
  // Em 31/08/2026 uma recusa temporaria da Shopee sobreviveu 4 horas a
  // limitacao que a justificava, e o teste que a guardava passou a DEFENDER o
  // defeito. Aqui e o contrario: quando a data passar, este teste fica vermelho
  // e obriga alguem a decidir — fechar a janela ou mover a data com motivo.
  assert.ok(
    !convivenciaVencida(),
    `A janela de convivencia do webhook do ML venceu em ${FIM_DA_CONVIVENCIA}. ` +
      "Feche-a: confirme que WEBHOOK_ML_TOKEN esta no Fly, que a URL com token esta cadastrada " +
      "no DevCenter do ML e que chegou push real por ela — e entao remova a janela. " +
      "Se ainda nao deu, mova a data com motivo escrito, mas NAO apague esta guarda."
  );
});

test("sem segredo configurado a rota continua aberta — e isso e escolha, com aviso", () => {
  // Recusar aqui fecharia o webhook do ML no instante do deploy, antes de
  // alguem ter como configurar a env. O modo de falha certo para "ainda nao
  // montamos a fechadura" e a porta continuar como estava, gritando no log.
  for (const vazio of [null, undefined, "", "   "]) {
    const d = avaliarOrigemDoWebhook({ tokenRecebido: null, tokenEsperado: vazio, agora: DEPOIS });
    assert.equal(d.aceito, true);
    assert.equal(d.via, "sem-token-configurado");
  }
});

test("a comparacao do token nao vaza pelo tempo, e nao aceita prefixo", () => {
  // Sem tempo constante, o tempo de resposta entrega o tamanho do prefixo certo.
  assert.equal(avaliarOrigemDoWebhook({ tokenRecebido: SEGREDO.slice(0, -1), tokenEsperado: SEGREDO, agora: DENTRO }).aceito, false);
  assert.equal(avaliarOrigemDoWebhook({ tokenRecebido: SEGREDO + "x", tokenEsperado: SEGREDO, agora: DENTRO }).aceito, false);
  assert.equal(avaliarOrigemDoWebhook({ tokenRecebido: "", tokenEsperado: SEGREDO, agora: DENTRO }).aceito, false);
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
  // varredura parada como saudavel — exatamente a cegueira que custou 11 horas
  // em 03/09/2026, so que provocada de fora.
  //
  // Comparacao de POSICAO, nao de existencia: os dois trechos podem existir e
  // estar na ordem errada.
  const codigo = semComentarios(await rota());
  const decide = codigo.indexOf("avaliarOrigemDoWebhook({");
  const recusa = codigo.indexOf("if (!origem.aceito) return naoEncontrado();");
  const leCorpo = codigo.indexOf("await req.json()");
  const enfileira = codigo.indexOf("enqueueMercadoLivreNotification(");
  assert.ok(decide > -1 && recusa > -1 && leCorpo > -1 && enfileira > -1, "sumiu um dos passos");
  assert.ok(decide < recusa, "decide depois de recusar?");
  assert.ok(recusa < leCorpo, "le o corpo antes de recusar a origem");
  assert.ok(recusa < enfileira, "enfileira antes de recusar a origem");
});

test("a resposta NAO revela se o user_id casou com alguma conexao", async () => {
  // O oraculo de enumeracao: `queued` era 0 para id desconhecido e >0 para
  // conhecido. Bastava variar o id ate a resposta mudar para descobrir quais
  // vendedores usam o NEXO — dado de cliente, numa rota publica.
  const codigo = semComentarios(await rota());
  assert.ok(codigo.includes("{ received: true }"), "a resposta mudou de forma");
  assert.ok(!codigo.includes("queued: queued.length"), "a contagem de enfileirados voltou a resposta");
});

test("o GET de diagnostico nao diz mais nada alem de service e configured", async () => {
  // Cada campo a mais e um campo que ajuda quem esta sondando: se ha token
  // configurado, quando a janela fecha, quantas conexoes existem.
  const codigo = semComentarios(await rota());
  const corpo = codigo.slice(codigo.indexOf("export async function GET()"), codigo.indexOf("function naoEncontrado"));
  assert.ok(!/token/i.test(corpo), "o GET passou a falar de token");
  assert.ok(!/CONVIVENCIA|convivencia/i.test(corpo), "o GET passou a revelar a janela");
  assert.ok(!/connection|workspace|user_id/i.test(corpo), "o GET passou a revelar dado de conexao");
});
