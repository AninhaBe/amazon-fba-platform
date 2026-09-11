import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appDaConexao } from "../src/lib/integrations/tiktokApps.ts";

// ⚠️ O DEFEITO QUE ESTE ARQUIVO REPROVA FOI MEDIDO EM 11/09/2026, no dia em que
// o app publico do TikTok foi publicado no Service Market e a dona do produto
// pediu o link de reautorizacao da loja.
//
// O app viajava dentro do `state` assinado do convite e chegava ao callback,
// que trocava o `auth_code` com o par certo. So que o app NUNCA ERA GRAVADO:
// `workspace_tiktok_shops` nao tinha a coluna, e `appDaConexao()` so era usado
// para ler o app de DENTRO do convite. A partir do instante seguinte a
// autorizacao, ninguem sabia de qual app o token era — e todo caminho que
// precisa da credencial caia no `APP_PADRAO`, que e o CUSTOM:
//
//   getAuthorizedShops  -> tiktokFetch sem app  -> assina com a chave do custom
//   tiktokFinancialApi  -> tiktokFetch sem app  -> assina com a chave do custom
//   tiktokStore (x2)    -> refreshAccessToken sem app -> renova com o custom
//
// Resultado se a Ana tivesse clicado no link: token do PUBLICO usado com a
// chave do CUSTOM. Mesma familia do `undefined` em producao que a Amazon ja
// pagou (`.env` x `workspace_accounts`). A correcao e a migration 0033.
//
// 📌 POR QUE ESTAS GUARDAS OLHAM O FONTE: o alvo e a PROPAGACAO de um argumento
// por rotas e adaptadores que so existem com credencial real e loja conectada.
// Nao da para exercitar o comportamento sem os dois apps no ar. Entao a regra da
// casa vale inteira: a assercao casa a CHAMADA por completo, nunca o
// identificador solto, e cada uma foi vista VERMELHA antes de entrar (removendo
// o argumento e rodando), nao lida em voz alta.
//
// ⚠️ E A LISTA ABAIXO E FECHADA — so cobre o que alguem lembrou de listar. Ela
// NAO cobre: chamador novo de `tiktokFetch`/`refreshAccessToken` criado depois
// desta data, nem endpoint de negocio novo em `tiktok.ts`. Quando qualquer um
// dos dois nascer, a entrada correspondente entra aqui no mesmo commit — senao
// a guarda continua verde enquanto o defeito volta por uma porta nova.

// ⚠️ CRLF NORMALIZADO NA LEITURA, e isto nao e detalhe. A primeira versao desta
// guarda ficou vermelha porque o repo grava CRLF no disco e a assercao casava
// `\n` — teste vermelho por motivo que NAO e o produto, que e o jeito de ensinar
// alguem a ignorar vermelho. Normalizar aqui deixa toda assercao multilinha
// abaixo valer pelo que ela diz.
const fonte = (caminho) =>
  readFileSync(new URL(caminho, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const TIKTOK = fonte("../src/lib/tiktok.ts");
const STORE = fonte("../src/lib/tiktokStore.ts");
const SYNC = fonte("../src/lib/integrations/tiktokSync.ts");
const FINANCEIRO = fonte("../src/lib/integrations/tiktokFinancialApi.ts");
const CALLBACK = fonte("../src/app/api/tiktok/callback/route.ts");
const MIGRATION = fonte("../migrations/0033_a_conexao_do_tiktok_diz_de_qual_app_ela_e.sql");

test("todo endpoint de negocio assina com o app DA LOJA, nao com o padrao", () => {
  // Os quatro endpoints de `tiktok.ts` recebem `shop: TiktokShopRef` e montam a
  // chamada. Casar `app: shop.app` solto passaria com a linha existindo num so
  // deles — por isso a contagem, que e o que prova "todos".
  const ocorrencias = TIKTOK.split("app: shop.app,").length - 1;
  assert.equal(
    ocorrencias,
    4,
    "os 4 endpoints de negocio de tiktok.ts devem propagar `app: shop.app`. " +
      "Se voce ADICIONOU um endpoint, suba este numero no mesmo commit; " +
      "se ele CAIU, algum endpoint voltou a assinar com a chave do custom."
  );
});

test("a primeira chamada assinada do consentimento usa o app que autorizou", () => {
  // Era aqui que a etapa 2 quebrava: `auth_code` trocado com o par do publico e
  // a chamada seguinte assinada com o custom.
  assert.ok(
    CALLBACK.includes("const shops = await getAuthorizedShops(tok.access_token, opcoes.app);"),
    "o callback deve passar `opcoes.app` a getAuthorizedShops — sem isso a " +
      "autorizacao pelo app publico falha logo apos a troca do auth_code."
  );
  assert.ok(
    TIKTOK.includes("export async function getAuthorizedShops(\n  accessToken: string,\n  app: AppDoTikTok = APP_PADRAO\n)"),
    "getAuthorizedShops precisa aceitar o app; sem o parametro, o callback nao " +
      "tem como dizer com qual par assinar."
  );
});

test("o callback GRAVA de qual app a conexao e", () => {
  // Sem isto, o refresh do dia seguinte adivinha — e adivinhar erra em silencio.
  assert.ok(
    CALLBACK.includes("app: opcoes.app,"),
    "saveTiktokAuthorization deve receber `app: opcoes.app`; sem gravar, " +
      "a conexao do publico vira uma conexao sem dono conhecido."
  );
});

test("os DOIS refresh renovam com o par da propria conexao", () => {
  // ⚠️ Assercao por CAMINHO, uma para cada: os dois existem por razoes
  // diferentes (o coordenado por lease e o direto), e a quebra de um passaria
  // despercebida se a guarda casasse so "refreshAccessToken" em algum lugar.
  assert.ok(
    STORE.includes("refresh: (signal) => refreshAccessToken(previousRefreshToken, signal, latest.app),"),
    "o refresh coordenado por lease deve passar `latest.app`."
  );
  assert.ok(
    STORE.includes("token = await refreshAccessToken(latest.refreshToken, undefined, latest.app);"),
    "o refresh direto (sem banco) deve passar `latest.app`."
  );
});

test("quem monta um TiktokShopRef copia o app da loja", () => {
  // Os dois unicos sitios que constroem um ref a partir da loja guardada. Um ref
  // sem `app` cai no custom em silencio — o campo e opcional no tipo de
  // proposito, porque a conexao de hoje E custom.
  assert.ok(
    SYNC.includes("return { accessToken: loja.accessToken, shopCipher: loja.shopCipher, app: loja.app };"),
    "tiktokSync monta o ref do sync: sem `app: loja.app` toda leitura de " +
      "pedido do app publico seria assinada com a chave do custom."
  );
  assert.ok(
    FINANCEIRO.includes("accessToken:shop.accessToken,shopCipher:shop.shopCipher,app:shop.app}"),
    "tiktokFinancialApi e o unico chamador de tiktokFetch fora do modulo: " +
      "sem `app:shop.app` a conciliacao financeira assina com o custom."
  );
});

test("linha gravada antes da 0033 e lida como CUSTOM, que e a verdade dela", () => {
  // Comportamento de verdade, nao fonte: a conexao viva (shop
  // 7494291387899806731) foi autorizada pelo app custom em 10/08/2026 e nao tem
  // valor na coluna. Le-la como `publico` quebraria o refresh dela no dia
  // seguinte; `null` nao pode virar "desconhecido" aqui porque o fato e sabido.
  assert.equal(appDaConexao(null), "custom");
  assert.equal(appDaConexao(undefined), "custom");
  assert.equal(appDaConexao(""), "custom");
  assert.equal(appDaConexao("publico"), "publico");
  // Valor estranho nao vira app estranho.
  assert.equal(appDaConexao("PUBLICO"), "custom");
  assert.equal(appDaConexao({ app: "publico" }), "custom");
});

test("a coluna nasce com lista FECHADA de valores", () => {
  // O oposto da lista negra que este projeto matou em 31/08/2026
  // (`fee_type NOT IN (...)`), onde o desconhecido entrava por padrao.
  assert.ok(
    MIGRATION.includes("CHECK (app IN ('custom', 'publico'))"),
    "a migration deve restringir os valores da coluna; sem o CHECK, um app " +
      "desconhecido entra e so falha na hora de assinar."
  );
  assert.ok(
    MIGRATION.includes("ADD COLUMN IF NOT EXISTS app text NOT NULL DEFAULT 'custom'"),
    "a coluna e aditiva e o default e `custom` — a verdade da conexao viva."
  );
});

test("a migration diz QUEM LE isso agora, com a licao da view no caminho", () => {
  // Portao de 01/09 e 02/09/2026: migration que mexe em onde o dado mora
  // responde "quem le isso agora?", e coluna nova nao alcanca view existente.
  // ⚠️ Assercao que PROIBE olha o fonte SEM COMENTARIOS — mas aqui o alvo E o
  // comentario, entao ela EXIGE, e por isso pode casar o texto cru.
  assert.match(
    MIGRATION,
    /QUEM LÊ ISSO AGORA/,
    "toda migration que mexe em onde o dado mora responde a pergunta obrigatoria."
  );
  assert.match(
    MIGRATION,
    /nenhuma view seleciona de `workspace_tiktok_shops`/,
    "a 0029 custou o dashboard da Amazon por horas: view nao herda coluna. " +
      "A migration tem de registrar que o caminho do leitor foi conferido."
  );
});
