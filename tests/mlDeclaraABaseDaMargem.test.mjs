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

test("a declaracao da base fica VISIVEL SEM INTERACAO na coluna de Margem", async () => {
  // A licao do v207 e do defeito da Amazon em 31/08: declaracao que exige hover
  // nao declara.
  //
  // ⚠️ ESTA GUARDA JA MUDOU DE FORMA DUAS VEZES, e as duas estao
  // registradas aqui de proposito — teste que perde a historia e o primeiro a
  // ser afrouxado quando fica vermelho por outro motivo:
  //
  //   01/09/2026 — o `sub` era `sinais.length > 0 ? <SinaisDoResultado/> :
  //     margemSub`, ou seja a declaracao so aparecia QUANDO NAO HAVIA SINAL. A
  //     auditoria de empilhamento tirou os sinais dos cartoes e a declaracao
  //     passou a estar sempre no `sub`.
  //   11/09/2026 — o redesign v3 SUBSTITUIU o card `<Metric label="Margem">`
  //     pela coluna de Margem do `PainelV3`, e a declaracao ficou pelo caminho:
  //     `avaliarResultado` continuava calculando `margemSub` e o painel recebia
  //     `nota: ""`. Nada ficou vermelho na tela — a margem so apareceu sozinha,
  //     sem dizer sobre o que e. A guarda passou a casar o slot novo.
  //
  // O que ela garante nao mudou nas tres versoes: a base e LIDA sem hover.
  const ml = await fonte("src/app/components/MercadoLivreWorkspace.tsx");
  const painel = await fonte("src/app/components/PainelV3.tsx");
  // ⚠️ Sem comentario: a nota que explica a mudanca cita
  // `nota: ""` e `sub={margemSub}`, e casar o fonte cru aprovaria o comentario
  // no lugar do codigo.
  const semComentario = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const codigo = semComentario(ml);
  const codigoDoPainel = semComentario(painel);

  assert.match(codigo, /const margemSub = resultParcial/, "o calculo da declaracao sumiu");
  // A ponte: o painel recebe a declaracao, e nao uma string vazia. Casa o bloco
  // inteiro `margem: { ... nota: margemSub }` — `nota: margemSub` solto voltaria
  // a passar se alguem movesse a chave para outro objeto.
  assert.match(
    codigo,
    /margem: \{[\s\S]{0,400}?nota: margemSub,/,
    "a coluna de Margem voltou a nao declarar a base (nota vazia?)",
  );
  // E o painel EXIBE essa nota na linha sob o numero, sem interacao. String
  // literal, sem recorte e sem regex montada: guarda esperta que erra a
  // fronteira prova menos que guarda burra que acerta.
  assert.ok(
    codigoDoPainel.includes('{dados.margem.nota ? <span className="v3-coluna-share">{dados.margem.nota}</span> : null}'),
    "a nota da margem saiu da linha visivel do painel",
  );
  // ⚠️ E nao pode virar tooltip em nenhum dos dois lados.
  assert.ok(!/info=\{margemSub\}|info=\{baseDoResultado\}/.test(codigo), "a base foi parar no 'i'");
  assert.ok(!/title=\{dados\.margem\.nota\}/.test(codigoDoPainel), "a base foi parar num title=");
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
