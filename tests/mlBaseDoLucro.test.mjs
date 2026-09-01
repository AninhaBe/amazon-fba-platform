import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (c) => readFile(new URL(`../${c}`, import.meta.url), "utf8");

// ═══ A BASE DO LUCRO DO ML PASSA A SER O FATURAMENTO (01/09/2026) ═══════════
//
// Quarta replica da decisao dela: "TEM QUE ESQUECER O APURADO E LEVAR EM
// CONSIDERACAO SOMENTE O FATURAMENTO". O ML dividia por `processedRevenue`.
//
// ⚠️ E AQUI HA UMA DIFERENCA QUE OS OUTROS CANAIS NAO TEM, e ela e deliberada:
// o CARD de Faturamento do ML mostra "Vendas brutas" do painel deles —
// aprovadas MAIS canceladas, sem frete (ADR-020), que e como ela confere. A
// base do LUCRO nao pode incluir cancelada: venda cancelada nao tem custo nem
// tarifa, e soma-la inflaria o resultado com dinheiro que nao entrou.
//
// Entao, so no ML, card e base divergem pelo valor das canceladas — e e o unico
// canal onde a declaracao de base CONTINUA aparecendo depois desta mudanca.
// Isso nao e o defeito de 31/08 voltando: la as duas bases respondiam a MESMA
// pergunta e uma estava errada; aqui sao duas perguntas diferentes.

test("o lucro e a margem do canonico saem do faturamento, nao do apurado", async () => {
  const texto = await fonte("src/lib/integrations/mercadoLivreOverviewCanonical.ts");
  assert.match(texto, /const estimatedProfit = faturamentoDoLucro - fees/);
  assert.match(texto, /marginPct: faturamentoDoLucro > 0 \? estimatedProfit \/ faturamentoDoLucro/);
});

test("a base EXCLUI cancelada — venda cancelada nao tem custo nem tarifa", async () => {
  const texto = await fonte("src/lib/integrations/mercadoLivreOverviewCanonical.ts");
  assert.match(texto, /SUM\(gross\) FILTER \(WHERE status <> 'cancelled'\) AS faturamento/);
  // E o pendente ENTRA: o filtro e por exclusao de cancelada, nao por lista de
  // status aprovados. Uma lista fixa deixaria o pendente de fora, que e o
  // oposto do que ela pediu.
  assert.doesNotMatch(texto, /AS faturamento[\s\S]{0,40}status = ANY/);
});

test("o caminho LEGADO declara que nao tem a base, em vez de fingir", async () => {
  // ⚠️ O legado le a API ao vivo e so enxerga o que coletou. Preencher
  // `revenueDoLucro` com o apurado afirmaria que as bases coincidem quando nao
  // coincidem — e a tela some com a declaracao justamente quando ela importa.
  const texto = await fonte("src/lib/integrations/mercadoLivre.ts");
  assert.match(texto, /revenueDoLucro: null as number \| null/);
  assert.match(texto, /pedidosSemApuracao: null as number \| null/);
});

test("pedido sem valor fica FORA da base e e contado para a tela apontar", async () => {
  const texto = await fonte("src/lib/integrations/mercadoLivreOverviewCanonical.ts");
  assert.match(texto, /status <> 'cancelled' AND gross IS NULL\)::int AS sem_valor/);
  assert.match(texto, /pedidosSemApuracao: pedidosSemValor/);
});
