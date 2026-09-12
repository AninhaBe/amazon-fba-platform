import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MARCA_DA_TENTATIVA, linhaDaTentativa,
} from "../src/lib/integrations/tiktokConexaoTentativa.ts";

// ⚠️ O DEFEITO QUE ESTE ARQUIVO REPROVA E DE 11/09/2026, e ele nao e de calculo:
// e de BECO. O primeiro vendedor real tentou conectar a loja QUATRO vezes e as
// quatro falharam. O sistema agiu certo nas quatro (a loja pertencia a outra
// conta do NEXO e o isolamento entre inquilinos recusou), mas:
//
//   - a tela dizia so "Nao foi possivel operar esta loja TikTok." — nao dizia a
//     causa nem o proximo passo;
//   - nao havia rastro NENHUM da tentativa: descobrir o que aconteceu exigiu
//     arqueologia num contador de chamadas criado para outro fim (o alerta da
//     Shopee de 29/08), porque os logs do Fly nao tem linha por requisicao;
//   - e quem chegasse pela App Store do TikTok (o app esta publicado) recebia
//     **JSON cru** — `{"error":"Faca login para continuar."}` — depois de
//     concluir o consentimento.
//
// 📌 Com 50-70 vendedores, cada um desses e um atendimento manual. A ordem da
// dona do produto foi explicita: causa raiz e nao contorno, porque "ficaria
// inviavel passar instrucao manual para 50-70 pessoas".

const fonte = (caminho) =>
  readFileSync(new URL(caminho, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const CALLBACK = fonte("../src/app/api/tiktok/callback/route.ts");
/** Assercao que PROIBE olha o fonte SEM COMENTARIOS — ver o teste la embaixo. */
const CALLBACK_SEM_COMENTARIO = CALLBACK
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

test("a linha de registro diz o desfecho e nunca vaza segredo", async (t) => {
  await t.test("🔴 desfecho e contagem aparecem", () => {
    // ⚠️ A MARCA E CONFERIDA CONTRA O LITERAL, NAO CONTRA A CONSTANTE. Comparar
    // `linha.startsWith(MARCA_DA_TENTATIVA)` parece certo e nao prova NADA: se
    // alguem esvaziar a constante, toda string comeca com "" e o teste
    // continua verde. Descoberto rodando a quebra em 12/09/2026 — lido em voz
    // alta, o teste estava correto. E a familia "casar o nome nao prova a
    // origem", na forma de constante que serve de gabarito de si mesma.
    assert.equal(MARCA_DA_TENTATIVA, "[tiktok-conexao]",
      "a marca e o que permite filtrar o log no Fly; mudar o valor quebra o diagnostico");
    const linha = linhaDaTentativa({
      desfecho: "sem_lojas", app: "publico", lojas: 0, tentativas: 3,
      workspace: "1803d1fe-2bf3-4b72-bed1-c79d8b0e640e",
    });
    assert.ok(linha.startsWith("[tiktok-conexao] "), "sem a marca nao da para filtrar no log");
    assert.match(linha, /desfecho=sem_lojas/);
    assert.match(linha, /app=publico/);
    assert.match(linha, /lojas=0/);
    assert.match(linha, /tentativas=3/);
  });

  await t.test("🔴 o workspace entra ABREVIADO, nunca inteiro", () => {
    // A regra de 02/09/2026: o que sai sem escopo e agregado, nunca
    // identificador. Aqui o prefixo serve para correlacionar duas linhas do
    // mesmo atendimento e nao para identificar o inquilino.
    const inteiro = "1803d1fe-2bf3-4b72-bed1-c79d8b0e640e";
    const linha = linhaDaTentativa({ desfecho: "conectada", workspace: inteiro });
    assert.ok(!linha.includes(inteiro), "o workspace inteiro nao pode entrar no log");
    assert.match(linha, /ws=1803d1fe/);
  });

  await t.test("🔴 campo ausente nao vira ruido", () => {
    const linha = linhaDaTentativa({ desfecho: "sem_state" });
    assert.equal(linha, "[tiktok-conexao] desfecho=sem_state");
  });
});

test("🔴 a porta da App Store explica em vez de devolver JSON cru", () => {
  // ⚠️ O app esta PUBLICADO, entao vendedor vai iniciar a instalacao por la — e
  // a autorizacao chega aqui SEM o nosso `state`. Antes desta correcao o fluxo
  // caia em `withAuthenticatedWorkspace`, que responde 401 em JSON para quem nao
  // tem sessao. Guarda por string literal, sem recorte.
  assert.ok(
    CALLBACK.includes('if (!convite && !state && (searchParams.get("code") || searchParams.get("auth_code"))) {'),
    "o callback tem de reconhecer a chegada COM codigo e SEM state antes de exigir sessao"
  );
  assert.ok(
    CALLBACK.includes('registrarTentativaDeConexao({ desfecho: "sem_state" });'),
    "a entrada por fora tambem se registra — senao ela some do diagnostico"
  );
  assert.ok(
    CALLBACK.includes("comece pelo botão Integrar aqui no NEXO"),
    "a mensagem tem de dizer o PROXIMO PASSO, nao so que deu errado"
  );
});

test("🔴 posse entre inquilinos tem mensagem propria, e ela nao entrega a outra conta", () => {
  assert.ok(
    CALLBACK.includes("if (err instanceof TiktokOwnershipConflictError) {"),
    "sem distinguir o erro de posse, a tela repete a mensagem generica do modulo"
  );
  assert.ok(
    CALLBACK.includes(
      '"Loja já conectada ao NEXO. Desconecte-a na conta onde ela está antes de conectar aqui."'
    ),
    "a redacao aprovada pela dona do produto em 12/09/2026: diz a causa E o proximo passo"
  );
  assert.ok(
    CALLBACK.includes('desfecho: "loja_de_outra_conta"'),
    "o desfecho de posse precisa aparecer no registro para o proximo caso nao virar arqueologia"
  );
});

test("🔴 lista vazia e retentada — e a mensagem para de culpar o vendedor", () => {
  assert.ok(
    CALLBACK.includes("while (shops.length === 0 && voltas < TENTATIVAS_DE_LISTAGEM) {"),
    "a retentativa existe e e condicionada a LISTA VAZIA"
  );
  assert.ok(
    CALLBACK.includes("shops = await getAuthorizedShops(tok.access_token, opcoes.app);"),
    "a retentativa precisa perguntar DE NOVO; sem a segunda chamada ela nao retenta nada"
  );
  assert.ok(
    CALLBACK.includes("A TikTok confirmou a autorização, mas ainda não liberou a loja para o NEXO."),
    "a mensagem nova diz o que aconteceu do lado da TikTok"
  );
});

test("🔴 erro NAO e retentado — repetir chamada com erro proprio so multiplica o erro", () => {
  // A retentativa cobre a hipotese de propagacao (lista vazia). Erro tem causa
  // propria: repetir seria bater na API por nada e mascarar o diagnostico.
  const laco = CALLBACK_SEM_COMENTARIO.slice(
    CALLBACK_SEM_COMENTARIO.indexOf("let voltas = 1;"),
    CALLBACK_SEM_COMENTARIO.indexOf("const accessExp")
  );
  assert.ok(laco.length > 0, "o laco de retentativa precisa existir para esta guarda valer");
  assert.ok(!laco.includes("catch"), "o laco nao pode engolir erro: erro sai, lista vazia retenta");
});

test("🔴 a frase que culpava o vendedor NAO volta", () => {
  // ⚠️ ASSERCAO QUE PROIBE OLHA O FONTE SEM COMENTARIOS — e aqui isso nao e
  // zelo: o comentario que explica a correcao CITA a frase proibida, palavra por
  // palavra. Casar o fonte cru reprovaria a propria explicacao, e alguem
  // "consertaria" apagando o comentario que ensina.
  assert.ok(
    !CALLBACK_SEM_COMENTARIO.includes("Verifique a conta do vendedor"),
    "a mensagem antiga jogava no vendedor um problema que nao e dele e nao dizia o que fazer"
  );
});

test("🔴 todo desfecho do callback se registra — lista FECHADA", () => {
  // ⚠️ LISTA FECHADA, e esta escrito aqui o que ela NAO cobre: desfecho novo
  // criado depois de 12/09/2026 entra nesta lista no MESMO commit. Senao a
  // guarda fica verde enquanto um caminho novo volta a ser invisivel — que e
  // exatamente o defeito que este arquivo existe para impedir.
  for (const desfecho of [
    "conectada", "sem_lojas", "loja_de_outra_conta", "sem_state",
    "state_invalido", "codigo_ausente", "recusado_na_tiktok", "erro",
  ]) {
    assert.ok(
      CALLBACK.includes(`desfecho: "${desfecho}"`),
      `o desfecho "${desfecho}" precisa ser registrado no callback`
    );
  }
});
