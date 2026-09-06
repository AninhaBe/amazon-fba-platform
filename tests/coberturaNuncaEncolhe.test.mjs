import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// ⚠️ covered_from GUARDA O PONTO MAIS ANTIGO JA COBERTO — e so pode DESCER.
//
// 🔴 DEFEITO MEDIDO EM 06/09/2026, na loja UTILEIRA (shopee:275804987): o
// marcador dizia 2026-07-13 e o primeiro pedido real era 2026-06-28, com
// **5.103 pedidos — 20% da base — antes do marcador**. Qualquer filtro que
// comecasse antes de 13/07 exibia "os numeros cobrem a partir de 13/07" com o
// dado ja no banco. Aviso de cobertura mentindo e defeito, nao estetica.
//
// 📌 A CAUSA era uma assimetria entre os DOIS escritores do mesmo campo:
//   caminho 'pending'  -> LEAST(COALESCE(covered_from, $4), $4)   ... abaixava
//   caminho 'complete' -> COALESCE(covered_from, target_from)     ... NUNCA abaixava
// O backfill de 28/08 caminhou para tras ate 28/06; o marcador congelou onde a
// caminhada fechou como 'complete' pela primeira vez. Estava em TRES canais
// (Amazon, Shopee, ML); o TikTok tinha so um escritor, ja com LEAST.
//
// ⚠️ A guarda e sobre o TEXTO do SQL porque o alvo e um UPDATE — nao ha funcao
// pura para chamar. Por isso ela casa a ATRIBUICAO INTEIRA, nunca o
// identificador solto: "covered_from" continuaria verde com COALESCE de volta.

const DIR = new URL("../src/lib/integrations/", import.meta.url);
const SYNCS = readdirSync(DIR).filter((n) => n.endsWith("Sync.ts"));

test("nenhum canal deixa covered_from parar de descer", async (t) => {
  await t.test("a lista de arquivos nao esta vazia", () => {
    // Guarda vacua e pior que guarda nenhuma: se o glob parar de casar, o
    // laco abaixo passaria sem medir nada.
    assert.ok(SYNCS.length >= 3, `esperados ao menos 3 *Sync.ts, achados ${SYNCS.length}`);
  });

  for (const nome of SYNCS) {
    const fonte = readFileSync(new URL(nome, DIR), "utf8");
    // Proibicao olha o fonte SEM COMENTARIOS: a nota que explica a correcao
    // CITA o COALESCE antigo, e casaria com ela mesma.
    const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "").replace(/\/\/.*$/gm, "");
    const escritas = [...codigo.matchAll(/covered_from\s*=\s*([^,\n]+)/g)].map((m) => m[1].trim());
    if (!escritas.length) continue;
    await t.test(`🔴 ${nome}: toda escrita de covered_from usa LEAST`, () => {
      for (const escrita of escritas) {
        // ⚠️ `NULL` E LEGITIMO E NAO E ENCOLHIMENTO: e o reset explicito de
        // reconexao ("nunca cobriu nada"), estado inicial e nao data errada.
        // O tiktokSync usa isso ao recomecar do zero. Confundir os dois faria
        // a guarda reprovar codigo certo — e guarda que grita no lugar errado
        // ensina a desligar guarda.
        if (escrita === "NULL") continue;
        assert.ok(
          escrita.startsWith("LEAST("),
          `${nome}: "covered_from = ${escrita}" nao desce. COALESCE sozinho congela o marcador `
          + "e a tela passa a mentir sobre o que ja foi importado (defeito de 06/09/2026).",
        );
      }
    });
  }
});
