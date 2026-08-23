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
  assert.match(t, /margem 12,8%/);
  assert.match(t, /-57,4%/);
});

test("lucro consolidado desconhecido vira 'desconhecido', nunca zero", () => {
  const t = descreverSnapshot({ ...base, lucro30d: null, margemPct: null });
  // A linha do consolidado precisa dizer desconhecido — não R$ 0,00.
  assert.match(t, /Lucro consolidado conhecido: desconhecido\./);
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
