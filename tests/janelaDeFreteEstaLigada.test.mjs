import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ⚠️ A FIACAO, que o teste de integracao NAO alcanca.
//
// `tests-integracao/janelaDeFreteDoML` prova que as duas consultas fazem o que
// prometem. Ele NAO prova que o sync as chama — `syncMissingShipmentCosts` faz
// chamada de API do ML e nao roda em teste.
//
// Defeito que ele reprova (04/09/2026): a consulta sem janela varria 38 mil
// pedidos por chamada, 88 GB, 35% do disco lido do banco. Se alguem reinstalar
// a consulta antiga inline, ou remover a varredura diaria, o custo volta ou o
// buraco abre — e nenhum teste de comportamento fica vermelho.
//
// 📌 A assercao e por STRING LITERAL, sem recorte e sem regex montada: guarda
// esperta que erra a fronteira prova menos que guarda burra que acerta.

const fonte = readFileSync(new URL("../src/lib/integrations/mercadoLivreSync.ts", import.meta.url), "utf8");
// ⚠️ Proibicao olha o fonte SEM COMENTARIOS — o comentario que explica por que
// a consulta antiga foi embora CITA a consulta antiga.
const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("a janela de frete continua ligada no sync do ML", async (t) => {
  await t.test("🔴 o caminho quente passa pela consulta COM janela", () => {
    assert.ok(
      codigo.includes("const shipmentRows = await enviosFaltandoNaJanela(connection.id, SHIPMENT_BATCH_SIZE);"),
      "o sync tem de buscar os envios pela funcao com janela",
    );
  });

  await t.test("🔴 a varredura diaria do historico completo continua sendo chamada", () => {
    assert.ok(
      codigo.includes("await vigiarFreteForaDaJanela(connection.id);"),
      "sem esta chamada a janela deixa de ser otimizacao e vira buraco silencioso",
    );
  });

  await t.test("🔴 a consulta SEM janela nao volta para dentro do sync", () => {
    assert.ok(
      !codigo.includes("array_agg(orders.external_order_id)"),
      "a consulta do historico completo nao pode voltar ao caminho quente",
    );
  });
});
