import test from "node:test";
import assert from "node:assert/strict";

import { descreverSnapshot } from "../src/lib/centralBriefing.ts";

// O prompt é a única fonte de números que o modelo vê. Estes testes travam a
// regra do AGENTS.md: valor desconhecido não pode virar zero, e todo número no
// texto tem que ter vindo do snapshot.

const base = {
  data: "2026-08-22",
  moeda: "BRL",
  faturamento30d: 56909.63,
  lucro30d: 361.47,
  margemPct: 12.8,
  variacaoSemanaPct: -57.4,
  canais: [
    { nome: "Amazon", faturamento: 411, lucro: 260.25, margemPct: 63.3, variacaoSemanaPct: 5, semLeitura: false, unidadesSemCusto: 0 },
    { nome: "Mercado Livre", faturamento: 0, lucro: 0, margemPct: 0, variacaoSemanaPct: -100, semLeitura: false, unidadesSemCusto: 3 },
  ],
};

test("descreve os números fornecidos, com moeda", () => {
  const t = descreverSnapshot(base);
  assert.match(t, /R\$\s?56\.909,63/);
  assert.match(t, /\(margem 12,8%\)/);
  assert.match(t, /-57,4%/);
});

test("lucro consolidado desconhecido vira 'desconhecido', nunca zero", () => {
  const t = descreverSnapshot({ ...base, lucro30d: null, margemPct: null });
  // A linha do consolidado precisa dizer desconhecido — não R$ 0,00.
  assert.match(t, /Lucro conhecido: desconhecido\./);
});

test("canal sem leitura é declarado, não zerado", () => {
  const t = descreverSnapshot({ ...base, canais: [{ nome: "Shopee", faturamento: null, lucro: null, margemPct: null, variacaoSemanaPct: null, semLeitura: true, unidadesSemCusto: 0 }] });
  assert.match(t, /Shopee: conectado, mas sem leitura/);
});

test("custo faltando aparece como lucro subestimado", () => {
  const t = descreverSnapshot(base);
  assert.match(t, /3 unidade\(s\) sem custo cadastrado/);
});

test("sem base de comparação, não inventa tendência", () => {
  const t = descreverSnapshot({ ...base, variacaoSemanaPct: null });
  assert.match(t, /Ainda não há duas semanas/);
});

// A margem parcial não pode ser apresentada como resultado da operação inteira.
//
// Defeito real de 23/08/2026: o lucro só existe onde há custo cadastrado, mas a
// margem dividia esse lucro pela receita de TODOS os canais. Com o TikTok
// respondendo por quase todo o faturamento e sem custo, saiu
// `383,94 / 55.396,14 = 0,7%` — e o NEXO narrou como "perda de margem",
// mandando a vendedora resolver um problema que não existia.
test("margem informa a BASE e separa o faturamento sem custo", () => {
  const texto = descreverSnapshot({
    data: "2026-08-23",
    moeda: "BRL",
    faturamento30d: 55396.14,
    lucro30d: 383.94,
    // 58,1% sobre a parte com custo — não 0,7% sobre o total.
    margemPct: 58.1,
    receitaComLucro: 661.0,
    variacaoSemanaPct: -51.3,
    canais: [],
  });
  assert.match(texto, /margem de 58,1% sobre R\$\s661,00/);
  assert.match(texto, /parte do faturamento com custo cadastrado/);
  // O que sobra tem de ser nomeado como DESCONHECIDO, nunca somado como zero.
  assert.match(texto, /R\$\s54\.735,14.{0,40}SEM custo cadastrado/);
  assert.match(texto, /DESCONHECIDO — não é zero/);
  // E o percentual nunca pode aparecer colado ao faturamento total.
  assert.ok(!/margem de 0,7%/.test(texto));
});
