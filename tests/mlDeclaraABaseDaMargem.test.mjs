import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { BASE_SEM_DIFERENCA, declaracaoDeBase } from "../src/app/components/baseDaMargem.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

// O DEFEITO QUE ESTE ARQUIVO REPROVA — achado em 01/09/2026 no dashboard do ML.
//
// A tela AFIRMAVA a base errada, em texto fixo: o `sub` do card de Margem dizia
// "sobre o faturamento" enquanto lucro e margem eram calculados sobre
// `revenueProcessed`, o APURADO, e o card ao lado exibia `revenue30d`, o
// faturamento.
//
// ⚠️ Declarar a base ERRADA e pior que nao declarar: nao declarar deixa a pessoa
// desconfiar de dois numeros que nao fecham; declarar errado desliga a
// desconfianca. E o defeito da Amazon de 31/08 (numeros certos de universos
// diferentes lado a lado) com uma frase confirmando o universo errado.

test("a frase acompanha a base de VERDADE, e nao um texto fixo", () => {
  // Enquanto o denominador for o apurado, a tela tem de dizer isso com numero.
  const comDiferenca = declaracaoDeBase({
    baseApurada: 748.56, faturamentoExibido: 1068.37, moeda: "BRL", pedidosAguardando: 2,
  });
  assert.match(comDiferenca, /748,56/);
  assert.match(comDiferenca, /1\.068,37/);
  assert.match(comDiferenca, /2 pedidos aguardando/);

  // E quando o backend trocar o denominador para o faturamento, a frase some
  // SOZINHA — ninguem precisa lembrar de voltar aqui apagar.
  assert.equal(declaracaoDeBase({ baseApurada: 1068.37, faturamentoExibido: 1068.37, moeda: "BRL" }), null);
});

test("o ML usa a PECA compartilhada, com a base real e o faturamento do card", async () => {
  const ml = await fonte("src/app/components/MercadoLivreWorkspace.tsx");

  // Casar a chamada inteira: `declaracaoDeBase` continuaria no import depois de
  // alguem apagar o uso, e o texto fixo voltaria sem ninguem notar.
  assert.match(
    ml,
    /declaracaoDeBase\(\{\s*baseApurada: overview\.profit\.revenueDoLucro \?\? overview\.profit\.revenueProcessed,\s*faturamentoExibido: overview\.metrics\.revenue30d,/,
    "o ML voltou a nao declarar a base de verdade",
  );
  // ⚠️ E o texto fixo NAO pode voltar: era ele a mentira.
  assert.ok(
    !/comSemImposto\("sobre o faturamento", semAliquota\)/.test(ml),
    "voltou a afirmar 'sobre o faturamento' sem olhar a base",
  );
  // O fallback e a frase compartilhada, nao uma quinta variacao escrita aqui.
  assert.match(ml, /comSemImposto\(baseDoResultado \?\? BASE_SEM_DIFERENCA, semAliquota\)/);
  assert.equal(BASE_SEM_DIFERENCA, "sobre vendas");
});

test("a declaracao vai no SUB, nunca no tooltip", async () => {
  // A licao do v207 e do defeito da Amazon em 31/08: declaracao que exige hover
  // nao declara. `margemSub` alimenta o `sub` do card de Margem.
  const ml = await fonte("src/app/components/MercadoLivreWorkspace.tsx");
  assert.match(ml, /const margemSub = resultParcial/);
  assert.match(ml, /<Metric label="Margem"[^>]*sub=\{sinais\.length > 0 \? <SinaisDoResultado sinais=\{sinais\} \/> : margemSub\}/);
  // O `info` do card de Margem nao pode receber a base.
  const codigo = ml.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/info=\{margemSub\}|info=\{baseDoResultado\}/.test(codigo), "a base foi parar no 'i'");
});

test("pedido aguardando entra com NUMERO quando o backend nao mandar a contagem", async () => {
  // Sem `pedidosSemApuracao`, a causa da diferenca sai da cobertura que ja
  // existe — nunca fica sem numero, e nunca vira zero inventado.
  const ml = await fonte("src/app/components/MercadoLivreWorkspace.tsx");
  assert.match(
    ml,
    /pedidosAguardando: overview\.profit\.pedidosSemApuracao\s*\?\? Math\.max\(0, overview\.profit\.coverage\.paidOrders - overview\.profit\.coverage\.processedOrders\)/,
  );
});
