import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

// O DEFEITO QUE ESTE ARQUIVO REPROVA — print da conta dela, 01/09/2026 as 11:38,
// dashboard da Amazon, periodo Hoje.
//
// Os cards de Faturamento, Ads, Custo, Repasse e Margem estavam TODOS em branco
// (a tela recebeu `profit.finance = null`, e e dele que os cards saem), e a
// frase do topo dizia:
//
//   "15 vendas e R$ 12,89 hoje — sobraram R$ 234,71."
//
// Duas afirmacoes falsas na mesma linha:
//   1. afirma LUCRO numa tela onde o lucro esta em branco;
//   2. afirma um lucro MAIOR que o faturamento que ela acabou de dizer, porque
//      os dois numeros vem de universos diferentes — `billing.revenue` (12,89) e
//      `profit.estimatedProfit` (234,71).
//
// ⚠️ A frase e o FALLBACK CALCULADO (`montarFrase`), nao a narracao do modelo: o
// formato "N vendas e R$ X <periodo> — sobraram R$ Y." e dele, e o periodo sai
// como "hoje". A narracao do modelo e prosa e diz "nos ultimos 30 dias".

test("a frase do topo nao afirma lucro quando a base financeira nao existe", async () => {
  const amazon = await fonte("src/app/(app)/amazon/page.tsx");
  // Casar a RAMIFICACAO: o lucro so passa quando `finance` existe — a MESMA
  // condicao de que os cards dependem. Sem isso os dois podem discordar de novo.
  assert.match(
    amazon,
    /lucro=\{profit\?\.finance \? profit\?\.estimatedProfit \?\? null : null\}/,
    "a frase voltou a afirmar lucro sem base financeira",
  );
  // E a passagem crua nao pode voltar.
  const codigo = amazon.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(
    !/lucro=\{profit\?\.estimatedProfit \?\? null\}/.test(codigo),
    "voltou a passar o lucro sem olhar a base",
  );
});

test("sem lucro, a frase ja tem o texto certo — nada de inventar frase nova", async () => {
  // O ramo existe desde sempre em `montarFrase`; o que faltava era CAIR nele.
  const lead = await fonte("src/app/components/BriefingLead.tsx");
  assert.match(lead, /if \(lucro == null\) \{/);
  assert.match(lead, /Quanto sobrou ainda não dá para dizer — falta custo ou tarifa/);
});

test("os cards e a frase leem a MESMA condicao de base", async () => {
  // Os cards saem de `finance`; a frase agora tambem depende dele. Enquanto os
  // dois olharem o mesmo campo, nao existe estado em que um afirme e o outro
  // fique em branco.
  const amazon = await fonte("src/app/(app)/amazon/page.tsx");
  assert.match(amazon, /finance: profit\?\.finance \?\? null,/, "os cards deixaram de sair de finance");
});
