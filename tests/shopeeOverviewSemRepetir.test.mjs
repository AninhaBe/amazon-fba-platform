import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { chaveDaBusca } from "../src/app/components/chaveDaBusca.ts";

// Medido em producao em 28/08/2026: a Shopee pedia /api/integrations/shopee/
// overview TRES VEZES antes da primeira pintura (1050ms, 1706ms, 2142ms), e e a
// rota mais cara medida (1457ms em 30 dias na conta real). Duas dessas idas
// eram identicas, com 5ms de diferenca: o efeito dependia de `status` e
// `searchParams`, objetos cuja referencia muda sem que a pergunta mude.
//
// ⚠️ O RISCO DO CONSERTO E O OPOSTO DO DEFEITO. Guarda contra repeticao e onde
// se introduz "nao atualiza mais quando deveria". O que tinha de morrer e so a
// repeticao IDENTICA; todo gatilho legitimo continua passando.
//
// ⚠️ E POR QUE ESTE TESTE MUDOU DE FORMA: a primeira versao conferia se
// `retryKey` e `syncPoll` apareciam no TEXTO da linha que montava a chave.
// Extrair a montagem para uma variavel deixou o teste vermelho sem nada ter
// mudado de comportamento — e o vermelho chegou a ser lido como "a tela
// congelou durante a sincronizacao", que era exatamente o risco vigiado. Casar
// texto trava a FORMA, nao a REGRA: reprova refatoracao inocente e aprovaria
// uma mudanca que mantivesse o texto e quebrasse a logica. Agora a chave e
// funcao pura e o teste a CHAMA. Ver ADR-017.

const BASE = { loja: "shopee:demo", periodo: "days=7", offset: "0", tentativa: 0, sincronizacao: 0 };

test("cada gatilho legitimo produz chave diferente — logo nunca e barrado", () => {
  const original = chaveDaBusca(BASE).alvo;
  const mudancas = {
    // O que faz a tela acompanhar a primeira sincronizacao sozinha. Se ele
    // parar de mudar a chave, o vendedor deixa de ver o numero de pedidos
    // crescer e precisa recarregar a pagina.
    sincronizacao: { ...BASE, sincronizacao: 1 },
    // O botao de tentar de novo.
    tentativa: { ...BASE, tentativa: 1 },
    periodo: { ...BASE, periodo: "days=30" },
    offset: { ...BASE, offset: "100" },
    loja: { ...BASE, loja: "shopee:outra" },
  };
  for (const [gatilho, entrada] of Object.entries(mudancas)) {
    assert.notEqual(
      chaveDaBusca(entrada).alvo,
      original,
      `mexer em \`${gatilho}\` tem de mudar a chave; chave igual = busca barrada = tela parada.`
    );
  }
});

test("so a repeticao identica produz chave igual", () => {
  assert.equal(chaveDaBusca(BASE).alvo, chaveDaBusca({ ...BASE }).alvo);
});

test("a janela ignora a loja, e e isso que reconhece a ida sem connection_id", () => {
  // A primeira ida sai SEM loja para o servidor resolver a padrao. Quando o
  // status chega e o componente resolve a MESMA padrao, e a janela que diz
  // "a resposta que esta vindo ja e dessa pergunta".
  assert.equal(chaveDaBusca(BASE).janela, chaveDaBusca({ ...BASE, loja: null }).janela);
  // Mas a identidade completa distingue: duas lojas sao duas perguntas.
  assert.notEqual(chaveDaBusca(BASE).alvo, chaveDaBusca({ ...BASE, loja: null }).alvo);
  // E a janela continua reagindo a tudo que nao e loja.
  assert.notEqual(chaveDaBusca(BASE).janela, chaveDaBusca({ ...BASE, sincronizacao: 1 }).janela);
});

// As duas asercoes abaixo SAO de fonte de proposito, e cabem: elas proibem um
// PADRAO (remontar a chave a mao; depender de objeto instavel), nao verificam
// logica. Essa e a fronteira que a licao do ADR-017 desenha.
test("o componente usa a funcao, em vez de remontar a chave a mao", async () => {
  const fonte = await readFile(new URL("../src/app/components/ShopeeWorkspace.tsx", import.meta.url), "utf8");
  assert.match(fonte, /import \{ chaveDaBusca \} from "\.\/chaveDaBusca";/);
  assert.match(fonte, /chaveDaBusca\(\{/);
});

test("o efeito do overview nao depende de objetos instaveis", async () => {
  const fonte = await readFile(new URL("../src/app/components/ShopeeWorkspace.tsx", import.meta.url), "utf8");
  const inicio = fonte.indexOf("ABERTURA SEM ESPERAR");
  const deps = /\}, \[([^\]]*)\]\);/.exec(fonte.slice(inicio))?.[1] ?? "";
  assert.notEqual(deps, "", "nao achei a lista de dependencias do efeito do overview");
  assert.doesNotMatch(
    deps,
    /searchParams/,
    "`searchParams` e objeto: referencia nova a cada render do roteador refaz o mesmo pedido. " +
      "Dependa dos valores lidos dele (connection_id e offset), que sao strings."
  );
  // `syncPoll` e `retryKey` na dependencia: sem eles o efeito nem roda, e ai
  // nenhuma guarda importa — a tela congela antes.
  assert.match(deps, /syncPoll/);
  assert.match(deps, /retryKey/);
});
