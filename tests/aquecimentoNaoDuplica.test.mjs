import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { chaveDeVoo, controleDoEscopo, criaControleDeVoo } from "../src/app/components/controleDeVoo.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

// O DEFEITO QUE ESTE ARQUIVO REPROVA (medido em 31/08/2026).
//
// `prefetchDePeriodos.ts` tem duas bocas pedindo ao servidor — a fila de fundo e
// a antecipacao por hover — e a tela tem uma terceira, a busca do clique. O
// comentario em cima do `emVoo` afirmava que as bocas do hook compartilhavam o
// conjunto. A FRASE ERA FALSA: so a antecipacao registrava e consultava. Passar
// o mouse sobre a janela que a fila ja estava buscando emitia uma SEGUNDA
// requisicao simultanea da mesma janela, no arquivo cujo proprio comentario diz
// que simultaneas atrasam a tela aberta.
//
// Nenhum teste pegava porque nao havia teste — e um teste de fonte que casasse
// `emVoo` teria ficado verde, ja que o simbolo existia.

test("a mesma janela nao sai duas vezes: a segunda ESPERA a mesma ida", async () => {
  const voo = criaControleDeVoo();
  const chave = chaveDeVoo("conta-1", "days=15");
  let idas = 0;
  let libera;
  const busca = () => { idas += 1; return new Promise((r) => { libera = () => r("resultado"); }); };

  const primeira = voo.umaVezSo(chave, busca);
  const segunda = voo.umaVezSo(chave, busca);
  assert.equal(idas, 1, "a segunda boca nao pode emitir requisicao nova");
  assert.equal(voo.noAr(chave), true);

  libera();
  // ⚠️ A SEGUNDA TEM DE RECEBER O RESULTADO, nao desistir. A primeira versao so
  // sabia recusar, e isso deixaria a TELA sem dado quando o clique caisse em
  // cima de um aquecimento em voo.
  assert.equal(await primeira, "resultado");
  assert.equal(await segunda, "resultado");
  assert.equal(idas, 1);
});

test("depois de terminar, a janela pode ser buscada de novo", async () => {
  const voo = criaControleDeVoo();
  const chave = chaveDeVoo("conta-1", "days=7");
  let idas = 0;
  const busca = () => { idas += 1; return Promise.resolve(idas); };

  await voo.umaVezSo(chave, busca);
  assert.equal(voo.noAr(chave), false, "terminou, tem de liberar a vez");
  await voo.umaVezSo(chave, busca);
  assert.equal(idas, 2);
});

test("falha tambem libera a vez", async () => {
  // Sem isto, uma janela que falhou no aquecimento ficaria travada para sempre e
  // o CLIQUE nela nunca mais buscaria — trocar um desperdicio por uma tela que
  // nao carrega e piorar.
  const voo = criaControleDeVoo();
  const chave = chaveDeVoo("conta-1", "days=30");
  await voo.umaVezSo(chave, () => Promise.reject(new Error("caiu"))).catch(() => {});
  assert.equal(voo.noAr(chave), false);
  assert.equal(await voo.umaVezSo(chave, () => Promise.resolve("ok")), "ok");
});

test("escopos diferentes nao disputam a mesma vez", async () => {
  // Trocar de loja tem de reaquecer. Se a chave ignorasse o escopo, a janela da
  // loja A bloquearia a mesma janela da loja B e a segunda loja abriria fria.
  const voo = criaControleDeVoo();
  let idas = 0;
  const busca = () => { idas += 1; return Promise.resolve(idas); };
  await Promise.all([
    voo.umaVezSo(chaveDeVoo("conta-1", "days=7"), busca),
    voo.umaVezSo(chaveDeVoo("conta-2", "days=7"), busca),
  ]);
  assert.equal(idas, 2);
});

test("o controle de um escopo e o MESMO para todo mundo", () => {
  // E o que permite a busca da propria tela passar pela mesma porta do hook.
  // Instancia por componente deixaria o clique por fora, e o defeito voltaria
  // pelo lado de fora do hook.
  assert.equal(controleDoEscopo("ads"), controleDoEscopo("ads"));
  assert.notEqual(controleDoEscopo("ads"), controleDoEscopo("monitor"));
});

test("AS DUAS bocas do hook passam pelo controle — nao so a antecipacao", async () => {
  const hook = await fonte("src/app/components/prefetchDePeriodos.ts");

  // Casar a RAMIFICACAO em cada boca, nao o identificador: `controleDoEscopo`
  // continuaria no import depois de alguem apagar a guarda da fila, que e
  // exatamente o estado em que este arquivo estava.
  assert.match(hook, /if \(voo\.noAr\(chave\)\) continue;/, "a FILA DE FUNDO voltou a nao consultar o controle");
  assert.match(hook, /await voo\.umaVezSo\(chave, \(\) => buscar\(periodo, controller\.signal\)\)/, "a fila voltou a buscar por fora do controle");
  assert.match(hook, /if \(controleDoEscopo\(atualCtx\.escopo\)\.noAr\(chave\)\) return;/, "a ANTECIPACAO voltou a nao consultar o controle");
  assert.match(hook, /\.umaVezSo\(chave, \(\) => atualCtx\.buscar\(periodo, controller\.signal\)\)/);

  // E o conjunto solto nao pode voltar: era ele que dava a falsa sensacao de
  // invariante compartilhada.
  assert.ok(!/emVoo/.test(hook), "voltou o Set solto que so uma das bocas usava");
});

test("a fila de fundo e OPCIONAL, e /ads NAO a liga", async () => {
  // A condicao do cerebro ao aprovar o acrescimo: o numero de requisicoes NAO
  // pode subir. Fila de fundo custa tres requisicoes por sessao, SEMPRE — nem
  // sequer depende de a pessoa trocar de periodo. A antecipacao sozinha so
  // busca o que ela esta prestes a pedir.
  const hook = await fonte("src/app/components/prefetchDePeriodos.ts");
  assert.match(hook, /if \(!filaDeFundo \|\| !ativo/, "a fila voltou a ser obrigatoria");
  // ⚠️ CASAR DENTRO DA CHAMADA, nao a string solta. A primeira versao desta
  // linha procurava `/filaDeFundo: false/` no arquivo inteiro — e o COMENTARIO
  // logo acima da chamada contem essa mesma frase. Apagar a propriedade deixava
  // o teste VERDE. Peguei na rodada de quebras, que e exatamente para isso.
  assert.match(
    await fonte("src/app/ads/page.tsx"),
    /usePrefetchDePeriodos\(\{[\s\S]{0,600}filaDeFundo: false,\s*\}\);/,
    "/ads ligou a fila de fundo sem necessidade",
  );
});

test("a busca da propria tela de /ads passa pelo controle de voo", async () => {
  // A OUTRA condicao: o cache novo tem de usar a MESMA porta do hook. Sem isso,
  // ligar a antecipacao aqui recria a duplicacao que acabou de ser corrigida —
  // dessa vez pelo lado de fora do hook, onde o teste do hook nao alcanca. O
  // hover antecipa e o clique busca com 120ms de diferenca: e o caso comum, nao
  // o raro.
  const pagina = await fonte("src/app/ads/page.tsx");
  assert.match(
    pagina,
    /controleDoEscopo\(ESCOPO_DE_ADS\)\.umaVezSo\(chaveDeVoo\(ESCOPO_DE_ADS, query\)/,
    "a busca de /ads voltou a sair por fora do controle",
  );
  // E o efeito da tela tem de usar essa porta, nao um fetch proprio.
  assert.ok(!/fetch\(`\/api\/ads/.test(pagina.slice(pagina.indexOf("function Ads()"))), "voltou um fetch direto dentro do componente");
  assert.match(pagina, /onIntent=\{aquecerAgora\}/, "a antecipacao saiu do filtro");
});
