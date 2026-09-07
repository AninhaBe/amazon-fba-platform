import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (c) => readFile(new URL(`../${c}`, import.meta.url), "utf8");
const semComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// O `state` DO OAUTH NOS QUATRO CANAIS — auditoria de superficie de 07/09/2026.
//
// Sem `state`, um atacante induz a vitima a completar um fluxo que ELE comecou,
// e a conta dele fica ligada ao workspace dela (ou o contrario). E o defeito
// classico de OAuth, e ele nao aparece em nenhum teste funcional: o fluxo
// "funciona" perfeitamente enquanto esta sendo abusado.

test("ML e Amazon Ads COMPARAM o state devolvido, nao so conferem que existe", async () => {
  const ml = semComentarios(await fonte("src/app/api/integrations/mercado-livre/callback/route.ts"));
  assert.ok(ml.includes("state !== expectedState"), "o ML parou de comparar o state");

  const ads = semComentarios(await fonte("src/app/(app)/ads/callback/route.ts"));
  assert.ok(/esperado/.test(ads) && /state/.test(ads), "o callback do Ads nao confere o state");
});

test("o TikTok usa state ASSINADO — o mais forte dos quatro", async () => {
  // Ele precisa ser o mais forte porque tem um caminho a mais: o convite, que
  // chega SEM sessao e sem cookie. A origem so pode ser provada pela assinatura.
  const codigo = semComentarios(await fonte("src/app/api/tiktok/callback/route.ts"));
  assert.ok(codigo.includes("validarConviteTiktok(state)"), "o TikTok parou de validar a assinatura do state");
});

test("a Shopee e EXCECAO JUSTIFICADA — e o motivo esta escrito no proprio arquivo", async () => {
  // ⚠️ Excecao justificada NAO tem prazo de morte, e e por isso que ela precisa
  // do motivo por escrito: sem ele, a proxima pessoa le "so confere que o cookie
  // existe" e conclui que alguem foi desleixado. A Shopee nao devolve `state`.
  const bruto = await fonte("src/app/api/integrations/shopee/connect/route.ts");
  assert.match(bruto, /não devolve `state`/, "sumiu a justificativa da excecao da Shopee");
  assert.match(bruto, /EXCEÇÃO JUSTIFICADA, NÃO DÍVIDA/, "a excecao perdeu a classificacao");

  // E o que compensa a falta do state e a SESSAO: a conexao nasce dentro do
  // workspace autenticado, nunca a partir do que o callback disser.
  const callback = semComentarios(await fonte("src/app/api/integrations/shopee/callback/route.ts"));
  assert.ok(callback.includes("withAuthenticatedWorkspace"), "o callback da Shopee ficou sem sessao");
  assert.ok(callback.includes('req.cookies.get("shopee_oauth_state")'), "sumiu a conferencia do cookie");
});

test("nenhum callback de OAuth aceita workspace vindo do cliente", async () => {
  // Parametro do cliente pode ESTREITAR o escopo, nunca defini-lo (AGENTS.md).
  for (const caminho of [
    "src/app/api/integrations/mercado-livre/callback/route.ts",
    "src/app/api/integrations/shopee/callback/route.ts",
    "src/app/api/tiktok/callback/route.ts",
    "src/app/(app)/ads/callback/route.ts",
  ]) {
    const codigo = semComentarios(await fonte(caminho));
    assert.ok(!/searchParams\.get\("workspace/.test(codigo), `${caminho} aceita workspace por query`);
    assert.ok(!/body\.workspaceId/.test(codigo), `${caminho} aceita workspace pelo corpo`);
  }
});
