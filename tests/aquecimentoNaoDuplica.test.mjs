import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { chaveDeVoo, criaControleDeVoo } from "../src/app/components/controleDeVoo.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

// O DEFEITO QUE ESTE ARQUIVO REPROVA (medido em 31/08/2026).
//
// `prefetchDePeriodos.ts` tem DUAS bocas pedindo ao servidor: a fila de fundo e
// a antecipacao por hover. O comentario em cima do `emVoo` afirmava que as duas
// compartilhavam o conjunto — e nao compartilhavam: so a antecipacao registrava
// e consultava. Passar o mouse sobre a janela que a fila ja estava buscando
// emitia uma SEGUNDA requisicao simultanea da mesma janela, no arquivo cujo
// proprio comentario diz que requisicoes simultaneas atrasam a tela aberta.
//
// A frase estava certa e o codigo nao. Nenhum teste pegava porque nao havia
// teste — e um teste de fonte que casasse `emVoo` teria ficado verde, ja que o
// simbolo existia. Por isso a invariante virou peca com comportamento proprio.

test("a mesma janela nao sai duas vezes ao mesmo tempo", () => {
  const voo = criaControleDeVoo();
  const chave = chaveDeVoo("conta-1", "days=15");

  assert.equal(voo.tentar(chave), true, "a primeira boca pode buscar");
  assert.equal(voo.tentar(chave), false, "a segunda boca NAO pode: ja esta no ar");
  assert.equal(voo.noAr(chave), true);

  voo.concluir(chave);
  assert.equal(voo.noAr(chave), false);
  assert.equal(voo.tentar(chave), true, "depois de concluir, pode de novo");
});

test("falha tambem libera a vez", () => {
  // Sem isto, uma janela que falhou no aquecimento ficaria travada para sempre
  // e o CLIQUE nela nunca mais buscaria — trocar um desperdicio por uma tela
  // que nao carrega e piorar.
  const voo = criaControleDeVoo();
  const chave = chaveDeVoo("conta-1", "days=30");
  voo.tentar(chave);
  voo.concluir(chave); // o `finally` do hook chama isto tanto no ok quanto no erro
  assert.equal(voo.tentar(chave), true);
});

test("escopos diferentes nao disputam a mesma vez", () => {
  // Trocar de loja tem de reaquecer. Se a chave ignorasse o escopo, a janela da
  // loja A bloquearia a mesma janela da loja B e a segunda loja abriria fria.
  const voo = criaControleDeVoo();
  assert.equal(voo.tentar(chaveDeVoo("conta-1", "days=7")), true);
  assert.equal(voo.tentar(chaveDeVoo("conta-2", "days=7")), true);
});

test("AS DUAS bocas passam pelo controle — nao so a antecipacao", async () => {
  const hook = await fonte("src/app/components/prefetchDePeriodos.ts");

  // Casar a RAMIFICACAO em cada boca, nao o identificador: `criaControleDeVoo`
  // continuaria no import depois de alguem apagar a guarda da fila, que e
  // exatamente o estado em que este arquivo estava.
  assert.match(hook, /if \(!voo\.current\.tentar\(chave\)\) continue;/, "a FILA DE FUNDO voltou a nao consultar o controle");
  assert.match(hook, /if \(!voo\.current\.tentar\(chave\)\) return;/, "a ANTECIPACAO voltou a nao consultar o controle");

  // Duas liberacoes: uma por boca. Uma so significa que alguem esquece de soltar.
  assert.equal((hook.match(/voo\.current\.concluir\(chave\)/g) ?? []).length, 2);

  // A da fila tem de estar em `finally` — no `catch` com `return` antes dela, a
  // janela que falhou ficaria travada.
  assert.match(hook, /\} finally \{[\s\S]{0,200}voo\.current\.concluir\(chave\);/);

  // E o conjunto solto nao pode voltar: era ele que dava a falsa sensacao de
  // invariante compartilhada.
  assert.ok(!/emVoo\.current/.test(hook), "voltou o Set solto que so uma das bocas usava");
});
