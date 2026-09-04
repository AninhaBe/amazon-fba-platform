import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APP_PADRAO, appDaAutorizacao, appDaConexao, appPublicoConfigurado, credenciaisDoApp,
} from "../src/lib/integrations/tiktokApps.ts";
import { criarConviteTiktok, validarConviteTiktok } from "../src/lib/tiktokInvite.ts";

// ⚠️ OS DOIS APPS DO TIKTOK CONVIVEM COM PRAZO DE MORTE DECLARADO.
//
// Decisao da dona do produto em 04/09/2026: **migrar** e o destino, em duas
// etapas, porque a migracao real so e possivel depois da aprovacao do app
// publico. Ate la, o custom atende a loja conectada e o publico existe para a
// revisao funcional.
//
// 📌 O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR nao e de calculo: e a
// convivencia sobreviver a razao dela. Duas vias de credencial ja custaram um
// `undefined` em producao na Amazon, e a doutrina da casa e explicita —
// salvaguarda escrita para contornar um limite morre quando o limite cai.
//
// Se voce chegou aqui porque o app publico foi APROVADO: o caminho e a janela
// com a dona, a loja reautorizando pelo publico, o custom aposentado e o par
// extra saindo do Fly. Este teste e o `TODO.md` cobram isso.

test("o app padrao e o CUSTOM — nada muda para quem ja esta conectado", () => {
  assert.equal(APP_PADRAO, "custom");
  assert.equal(appDaAutorizacao(null), "custom");
  assert.equal(appDaAutorizacao(undefined), "custom");
  assert.equal(appDaConexao(undefined), "custom");
});

test("o publico NUNCA e escolhido por acaso", async (t) => {
  await t.test("🔴 pedido explicito SEM as variaveis cai no custom", () => {
    // Modo de falha certo: sem credencial, autorizar pelo publico devolveria
    // token negado no meio do fluxo do vendedor. Melhor nem oferecer.
    assert.equal(appDaAutorizacao("publico", false), "custom");
  });
  await t.test("pedido explicito COM as variaveis vai para o publico", () => {
    assert.equal(appDaAutorizacao("publico", true), "publico");
  });
  await t.test("🔴 qualquer outro valor e custom", () => {
    for (const lixo of ["public", "PUBLICO", "", "sim", "1"]) {
      assert.equal(appDaAutorizacao(lixo, true), "custom", `"${lixo}" nao pode virar publico`);
    }
  });
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
    // Trocar os pares e o defeito que derrubaria a revisao funcional: o
    // `auth_code` e emitido para um app e so troca com o par dele.
    assert.deepEqual(credenciaisDoApp("custom"),
      { key: "custom-key", secret: "custom-secret", serviceId: "custom-service" });
    assert.deepEqual(credenciaisDoApp("publico"),
      { key: "publico-key", secret: "publico-secret", serviceId: "publico-service" });
  });

  await t.test("🔴 o publico exige as TRES variaveis", () => {
    assert.equal(appPublicoConfigurado(), true);
    for (const faltante of ["TIKTOK_PUBLIC_APP_KEY", "TIKTOK_PUBLIC_APP_SECRET", "TIKTOK_PUBLIC_SERVICE_ID"]) {
      const guardado = process.env[faltante];
      delete process.env[faltante];
      assert.equal(appPublicoConfigurado(), false, `sem ${faltante} o publico nao pode ser considerado configurado`);
      process.env[faltante] = guardado;
    }
  });

  for (const k of Object.keys(process.env)) if (!(k in antes)) delete process.env[k];
  Object.assign(process.env, antes);
});

test("o convite carrega o app dentro do state ASSINADO", async (t) => {
  const antes = process.env.INTEGRATION_TOKEN_KEY;
  process.env.INTEGRATION_TOKEN_KEY = "chave-de-teste";
  const WS = "11111111-1111-4111-8111-111111111111";

  await t.test("🔴 convite do publico volta como publico", () => {
    // Sem isto o callback teria de ADIVINHAR com qual par trocar o codigo — e
    // adivinhar errado devolve token negado, que e o defeito que derruba o
    // revisor do TikTok.
    const convite = validarConviteTiktok(criarConviteTiktok(WS, 30, "publico"));
    assert.equal(convite.app, "publico");
    assert.equal(convite.workspaceId, WS);
  });

  await t.test("🔴 convite SEM o campo le como custom — link antigo nao muda", () => {
    const convite = validarConviteTiktok(criarConviteTiktok(WS));
    assert.equal(convite.app, "custom");
  });

  await t.test("🔴 o app nao pode ser trocado sem quebrar a assinatura", () => {
    // O app decide QUAL par de credencial e usado. Se desse para editar o state
    // sem invalidar a assinatura, daria para redirecionar a autorizacao.
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
  // ⚠️ Fiacao: o revisor do TikTok autoriza sem ter conta aqui. O callback so
  // dispensa sessao e cookie quando o `state` e um convite integro — e e por
  // isso que a revisao tem de ser feita por link de convite, nao pelo botao do
  // painel. Guarda por string literal, sem recorte nem regex montada.
  const rota = readFileSync(new URL("../src/app/api/tiktok/callback/route.ts", import.meta.url), "utf8");
  const codigo = rota.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(codigo.includes("concluir(req, baseUrl, { exigirCookie: false, app: convite.app })"),
    "o convite dispensa cookie E manda o app — um sem o outro nao completa a autorizacao");
  assert.ok(codigo.includes("const tok = await exchangeAuthCode(code, opcoes.app);"),
    "a troca do auth_code tem de usar o app do convite");
});

test("🔴 a convivencia declara COMO morre — e onde isso e cobrado", () => {
  // Salvaguarda temporaria sem condicao de morte escrita e como ela vira
  // desenho por inercia (AGENTS.md). Aqui a condicao e verificavel.
  const fonte = readFileSync(new URL("../src/lib/integrations/tiktokApps.ts", import.meta.url), "utf8");
  // Minusculas: a condicao esta escrita com enfase em caixa alta, e casar a
  // caixa faria a guarda falhar por estilo em vez de por conteudo.
  const texto = fonte.toLowerCase();
  // ⚠️ As agulhas TAMBEM em minusculas: comparar texto minusculo com agulha
  // em caixa mista falha por descuido meu, nao por falta da condicao.
  for (const trecho of ["aprovado", "reautoriza", "aposentado", "sai do fly"]) {
    assert.ok(texto.includes(trecho), `a condicao de morte precisa dizer "${trecho}"`);
  }
  const todo = readFileSync(new URL("../TODO.md", import.meta.url), "utf8");
  assert.ok(todo.includes("TikTok: aposentar o app custom"),
    "sem item no TODO, a convivencia sobrevive a razao dela");
});
