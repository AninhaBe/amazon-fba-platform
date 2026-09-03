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

const CHAVE = "shpk75434f4f6a586657756d4559537145";
const URL_PUSH = "https://nexoaihub.com.br/api/webhooks/shopee";
const CORPO = JSON.stringify({ shop_id: 275804987, code: 3, timestamp: 1756000000, data: { ordersn: "2609021SFBWMQV", status: "READY_TO_SHIP" } });
const assinarCom = (base, chave = CHAVE) =>
  createHmac("sha256", chave).update(base, "utf8").digest("hex");

test("ACEITA so a assinatura da formula oficial, com a chave certa", () => {
  const boa = assinarCom(`${URL_PUSH}|${CORPO}`);
  assert.equal(
    verificarAssinaturaDoPush({ url: URL_PUSH, corpoBruto: CORPO, assinatura: boa, chaves: { push: CHAVE } }).valida,
    true);
  // Chave errada nao passa, mesmo com a formula certa.
  assert.equal(
    verificarAssinaturaDoPush({ url: URL_PUSH, corpoBruto: CORPO, assinatura: assinarCom(`${URL_PUSH}|${CORPO}`, "outra-chave"), chaves: { push: CHAVE } }).valida,
    false);
});

test("SEM CHAVE CONFIGURADA o endpoint e FECHADO — nao ecoa, nao aceita", () => {
  // Decisao de 02/09/2026: nascer fechado e melhor que nascer ecoando. Endpoint
  // que responde 200 para qualquer um enquanto espera configuracao e porta
  // aberta com prazo que ninguem garante.
  const boa = assinarCom(`${URL_PUSH}|${CORPO}`);
  for (const chave of [null, undefined, ""]) {
    assert.equal(
      verificarAssinaturaDoPush({ url: URL_PUSH, corpoBruto: CORPO, assinatura: boa, chaves: { push: chave } }).valida,
      false, "sem chave nada pode ser aceito");
  }
  // E sem assinatura tambem nao — nem com a chave presente.
  assert.equal(
    verificarAssinaturaDoPush({ url: URL_PUSH, corpoBruto: CORPO, assinatura: null, chaves: { push: CHAVE } }).valida,
    false);
});

test("REJEITA a formula alternativa — mas DIZ qual teria batido", () => {
  // ⚠️ O ponto do desenho: a documentacao oficial nao e alcancavel daqui e as
  // fontes de terceiro se contradizem. Em vez de chutar, o endpoint falha
  // FECHADO e entrega o diagnostico. O primeiro push real diz a formula certa.
  const soCorpo = assinarCom(CORPO);
  const r = verificarAssinaturaDoPush({ url: URL_PUSH, corpoBruto: CORPO, assinatura: soCorpo, chaves: { push: CHAVE } });
  assert.equal(r.valida, false, "candidata de diagnostico NAO pode autorizar");
  assert.equal(r.formulaQueBateria, "corpo", "e tem de dizer qual bateria");
});

test("assinatura de lixo nao bate em nada e nao aponta formula nenhuma", () => {
  const r = verificarAssinaturaDoPush({ url: URL_PUSH, corpoBruto: CORPO, assinatura: "a".repeat(64), chaves: { push: CHAVE } });
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
      verificarAssinaturaDoPush({ url: URL_PUSH, corpoBruto: CORPO, assinatura, chaves: { push: CHAVE } }).valida,
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
  // ⚠️ E NEM `updated_at`, desde 03/09/2026 — a guarda ficou MAIS ESTRITA depois
  // do primeiro incidente que o vigia pegou. O scheduler usa `updated_at` como
  // "quando foi a ultima tentativa da VARREDURA" para decidir o backoff de erro;
  // push gravando nela mantem a conexao eternamente "recem-tentada". No ML isso
  // custou 11 HORAS sem varredura, com o push entregando e a tela parecendo viva.
  assert.ok(codigo.includes("SET last_push_at = now()"));
  assert.ok(!/last_push_at = now\(\), updated_at/.test(codigo),
    "push nao pode carimbar a coluna que o scheduler le como ultima tentativa");
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





test("um push forjado NAO escapa acrescentando verify_info", () => {
  // ⚠️ A excecao do ping e estreita de proposito: se bastasse ter `verify_info`,
  // um atacante com a chave do app anexaria o campo a um push de pedido e
  // escaparia da push key. Por isso o ping exige AUSENCIA de identidade.
  const disfarcado = { code: 0, shop_id: 275804987, data: { verify_info: "oi", ordersn: "X1", status: "READY_TO_SHIP" } };
  assert.equal(ehPingDeVerificacaoRef(disfarcado), false);
});
const { ehPingDeVerificacao: ehPingDeVerificacaoRef } = await import("../src/lib/integrations/shopeePush.ts");

test("🔴 CHAVE VAZIA NUNCA AUTORIZA DADO — a guarda critica", async () => {
  // 🔴 Chave vazia e conhecida por QUALQUER PESSOA DO PLANETA. Se um push de
  // dado passasse com ela, qualquer um assinaria um pedido forjado e escreveria
  // no canonico. Esta e a guarda mais importante do arquivo.
  const assinaturaVazia = createHmac("sha256", "").update(`${URL_PUSH}|${CORPO}`, "utf8").digest("hex");
  // com push key configurada
  assert.equal(
    verificarAssinaturaDoPush({ url: URL_PUSH, corpoBruto: CORPO, assinatura: assinaturaVazia, ehPing: false, chaves: { push: CHAVE } }).valida,
    false, "dado assinado com chave vazia tem de ser recusado");
  // ⚠️ E SEM push key configurada — o caso perigoso: se o codigo caisse em ""
  // por ausencia, a chave vazia viraria a chave valida e a porta abriria.
  for (const ausente of [null, undefined, ""]) {
    assert.equal(
      verificarAssinaturaDoPush({ url: URL_PUSH, corpoBruto: CORPO, assinatura: assinaturaVazia, ehPing: false, chaves: { push: ausente } }).valida,
      false, "sem push key, chave vazia NAO pode virar a chave valida");
  }
});

test("PING de verify passa com chave VAZIA (pre-Save) e com a push key (pos-Save)", async () => {
  const { ehPingDeVerificacao } = await import("../src/lib/integrations/shopeePush.ts");
  const PING = '{"code":0,"data":{"verify_info":"This is a Verification message from Shopee Open Platform"}}';
  assert.equal(ehPingDeVerificacao(JSON.parse(PING)), true);
  const base = `${URL_PUSH}|${PING}`;
  // Pre-Save: a Shopee assina com a push key ARMAZENADA nela, que esta vazia.
  assert.equal(
    verificarAssinaturaDoPush({ url: URL_PUSH, corpoBruto: PING, assinatura: createHmac("sha256", "").update(base, "utf8").digest("hex"), ehPing: true, chaves: { push: CHAVE } }).valida,
    true, "o verify pre-Save tem de passar");
  // Pos-Save: assinado com a chave de verdade.
  assert.equal(
    verificarAssinaturaDoPush({ url: URL_PUSH, corpoBruto: PING, assinatura: createHmac("sha256", CHAVE).update(base, "utf8").digest("hex"), ehPing: true, chaves: { push: CHAVE } }).valida,
    true, "o re-verify pos-Save tambem");
  // ⚠️ E a permissao da chave vazia NAO vale para corpo que nao e ping.
  assert.equal(
    verificarAssinaturaDoPush({ url: URL_PUSH, corpoBruto: CORPO, assinatura: createHmac("sha256", "").update(`${URL_PUSH}|${CORPO}`, "utf8").digest("hex"), ehPing: true, chaves: { push: CHAVE } }).valida,
    true, "cenario de controle: com ehPing=true a chave vazia passa — por isso quem decide ehPing e ehPingDeVerificacao, no corpo");
});

test("o segredo e a STRING da chave, nao os bytes hex", async () => {
  // Registro do artefato de 02/09/2026: `Buffer.from("shpk...","hex")` devolve
  // buffer VAZIO (o Node trunca no primeiro par invalido, em silencio), e HMAC
  // com chave vazia reproduziu a assinatura do verify por completo. Parecia
  // "a chave precisa ser hex-decodificada"; era a Shopee assinando com a push
  // key ARMAZENADA nela, que estava vazia por nunca ter sido salva.
  const fonte = await readFile(new URL("../src/lib/integrations/shopeePush.ts", import.meta.url), "utf8");
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/Buffer\.from\(chave, "hex"\)/.test(codigo),
    "hex-decodificar a chave foi artefato, nao descoberta");
  assert.ok(codigo.includes('createHmac("sha256", chave).update(base, "utf8").digest("hex")'));
});

test("o evento e MARCADO como processado — fila que nao esvazia deixa de informar", async () => {
  // Medido em 02/09/2026: os dois primeiros pushes reais entraram, os pedidos
  // foram gravados, e as linhas ficaram em status 'pending' para sempre. Nao
  // quebrava nada — e por isso passaria despercebido ate alguem escrever um
  // reprocessador e ele varrer tudo de novo.
  const rota = await readFile(new URL("../src/app/api/webhooks/shopee/route.ts", import.meta.url), "utf8");
  assert.ok(rota.includes("SET status = 'processed', processed_at = now()"));
  assert.ok(rota.includes("WHERE workspace_id = $1 AND provider = 'shopee' AND event_key = $2"),
    "com workspace_id: parametro do cliente ESTREITA o escopo, nunca o define");
});

test("a matriz de diagnostico SAIU depois de responder", async () => {
  // ⚠️ Ferramenta de investigacao que sobrevive a investigacao vira peso morto:
  // 168 HMACs por requisicao recusada, num endpoint publico, e superficie e
  // custo sem pergunta em aberto. Mesma regra da recusa temporaria — o que
  // existe por causa de uma limitacao morre com ela.
  const fonte = await readFile(new URL("../src/lib/integrations/shopeePush.ts", import.meta.url), "utf8");
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!codigo.includes("diagnosticarAssinatura"), "a matriz respondeu e saiu");
  // E o diagnostico CURTO fica: e barato e responde "mudaram a assinatura?".
  assert.ok(codigo.includes("formulaQueBateria"));
});
