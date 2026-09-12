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
  const codigo = amazon.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  // ⚠️ A FRASE SAIU DA TELA DA AMAZON EM 12/09/2026, com o
  // <BriefingLead> inteiro: o PainelV3 substituiu a abertura, por ordem dela
  // (*"replicar a mesma estrutura do mercado livre na amazon"*), e as pendencias
  // que o lead carregava foram para o cartao "O que falta para o numero fechar".
  // Sem a frase nao ha afirmacao de lucro para checar — o defeito do print de
  // 01/09 era a FRASE, nao os cards.
  //
  // ⚠️ AS DUAS ASERCOES CONTINUAM, com papeis trocados: a
  // EXIGENCIA virou condicional (se o lead voltar, volta com o portao de base) e
  // a PROIBICAO ficou incondicional, porque ela e que impede a volta da forma
  // errada. A ordem importa: a proibicao sozinha ficaria verde para sempre, e e
  // assim que guarda morta passa por guarda viva.
  if (/<BriefingLead/.test(codigo)) {
    assert.match(
      amazon,
      /lucro=\{profit\?\.finance \? profit\?\.estimatedProfit \?\? null : null\}/,
      "a frase voltou a afirmar lucro sem base financeira",
    );
  }
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
