import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import "../scripts/ts-resolver.mjs";

// ⚠️ O PUSH DA SHOPEE — endpoint PÚBLICO que escreve no canônico. O que o
// protege é a assinatura, e ela é a única coisa entre um estranho e a base.
//
// 📌 A CHAVE DO PUSH NÃO É A `SHOPEE_PARTNER_KEY`. É própria, gerada no botão
// "Generate" do console — medido lá em 02/09/2026, com a dona do produto. Eu
// tinha assumido que era a mesma, e assunção não é medição.

const {
  verificarAssinaturaDoPush,
  interpretarPush,
  chaveDoEvento,
  FORMULAS,
} = await import("../src/lib/integrations/shopeePush.ts");

const CHAVE = "chave-de-push-de-teste";
const URL_PUSH = "https://nexoaihub.com.br/api/webhooks/shopee";
const CORPO = JSON.stringify({ shop_id: 275804987, code: 3, timestamp: 1756000000, data: { ordersn: "2609021SFBWMQV", status: "READY_TO_SHIP" } });
const assinarCom = (base, chave = CHAVE) => createHmac("sha256", chave).update(base, "utf8").digest("hex");

test("ACEITA so a assinatura da formula oficial, com a chave certa", () => {
  const boa = assinarCom(`${URL_PUSH}|${CORPO}`);
  assert.equal(
    verificarAssinaturaDoPush({ url: URL_PUSH, corpoBruto: CORPO, assinatura: boa, chaves: { push: CHAVE, app: null } }).valida,
    true);
  // Chave errada nao passa, mesmo com a formula certa.
  assert.equal(
    verificarAssinaturaDoPush({ url: URL_PUSH, corpoBruto: CORPO, assinatura: assinarCom(`${URL_PUSH}|${CORPO}`, "outra"), chaves: { push: CHAVE, app: null } }).valida,
    false);
});

test("SEM CHAVE CONFIGURADA o endpoint e FECHADO — nao ecoa, nao aceita", () => {
  // Decisao de 02/09/2026: nascer fechado e melhor que nascer ecoando. Endpoint
  // que responde 200 para qualquer um enquanto espera configuracao e porta
  // aberta com prazo que ninguem garante.
  const boa = assinarCom(`${URL_PUSH}|${CORPO}`);
  for (const chave of [null, undefined, ""]) {
    assert.equal(
      verificarAssinaturaDoPush({ url: URL_PUSH, corpoBruto: CORPO, assinatura: boa, chaves: { push: chave, app: null } }).valida,
      false, "sem chave nada pode ser aceito");
  }
  // E sem assinatura tambem nao — nem com a chave presente.
  assert.equal(
    verificarAssinaturaDoPush({ url: URL_PUSH, corpoBruto: CORPO, assinatura: null, chaves: { push: CHAVE, app: null } }).valida,
    false);
});

test("REJEITA a formula alternativa — mas DIZ qual teria batido", () => {
  // ⚠️ O ponto do desenho: a documentacao oficial nao e alcancavel daqui e as
  // fontes de terceiro se contradizem. Em vez de chutar, o endpoint falha
  // FECHADO e entrega o diagnostico. O primeiro push real diz a formula certa.
  const soCorpo = assinarCom(CORPO);
  const r = verificarAssinaturaDoPush({ url: URL_PUSH, corpoBruto: CORPO, assinatura: soCorpo, chaves: { push: CHAVE, app: null } });
  assert.equal(r.valida, false, "candidata de diagnostico NAO pode autorizar");
  assert.equal(r.formulaQueBateria, "corpo", "e tem de dizer qual bateria");
});

test("assinatura de lixo nao bate em nada e nao aponta formula nenhuma", () => {
  const r = verificarAssinaturaDoPush({ url: URL_PUSH, corpoBruto: CORPO, assinatura: "a".repeat(64), chaves: { push: CHAVE, app: null } });
  assert.equal(r.valida, false);
  assert.equal(r.formulaQueBateria, null);
});

test("so a PRIMEIRA formula autoriza — a lista nao pode virar 'aceita qualquer uma'", () => {
  // Guarda contra o afrouxamento obvio: alguem "consertar" o canal mudo fazendo
  // qualquer candidata autorizar. Isso transformaria 4 formulas em 4 chances de
  // um forjador acertar.
  assert.ok(FORMULAS.length > 1, "ha candidatas de diagnostico");
  for (const candidata of FORMULAS.slice(1)) {
    const assinatura = assinarCom(candidata.base(URL_PUSH, CORPO));
    assert.equal(
      verificarAssinaturaDoPush({ url: URL_PUSH, corpoBruto: CORPO, assinatura, chaves: { push: CHAVE, app: null } }).valida,
      false, `${candidata.nome} nao pode autorizar`);
  }
});

test("le a identidade do evento, e NAO o conteudo do pedido", () => {
  const evento = interpretarPush(JSON.parse(CORPO));
  assert.equal(evento.shopId, "275804987");
  assert.equal(evento.orderSn, "2609021SFBWMQV");
  assert.equal(evento.status, "READY_TO_SHIP");
  // Push sem os campos de identidade nao vira evento — 200 e ignorado, senao a
  // Shopee reentrega para sempre.
  assert.equal(interpretarPush({ code: 3 }), null);
  assert.equal(interpretarPush(null), null);
  assert.equal(interpretarPush("texto"), null);
});

test("a chave de dedupe INCLUI o status — senao a virada UNPAID->pago e engolida", () => {
  // ⚠️ E o evento mais importante do canal desde a decisao de 02/09: e a virada
  // de pagamento que faz o pedido ENTRAR no faturamento. Deduplicar so por
  // order_sn perderia exatamente ele.
  const base = { shop_id: "1", code: 3, timestamp: 1, data: { ordersn: "X1" } };
  const unpaid = chaveDoEvento(interpretarPush({ ...base, data: { ordersn: "X1", status: "UNPAID" } }));
  const pago = chaveDoEvento(interpretarPush({ ...base, data: { ordersn: "X1", status: "READY_TO_SHIP" } }));
  assert.notEqual(unpaid, pago, "mudanca de status tem de ser evento novo");
  // E o MESMO evento reentregue (timestamp diferente) tem de casar a mesma
  // chave — senao o dedupe nao dedupe nada.
  const reentrega = chaveDoEvento(interpretarPush({ ...base, timestamp: 999, data: { ordersn: "X1", status: "UNPAID" } }));
  assert.equal(unpaid, reentrega, "reentrega do mesmo evento nao pode virar evento novo");
});

test("o push NAO escreve a partir do corpo — busca o detalhe pelo caminho canonico", async () => {
  // Dois caminhos de escrita e como os dois divergem: o push gravaria um
  // formato, o poll outro, e a diferenca apareceria semanas depois.
  const rota = await readFile(new URL("../src/app/api/webhooks/shopee/route.ts", import.meta.url), "utf8");
  assert.ok(rota.includes("const detalhe = await getShopeeOrderDetail(conexao, [evento.orderSn]);"),
    "o conteudo tem de vir de get_order_detail, como na varredura");
  assert.ok(rota.includes("pedidos.map((pedido) => normalizeShopeeOrder(pedido)),"),
    "e passar pela MESMA normalizacao");
});

test("o push carimba last_push_at e NUNCA last_success_at", async () => {
  // 🔴 O defeito medido no webhook do ML em 02/09: ele gravava last_success_at,
  // que e a coluna do VIGIA. Varredura parada + push chegando = alarme cego.
  const rota = await readFile(new URL("../src/app/api/webhooks/shopee/route.ts", import.meta.url), "utf8");
  const codigo = rota.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(codigo.includes("SET last_push_at = now(), updated_at = now()"));
  assert.ok(!codigo.includes("last_success_at"),
    "push carimbando a coluna da varredura cega o vigia de defasagem");
  // E o webhook do ML tambem foi desacoplado, no mesmo passo.
  const ml = await readFile(new URL("../src/lib/integrations/mercadoLivreWebhook.ts", import.meta.url), "utf8");
  const codigoMl = ml.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|--).*$/gm, "");
  assert.ok(!/SET[^;]*last_success_at = now\(\)/.test(codigoMl),
    "o webhook do ML nao pode voltar a carimbar a coluna da varredura");
});

test("a rota do push esta em publicPaths — a Shopee nunca tera cookie", async () => {
  const proxy = await readFile(new URL("../src/lib/supabase/proxy.ts", import.meta.url), "utf8");
  assert.ok(proxy.includes('  "/api/webhooks/shopee",'));
});

test("a migration 0031 existe e diz que o ESCRITOR nao sobe antes do apply", async () => {
  // A trava de sequencia e o espelho do incidente da manha: la o LEITOR exigia
  // coluna que a view nao tinha; aqui o ESCRITOR exigiria coluna inexistente.
  const sql = await readFile(new URL("../migrations/0031_o_push_ganha_carimbo_proprio.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS last_push_at/);
  assert.match(sql, /N[AÃ]O PODE SUBIR ANTES DESTE APPLY/i,
    "a dependencia de sequencia tem de estar escrita na propria migration");
});

test("a chave do APP diagnostica mas NUNCA autoriza", () => {
  // 🔴 MEDIDO NO PRIMEIRO VERIFY REAL (02/09/2026): as 4 formulas deram null com
  // a push key. Hipotese forte: a Shopee assinou com a partner_key do app, a
  // unica que ela tem persistida enquanto a chave gerada nao foi salva.
  //
  // ⚠️ E a acao certa nesse caso e SALVAR a pagina do console — nao passar a
  // aceitar a chave da API como chave de push. Aceitar misturaria as duas
  // superficies que a Shopee separou de proposito: chave de API comprometida
  // passaria a permitir forjar push.
  const CHAVE_DO_APP = "partner-key-do-app";
  const assinadaComOApp = assinarCom(`${URL_PUSH}|${CORPO}`, CHAVE_DO_APP);
  const r = verificarAssinaturaDoPush({
    url: URL_PUSH, corpoBruto: CORPO, assinatura: assinadaComOApp,
    chaves: { push: CHAVE, app: CHAVE_DO_APP },
  });
  assert.equal(r.valida, false, "a chave do app NAO pode autorizar push");
  assert.equal(r.chaveQueBateria, "app", "mas o diagnostico tem de dizer que foi ela");
  assert.equal(r.formulaQueBateria, "url|corpo");
});

test("o diagnostico registra a forma do que chegou, e nenhuma chave", async () => {
  // Fecha a duvida na proxima tentativa sem precisar de outro deploy: nome do
  // header, tamanho e prefixo da assinatura recebida, a URL que a Shopee chamou
  // e o comeco do corpo. Nada disso e segredo — o remetente escreveu tudo.
  const rota = await readFile(new URL("../src/app/api/webhooks/shopee/route.ts", import.meta.url), "utf8");
  for (const campo of [
    "headerDaAssinatura,", "tamanhoDaAssinatura:", "prefixoDaAssinatura:",
    "urlQueAssinamos: url,", "urlQueRecebemos: req.nextUrl.href,", "inicioDoCorpo:", "chaveQueBateria,",
  ]) {
    assert.ok(rota.includes(campo), `o log precisa registrar ${campo}`);
  }
  // ⚠️ E NUNCA a chave, nem inteira nem em pedaco.
  const codigo = rota.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(codigo, /console\.error\([\s\S]*?chave[,:]\s*chave/,
    "a chave nunca pode ir para o log");
  assert.doesNotMatch(codigo, /prefixoDaChave|chave\.slice/, "nem um pedaco dela");
});

test("a base string usa a URL PUBLICA, nunca a da requisicao", async () => {
  // 🔴 FOI ISTO QUE QUEBROU O PRIMEIRO VERIFY (02/09/2026): req.nextUrl.href e o
  // host INTERNO atras do proxy do Fly — medido, "https://0.0.0.0:3000/api/...".
  // A Shopee assina a URL publica cadastrada no console. Hosts diferentes, HMAC
  // nunca bate, por mais certas que estejam formula e chave.
  const { urlPublicaDoPush } = await import("../src/lib/integrations/shopeePush.ts");
  assert.match(urlPublicaDoPush(), /^https:\/\/[^/]+\/api\/webhooks\/shopee$/);
  assert.ok(!urlPublicaDoPush().includes("0.0.0.0"));

  const rota = await readFile(new URL("../src/app/api/webhooks/shopee/route.ts", import.meta.url), "utf8");
  assert.ok(rota.includes("  const url = urlPublicaDoPush();"),
    "a URL assinada tem de ser a publica");
  // ⚠️ E NAO pode voltar a sair da requisicao: alem de nao bater, deixaria um
  // atacante ESCOLHER a base string — ele assina a propria URL com uma chave
  // que conhece. A URL da assinatura e a que NOS cadastramos.
  const codigo = rota.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(codigo, /const url = req\.nextUrl/,
    "a base string nunca pode vir do host que o chamador mandou");
});

test("a mensagem de VERIFY passa e nao vira pedido", () => {
  // Corpo real do verify, medido em 02/09/2026:
  //   {"code":0,"data":{"verify_info":"This is a Verification message..."}}
  // Nao tem shop_id nem ordersn: tem de ser reconhecida e ignorada (200), nunca
  // tratada como pedido nem respondida com erro.
  const verify = { code: 0, data: { verify_info: "This is a Verification message from Shopee Open Platform" } };
  assert.equal(interpretarPush(verify), null, "o verify nao e um evento de pedido");
});

test("a matriz de diagnostico ACHA a combinacao — e nunca autoriza", async () => {
  // 🔴 336 combinacoes offline deram ZERO (02/09/2026), com a formula que a
  // doutrina oficial descreve (url|corpo, chave do App, hex, Authorization).
  // Isso praticamente elimina "formula errada" e aponta para o CORPO: JSON
  // reconstruido a mao nunca e byte a byte igual ao que o servidor mandou.
  // Por isso a matriz passou a rodar no endpoint, sobre os bytes que chegaram.
  const { diagnosticarAssinatura } = await import("../src/lib/integrations/shopeePush.ts");
  const CHAVE_APP = "chave-do-app";
  const corpo = '{"code":0,"data":{"verify_info":"x"}}';
  // Cenario: a Shopee assinou corpo|url em base64 com a chave do app.
  const assinatura = createHmac("sha256", CHAVE_APP)
    .update(`${corpo}|${URL_PUSH}`, "utf8").digest("base64");
  const achado = diagnosticarAssinatura({
    urlPublica: URL_PUSH, urlDaRequisicao: "https://0.0.0.0:3000/api/webhooks/shopee",
    corpoBruto: corpo, assinatura, chaves: { push: CHAVE, app: CHAVE_APP },
  });
  assert.equal(achado, "chave=app url=publica base=corpo|url cod=base64");

  // ⚠️ E ACHAR NAO E AUTORIZAR: a mesma assinatura continua sendo recusada.
  assert.equal(
    verificarAssinaturaDoPush({
      url: URL_PUSH, corpoBruto: corpo, assinatura,
      chaves: { push: CHAVE, app: CHAVE_APP },
    }).valida,
    false, "a matriz diagnostica; so a formula oficial com a push key autoriza");
  // Assinatura que nao e de ninguem nao inventa combinacao.
  assert.equal(diagnosticarAssinatura({
    urlPublica: URL_PUSH, urlDaRequisicao: URL_PUSH, corpoBruto: corpo,
    assinatura: "b".repeat(64), chaves: { push: CHAVE, app: CHAVE_APP },
  }), null);
});

test("o log leva os BYTES EXATOS do corpo, em base64", async () => {
  // Sem isso, reproduzir offline depende de adivinhar espacamento e escape —
  // que foi exatamente o que fez 336 tentativas darem zero.
  const rota = await readFile(new URL("../src/app/api/webhooks/shopee/route.ts", import.meta.url), "utf8");
  assert.ok(rota.includes('corpoEmBase64: Buffer.from(corpoBruto, "utf8").toString("base64"),'));
  assert.ok(rota.includes("combinacaoQueBateria: assinatura"));
});
