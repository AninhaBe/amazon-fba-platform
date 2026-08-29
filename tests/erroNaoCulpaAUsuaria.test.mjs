import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { providerReadIssue } from "../src/lib/integrations/providerReadIsolation.ts";
import { mensagemDeFalhaDeLogin } from "../src/app/login/mensagemDeFalha.ts";

// 29/08/2026 — TRES telas, UM defeito. O login disse "e-mail ou senha
// incorretos" quando era 409 de refresh concorrente; o ML mostrou "timeout
// exceeded when trying to connect" em ingles cru; o TikTok disse que a conexao
// dela requer atencao quando quem falhou fomos nos — e ofereceu um botao de
// MEXER NA CONEXAO, que podia queimar uma autorizacao intacta.
//
// Nao sao tres bugs: o tratamento de erro nao separa FALHA NOSSA de PROBLEMA
// DELA, e no escuro escolhe sempre a versao que a culpa.

test("falha de infraestrutura NAO vira problema da conexao dela", () => {
  for (const erro of [
    new Error("timeout exceeded when trying to connect"),
    new Error("(ECHECKOUTTIMEOUT) unable to check out connection from the pool"),
    new Error("canceling statement due to statement timeout"),
  ]) {
    const issue = providerReadIssue(erro, "tiktok_shop");
    assert.equal(issue.code, "INFRA_INDISPONIVEL", `"${erro.message}" foi tratado como problema dela`);
    assert.match(issue.message, /problema é nosso/i);
    assert.match(issue.message, /conexão está intacta/i, "precisa dizer que nao ha o que reconectar");
  }
});

test("conflito de propriedade REAL continua sendo problema de conexao", () => {
  const conflito = new Error("duplicado");
  conflito.name = "TiktokOwnershipConflictError";
  assert.equal(providerReadIssue(conflito, "tiktok_shop").code, "OWNERSHIP_CONFLICT");
});

test("a tela NAO oferece botao de mexer na conexao quando a falha e nossa", async () => {
  for (const caminho of ["../src/app/components/TikTokWorkspace.tsx", "../src/app/components/TikTokModulePage.tsx"]) {
    const src = await readFile(new URL(caminho, import.meta.url), "utf8");
    // Acao destrutiva oferecida com base numa duvida e o pior desenho possivel:
    // se ela reconectar, queima uma autorizacao que estava perfeita.
    assert.match(src, /INFRA_INDISPONIVEL/, `${caminho}: nao distingue falha nossa`);
    // O botao so pode existir no ramo que NAO e falha nossa.
    assert.match(src, /(nossa\s*\?\s*undefined|INFRA_INDISPONIVEL"\s*\?\s*undefined)/, `${caminho}: o botao continua aparecendo na falha nossa`);
  }
});

test("o login so culpa a credencial quando o erro E de credencial", () => {
  assert.match(mensagemDeFalhaDeLogin({ status: 400, code: "invalid_credentials" }), /senha incorretos/);
  const nossa = mensagemDeFalhaDeLogin({ status: 409, message: "Too many concurrent token refresh requests" });
  assert.doesNotMatch(nossa, /senha incorretos/);
  assert.match(nossa, /n[aã]o precisa tentar de novo/i, "repetir login dispara limite de taxa e a trancaria de verdade");
});
