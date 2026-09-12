import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APP_DA_AUTORIZACAO, APP_DE_LINHA_ANTIGA, appDaAutorizacao, appDaConexao,
  appPublicoConfigurado, credenciaisDoApp,
} from "../src/lib/integrations/tiktokApps.ts";
import { criarConviteTiktok, validarConviteTiktok } from "../src/lib/tiktokInvite.ts";

// ⚠️ ESTE ARQUIVO JA MUDOU DE INTENCAO DUAS VEZES. Sem esta nota, quem abrir o
// vermelho daqui a um mes nao tem como saber se a guarda esta certa e o codigo
// errado, ou o contrario.
//
//   04/09/2026 — NASCEU cobrando que a convivencia dos dois apps tivesse
//     CONDICAO DE MORTE ESCRITA. O plano era MIGRAR a loja conectada do custom
//     para o publico, e a guarda existia para impedir que "dois apps" virasse
//     desenho por inercia.
//
//   11/09/2026 — INVERTEU. A dona do produto decidiu que nao ha migracao: a
//     loja que estava conectada era SONDA (serviu para medir o que a API
//     entrega), e o app publico e o unico daqui para frente. Verbatim: *"pode
//     desligar o custom do tiktok, vamos usar a aplicacao do tiktok que foi
//     aprovada (public)"*.
//
// O QUE ELA COBRA AGORA, e e o oposto do que cobrava:
//   antes .... "existe um plano para o custom morrer"
//   agora .... "NENHUMA autorizacao nova nasce custom, e a ausencia do publico
//              e RECUSA, nunca fallback"
//
// 📌 A condicao de morte do que sobrou virou VERIFICAVEL POR CONSULTA: o custom
// sai do codigo quando nao houver nenhuma linha com `app = 'custom'` em
// `workspace_tiktok_shops`. E melhor do que a condicao anterior, que dependia de
// alguem lembrar — e e para isso que a coluna da migration 0033 existe.

test("a AUTORIZACAO e sempre pelo publico — nao existe mais 'padrao'", () => {
  // 🔴 O defeito real que isto reprova (11/09/2026): `login/route.ts` montava a
  // URL sem dizer o app e `callback/route.ts` trocava o `auth_code` com
  // `APP_PADRAO`. Os dois caiam no CUSTOM — o app-sonda. Um vendedor novo
  // autorizaria o app errado, e o consentimento pareceria ter funcionado.
  assert.equal(APP_DA_AUTORIZACAO, "publico");
  assert.equal(appDaAutorizacao(true), "publico");
});

test("🔴 sem o publico configurado a resposta e RECUSA, nunca custom", () => {
  // ⚠️ Esta e a assercao que MUDOU DE LADO. Ate 11/09 o teste exigia
  // `appDaAutorizacao("publico", false) === "custom"` — o fallback era o modo de
  // falha certo enquanto a migracao nao terminara.
  //
  // 📌 Com o modelo novo o MESMO fallback vira defeito: conectaria um vendedor
  // novo, em silencio, ao app que estamos desligando. E a licao da recusa
  // temporaria com o sinal trocado — nao e uma salvaguarda que sobreviveu a
  // razao dela, e um fallback SEGURO que a mudanca de modelo tornou INSEGURO,
  // sem ninguem ter tocado numa linha.
  assert.equal(appDaAutorizacao(false), null,
    "publico ausente tem de devolver null (recusa). Qualquer app aqui reabre o defeito.");
});

test("a LEITURA de linha antiga continua sendo custom — isso e fato, nao default", () => {
  // ⚠️ O CONTRARIO DISTO QUEBRA A CONEXAO JA GRAVADA EM SILENCIO. Toda linha
  // anterior a migration 0033 e do custom, porque o custom era o unico que
  // existia quando ela nasceu. Le-la como `publico` faria o refresh dela usar o
  // par errado, e o sintoma so apareceria na renovacao seguinte.
  //
  // 📌 E por isso que existem DUAS constantes e nao uma: ate 10/09 um unico
  // `APP_PADRAO` servia para "quem autoriza" e para "como ler linha antiga", e
  // em 11/09 os dois significados ficaram OPOSTOS. Nome generico guardando dois
  // significados e a familia da coluna que dois escritores tocam.
  assert.equal(APP_DE_LINHA_ANTIGA, "custom");
  assert.equal(appDaConexao(null), "custom");
  assert.equal(appDaConexao(undefined), "custom");
  assert.equal(appDaConexao(""), "custom");
  assert.equal(appDaConexao("publico"), "publico");
  assert.equal(appDaConexao("PUBLICO"), "custom");
});

test("cada app le as SUAS variaveis", async (t) => {
  const antes = { ...process.env };
  process.env.TIKTOK_APP_KEY = "custom-key";
  process.env.TIKTOK_APP_SECRET = "custom-secret";
  process.env.TIKTOK_SERVICE_ID = "custom-service";
  process.env.TIKTOK_PUBLIC_APP_KEY = "publico-key";
  process.env.TIKTOK_PUBLIC_APP_SECRET = "publico-secret";
  process.env.TIKTOK_PUBLIC_SERVICE_ID = "publico-service";

  await t.test("🔴 os pares NAO se cruzam", () => {
    // Trocar os pares e o defeito que derruba a autorizacao: o `auth_code` e
    // emitido para um app e so troca com o par dele.
    assert.deepEqual(credenciaisDoApp("custom"),
      { key: "custom-key", secret: "custom-secret", serviceId: "custom-service" });
    assert.deepEqual(credenciaisDoApp("publico"),
      { key: "publico-key", secret: "publico-secret", serviceId: "publico-service" });
  });

  await t.test("🔴 o publico exige as TRES variaveis, e a falta de qualquer uma RECUSA", () => {
    assert.equal(appPublicoConfigurado(), true);
    for (const faltante of ["TIKTOK_PUBLIC_APP_KEY", "TIKTOK_PUBLIC_APP_SECRET", "TIKTOK_PUBLIC_SERVICE_ID"]) {
      const guardado = process.env[faltante];
      delete process.env[faltante];
      assert.equal(appPublicoConfigurado(), false, `sem ${faltante} o publico nao pode ser considerado configurado`);
      assert.equal(appDaAutorizacao(), null, `sem ${faltante} a autorizacao tem de RECUSAR`);
      process.env[faltante] = guardado;
    }
  });

  for (const k of Object.keys(process.env)) if (!(k in antes)) delete process.env[k];
  Object.assign(process.env, antes);
});

test("o convite tambem vai pelo publico, e o formato do fio nao mudou", async (t) => {
  const antes = process.env.INTEGRATION_TOKEN_KEY;
  process.env.INTEGRATION_TOKEN_KEY = "chave-de-teste";
  const WS = "11111111-1111-4111-8111-111111111111";

  await t.test("🔴 convite do publico volta como publico", () => {
    const convite = validarConviteTiktok(criarConviteTiktok(WS, 30, "publico"));
    assert.equal(convite.app, "publico");
    assert.equal(convite.workspaceId, WS);
  });

  await t.test("🔴 convite SEM o campo continua lendo como custom", () => {
    // ⚠️ Compatibilidade de FIO, nao preferencia: link ja distribuido foi
    // assinado sem o campo `a`, e mudar a leitura invalidaria o que esta em
    // circulacao. Quem manda aqui e a constante da LINHA ANTIGA.
    const convite = validarConviteTiktok(criarConviteTiktok(WS, 30, "custom"));
    assert.equal(convite.app, "custom");
  });

  await t.test("🔴 o app nao pode ser trocado sem quebrar a assinatura", () => {
    const original = criarConviteTiktok(WS, 30, "publico");
    const [prefixo, corpo, assinatura] = original.split(".");
    const dados = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
    dados.a = "custom";
    const adulterado = Buffer.from(JSON.stringify(dados), "utf8").toString("base64url");
    assert.equal(validarConviteTiktok(`${prefixo}.${adulterado}.${assinatura}`), null);
  });

  if (antes === undefined) delete process.env.INTEGRATION_TOKEN_KEY;
  else process.env.INTEGRATION_TOKEN_KEY = antes;
});

test("o fluxo SEM SESSAO continua sendo o do convite", () => {
  // ⚠️ Fiacao preservada da versao anterior: o callback so dispensa sessao e
  // cookie quando o `state` e um convite integro. Guarda por string literal.
  const rota = readFileSync(new URL("../src/app/api/tiktok/callback/route.ts", import.meta.url), "utf8")
    .replace(/\r\n/g, "\n");
  const codigo = rota.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(codigo.includes("concluir(req, baseUrl, { exigirCookie: false, app: convite.app })"),
    "o convite dispensa cookie E manda o app — um sem o outro nao completa a autorizacao");
  assert.ok(codigo.includes("const tok = await exchangeAuthCode(code, opcoes.app);"),
    "a troca do auth_code tem de usar o app do convite");
});

test("🔴 as TRES rotas que autorizam perguntam qual app, e RECUSAM sem ele", () => {
  // ⚠️ Guarda por string literal, sem recorte e sem regex montada — a forma que
  // este repo ja provou ser a unica que nao fica verde por acidente.
  //
  // ⚠️ LISTA FECHADA: sao as tres rotas que INICIAM ou CONCLUEM uma
  // autorizacao. Rota nova que autorize entra aqui no mesmo commit — senao a
  // guarda fica verde enquanto o defeito volta por porta nova, que foi
  // exatamente o que aconteceu com `tiktokScheduler` em 11/09.
  const fonte = (caminho) =>
    readFileSync(new URL(caminho, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const LOGIN = fonte("../src/app/api/tiktok/login/route.ts");
  const CALLBACK = fonte("../src/app/api/tiktok/callback/route.ts");
  const CONVITE = fonte("../src/app/api/tiktok/invite/route.ts");

  for (const [nome, rota] of [["login", LOGIN], ["callback", CALLBACK], ["convite", CONVITE]]) {
    assert.ok(rota.includes("const app = appDaAutorizacao();"),
      `a rota de ${nome} tem de perguntar a appDaAutorizacao() qual app autoriza`);
    assert.ok(rota.includes("if (!app) {"),
      `a rota de ${nome} tem de RECUSAR quando nao ha app — null nao pode virar fallback`);
  }

  assert.ok(LOGIN.includes("tiktokAuthorizationUrl(state, app)"),
    "o botao manda o vendedor para a URL do app que autoriza, nao para um padrao");
  assert.ok(CALLBACK.includes("concluir(req, baseUrl, { exigirCookie: true, app }"),
    "o callback do painel troca o auth_code com o MESMO app que montou a URL; " +
      "separados, o consentimento acontece num app e a troca no outro");
});

test("🔴 nenhuma rota de autorizacao reintroduz o fallback para custom", () => {
  // ⚠️ Assercao que PROIBE olha o fonte SEM COMENTARIOS — obrigatorio nesta
  // casa, e aqui em dobro: os comentarios destas rotas CITAM o custom para
  // explicar por que ele nao pode voltar. Casar o fonte cru reprovaria a
  // propria explicacao.
  const limpo = (caminho) =>
    readFileSync(new URL(caminho, import.meta.url), "utf8")
      .replace(/\r\n/g, "\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

  for (const caminho of [
    "../src/app/api/tiktok/login/route.ts",
    "../src/app/api/tiktok/callback/route.ts",
    "../src/app/api/tiktok/invite/route.ts",
  ]) {
    const codigo = limpo(caminho);
    assert.ok(!codigo.includes('"custom"'),
      `${caminho} nao pode nomear o custom no codigo: autorizacao nova e sempre publico`);
    assert.ok(!/\?\?\s*APP_/.test(codigo),
      `${caminho} nao pode ter "?? APP_...": e assim que a recusa vira fallback de novo`);
  }
});

test("o TODO cobra o desligamento, com a condicao que uma CONSULTA responde", () => {
  const todo = readFileSync(new URL("../TODO.md", import.meta.url), "utf8");
  assert.ok(todo.includes("TikTok: desligar o app custom"),
    "sem item no TODO, o custom sobrevive por inercia agora que nao tem mais funcao nova");
  assert.ok(todo.includes("app = 'custom'"),
    "o item tem de dizer a condicao verificavel: o custom sai quando nao houver " +
      "linha com app = 'custom'. Condicao que depende de lembrar nao e condicao.");
});
