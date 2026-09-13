import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * REPROVA O DEFEITO DE 12/09/2026: o dashboard da Amazon exibia `R$ 0,00` em
 * seis pedidos `Pending` seguidos — a tela afirmando que seis vendas nao
 * renderam nada.
 *
 * ⚠️ ESTE TESTE JA MUDOU DE ALVO UMA VEZ, e o registro importa.
 * A primeira versao guardava `valorDoPedidoRecente`, uma regra criada para o
 * bloco "Pedidos recentes" (numero do pedido, data, status, total). Em
 * 13/09/2026 esse bloco foi substituido pelo `PainelV3Baixo` — a mesma peca do
 * Mercado Livre —, a regra ficou sem chamador e o arquivo foi apagado.
 *
 * O DEFEITO NAO MUDOU, so o sitio: a previa de pedidos agora sai das linhas de
 * rentabilidade, e ali a bandeira da Amazon para "venda ainda nao publicada" e
 * `revenueKnown === false` — a venda chega como ZERO, nao como `null`. Copiar
 * o mapeamento do Mercado Livre (`l.revenue == null`) traria o "0,00" de volta.
 */
const fonte = () => readFileSync("src/app/(app)/amazon/page.tsx", "utf8");

test("a previa de pedidos da Amazon usa a bandeira da Amazon, nao a do Mercado Livre", () => {
  assert.ok(
    fonte().includes('venda: l.revenueKnown === false || l.revenue == null ? "—" : semMoeda(l.revenue),'),
    "sem `revenueKnown === false` o pedido Pending volta a exibir 0,00: na Amazon a venda ausente chega como zero, nao como null",
  );
});

test("o mapeamento copiado do Mercado Livre nao volta sozinho", () => {
  // Proibicao: le o fonte SEM comentarios, senao a nota que explica a regra
  // (que cita `l.revenue == null`) reprova o proprio arquivo que a documenta.
  const codigo = fonte().replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(
    !codigo.includes('venda: l.revenue == null ? "—"'),
    "o mapeamento do Mercado Livre voltou — na Amazon ele exibe 0,00 no pedido pendente",
  );
});
