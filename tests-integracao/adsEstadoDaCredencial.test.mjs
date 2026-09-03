import test from "node:test";
import assert from "node:assert/strict";
import { LOCAL_HOSTS } from "../scripts/migration-safety.mjs";

// ⚠️ O ESTADO DA CREDENCIAL DE ADS, PROVADO CONTRA POSTGRES.
//
// 🔴 O defeito que isto reprova (02/09/2026): quem nunca autorizou o Ads via
// "Nenhum produto anunciado neste periodo" — a frase do caso CONECTADO E SEM
// CAMPANHA. Para quem nao conectou ela e falsa, e por meses fez a aba parecer
// "so da dona do produto": o OAuth, o cron e a rota sempre foram por workspace;
// so ela tinha autorizado porque ninguem achava o botao.
//
// Aqui a pergunta e de COMPORTAMENTO — um workspace que nunca autorizou tem de
// vir `false`, nunca ausente e nunca `true` por herdar de outro inquilino.

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL ausente: o teste do ESTADO DA CREDENCIAL DE ADS nao rodou. Isto e FALHA, " +
    "nao ausencia de trabalho. Suba um Postgres descartavel e rode `node scripts/ci-preparar-banco.mjs`.",
  );
}
if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
  throw new Error(`BLOCKED: TEST_DATABASE_URL aponta para "${new URL(url).hostname}", que nao e descartavel.`);
}
process.env.DATABASE_URL = url;
const { lerAdsMultiCanal } = await import("../src/lib/adsMultiCanal.ts");
const { runWithWorkspace } = await import("../src/lib/workspaceScope.ts");

test("workspace sem credencial responde conectado=false, e diz para onde ir", async () => {
  const inexistente = "00000000-0000-4000-8000-00000000ad50";
  const dados = await runWithWorkspace(inexistente, () => lerAdsMultiCanal("2026-09-01", "2026-09-02"));
  const amazon = dados.credenciais.find((c) => c.provider === "amazon");
  assert.equal(amazon.conectado, false, "workspace sem credencial nao pode aparecer conectado");
  assert.equal(amazon.conectarEm, "/api/ads/connect", "saber o problema sem a saida nao ajuda ninguem");
  // E a ausencia de credencial NAO derruba a aba: ela muda a MENSAGEM, nao o
  // contrato. Payload incompleto faria a tela cair num erro generico.
  assert.ok(Array.isArray(dados.canais) && Array.isArray(dados.produtos));
});
