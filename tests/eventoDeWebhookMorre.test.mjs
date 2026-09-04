import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ⚠️ TODO CANAL COM PUSH ESCREVE A PALAVRA QUE A RETENCAO LE.
//
// Defeito real que este teste reprova (achado em 04/09/2026, existia desde
// 02/09): o push da Shopee marcava o evento como `status = 'processed'` e a
// retencao do ADR-016 remove `status = 'complete'`. Duas palavras para o mesmo
// estado, e o expurgo so conhecia uma — os eventos da Shopee eram imortais por
// construcao, ~2.600 por dia, crescendo para sempre.
//
// 📌 Nada ficava vermelho: o UPDATE e valido, o dado nao corrompe, a fila
// esvazia do ponto de vista do processamento. So a LINHA nunca morre. E o
// sintoma so apareceu porque alguem foi medir IO por outro motivo.
//
// A guarda e sobre COMPORTAMENTO onde da (a retencao e funcao pura de SQL nao,
// entao a parte do fonte casa a chamada INTEIRA, nunca o par chave:valor).

const ler = (caminho) => readFileSync(new URL(caminho, import.meta.url), "utf8");
const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const RETENCAO = ler("../src/lib/retencao.ts");
const CANAIS_COM_PUSH = [
  ["shopee", "../src/app/api/webhooks/shopee/route.ts"],
  ["mercado_livre", "../src/lib/integrations/mercadoLivreWebhook.ts"],
];

test("evento de webhook concluido pode ser expurgado", async (t) => {
  await t.test("a retencao remove exatamente 'complete'", () => {
    assert.ok(RETENCAO.includes("WHERE status = 'complete'"),
      "se a retencao mudar de palavra, as guardas abaixo passam a medir a palavra errada");
  });

  for (const [canal, caminho] of CANAIS_COM_PUSH) {
    await t.test(`🔴 o push da ${canal} marca com a palavra que a retencao le`, () => {
      const codigo = semComentarios(ler(caminho));
      assert.ok(
        codigo.includes("SET status = 'complete'"),
        `${canal}: evento marcado com palavra que a retencao nao remove vira linha imortal`,
      );
      // Proibicao olha o fonte SEM COMENTARIOS: o comentario que explica a
      // troca CITA a palavra antiga.
      assert.ok(
        !codigo.includes("status = 'processed'"),
        `${canal}: 'processed' e o vocabulario que a retencao nao conhece`,
      );
    });
  }
});
