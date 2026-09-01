import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { TABELA_DE_COMISSAO_AMAZON_BR, comissaoPelaTabela } from "../src/lib/integrations/amazonTabelaDeComissao.ts";
import { categoriaDaTabela } from "../src/lib/integrations/amazonCategoriaDaTabela.ts";

// A tabela vem da pagina publica de precos da Amazon (venda.amazon.com.br/precos),
// capturada em 31/08/2026. Estes casos sao os que foram MEDIDOS de forma
// independente — no Gestor Seller e no nosso proprio extrato — e servem para
// provar que a copia esta certa, nao so que existe.

const daFolha = (folha, raiz) => {
  const r = categoriaDaTabela(folha, raiz);
  assert.ok(r, `sem mapeamento para ${folha} / ${raiz}`);
  return r.categoria;
};

test("a constante segue o VERBATIM da pagina, e a medicao e o alerta", () => {
  // ⚠️ ESTE TESTE MUDOU DE INTENCAO EM 01/09/2026, DUAS VEZES NO MESMO DIA.
  //
  // 1a versao: fixava os percentuais da leitura trazida ao chat.
  // 2a versao: eu troquei Papelaria e Beleza para 12% porque o NOSSO EXTRATO
  //   media 12,0x e uma reconstrucao do doc dizia 12%. Estava errado — eu deixei
  //   a medicao sobrepor a fonte.
  // 3a e atual: alguem abriu a pagina ao vivo, em duas leituras independentes.
  //   Ela diz 13% em Papelaria e Beleza. A pagina ganha, porque esta constante
  //   existe para ser a COPIA dela — nao a nossa melhor estimativa.
  //
  // 📌 A REGRA QUE SAI DISSO: quando a fonte e a medicao discordam, a fonte
  // manda na CONSTANTE e a medicao vira DIVERGENCIA REGISTRADA. Inverter isso
  // transforma a tabela publicada numa media nossa com outro nome — e ai ela
  // perde a unica coisa que a torna util, que e ser verificavel contra a pagina.
  assert.equal(comissaoPelaTabela(daFolha("Filete", "Papelaria e Escritório"), 100).percentual, 0.13);
  assert.equal(comissaoPelaTabela(daFolha("Utensílios e Acessórios", "Beleza"), 100).percentual, 0.13);
});

test("a divergencia entre pagina e extrato esta REGISTRADA, nao escondida", () => {
  // O extrato mede 12,0x onde a pagina diz 13% — em 1.274 pedidos de Papelaria e
  // 103 de Beleza. Pode ser promocional, mudanca recente, ou a nossa raiz de
  // catalogo nao ser a categoria de COBRANCA. Nao resolvido, e nao escondido.
  //
  // E a ordem observada > tabela protege: quem tem historico usa os 12% reais;
  // a tabela so alcanca ASIN sem historico, onde 1pp a mais e conservador e a
  // primeira venda real substitui.
  const fonte = fs.readFileSync(
    new URL("../src/lib/integrations/amazonTabelaDeComissao.ts", import.meta.url), "utf8");
  assert.match(fonte, /12,03%/, "a medicao de Papelaria precisa estar registrada");
  assert.match(fonte, /12,01%/, "a de Beleza tambem");
  assert.match(fonte, /divergencia|Divergência|DIVERGIRAM/i, "e precisa estar nomeada como divergencia");
});

test("os tres percentuais que foram medidos de forma independente batem", () => {
  // 12% nos kits de casa e cozinha — o que o Gestor Seller mostrava.
  assert.equal(comissaoPelaTabela(daFolha("Potes", "Casa"), 100).percentual, 0.12);
  assert.equal(comissaoPelaTabela(daFolha("Hashis", "Cozinha"), 100).percentual, 0.12);
  // 14% no cadarco — "Roupas e acessorios".
  assert.equal(comissaoPelaTabela(daFolha("Cadarços", "Moda"), 100).percentual, 0.14);
  // 15% no mouse pad, que e acessorio abaixo de R$ 100.
  assert.equal(comissaoPelaTabela(daFolha("Mouse Pads", "Computadores e Informática"), 49.9).percentual, 0.15);
});

test("a faixa e MARGINAL — 10% no EXCEDENTE, nao no preco inteiro", () => {
  // ⚠️ O DEFEITO QUE ISTO REPROVA (achado em 01/09/2026, na leitura verbatim da
  // pagina): "15% ate R$ 100,00; 10% NO EXCEDENTE" e faixa progressiva, como
  // imposto de renda — nao aliquota unica por banda, como faixa de frete.
  //
  // A primeira implementacao lia a banda e aplicava o percentual dela ao preco
  // INTEIRO. Errava para MENOS acima do teto, e errava mais quanto mais caro o
  // produto. Nao apareceu em teste nenhum porque tudo que a conta vende custa de
  // R$ 14 a R$ 38 — abaixo do teto as duas leituras coincidem, e o defeito so
  // nasceria no primeiro produto caro.
  const acessorio = daFolha("Mouse Pads", "Computadores e Informática");
  assert.equal(comissaoPelaTabela(acessorio, 100).valor, 15, "no teto: 15% de 100");
  // R$ 150 = 15% dos primeiros 100 (15,00) + 10% dos 50 excedentes (5,00).
  assert.equal(comissaoPelaTabela(acessorio, 150).valor, 20);
  assert.notEqual(comissaoPelaTabela(acessorio, 150).valor, 15,
    "10% sobre o preco inteiro seria R$ 15,00 — a leitura errada");
  // E o percentual DECLARADO e o efetivo: 20/150 = 13,33%.
  assert.equal(comissaoPelaTabela(acessorio, 150).percentual, 0.1333);
  // Movel tem teto proprio: R$ 300 = 15% de 200 (30) + 10% de 100 (10) = 40.
  assert.equal(comissaoPelaTabela(TABELA_DE_COMISSAO_AMAZON_BR["Móveis"], 300).valor, 40);
});

test("o minimo por item e PISO, nao acrescimo", () => {
  // ⚠️ Somar o minimo ao percentual inflaria toda venda barata. A Amazon cobra o
  // MAIOR entre os dois.
  const cozinha = TABELA_DE_COMISSAO_AMAZON_BR["Cozinha"]; // 12%, minimo R$ 2
  assert.equal(comissaoPelaTabela(cozinha, 100).valor, 12, "12% de 100 e maior que o minimo");
  assert.equal(comissaoPelaTabela(cozinha, 5).valor, 2, "12% de 5 e 0,60; o minimo de R$ 2 vence");
  assert.notEqual(comissaoPelaTabela(cozinha, 5).valor, 2.6, "minimo nao se soma ao percentual");
});

test("SEM PRECO NAO HA COMISSAO POR TABELA — nem com percentual unico", () => {
  // ⚠️ O caso do pedido pendente: a Amazon nao publicou o valor. O percentual e
  // conhecido, o VALOR nao — e o minimo por item tambem depende do preco.
  // Devolver o percentual sozinho como se fosse valor seria inventar.
  assert.equal(comissaoPelaTabela(TABELA_DE_COMISSAO_AMAZON_BR["Cozinha"], null), null);
  assert.equal(comissaoPelaTabela(TABELA_DE_COMISSAO_AMAZON_BR["Móveis"], null), null);
  assert.equal(comissaoPelaTabela(TABELA_DE_COMISSAO_AMAZON_BR["Cozinha"], 0), null,
    "preco zero e ausencia, nao brinde");
});

test("classificacao SEM MAPEAMENTO nao cai em 'Demais categorias'", () => {
  // ⚠️ O DEFEITO QUE ISTO REPROVA: "Demais categorias" e 15%. Aplica-lo a uma
  // categoria que na verdade e 10% infla a tarifa em 50%, com cara de numero
  // publicado — o pior desfecho possivel para uma feature cuja razao de ser e
  // procedencia. "Demais categorias" e para a categoria que a TABELA nao cobre,
  // nunca para o mapeamento que NOS nao fizemos.
  assert.equal(categoriaDaTabela("Categoria Que Nao Existe", "Raiz Que Nao Existe"), null);
  assert.equal(categoriaDaTabela(null, null), null);
});

test("a raiz ambigua de informatica NAO e mapeada — a folha decide", () => {
  // Um notebook (PC, 12% fixo) e um mouse pad (Acessorios, 15%/10%) moram na
  // MESMA raiz e pagam tarifas diferentes. Mapear a raiz escolheria uma das duas
  // para todo mundo; deixar sem mapeamento faz a duvida aparecer na tela.
  assert.equal(categoriaDaTabela(null, "Computadores e Informática"), null);
  const pad = categoriaDaTabela("Mouse Pads", "Computadores e Informática");
  assert.equal(pad.por, "folha");
  assert.equal(pad.categoria.nome, "Acessórios para eletrônicos e PC");
});

test("a folha tem precedencia sobre a raiz", () => {
  // Se a folha souber mais que a raiz, e a folha que vale — senao um acessorio
  // dentro de uma raiz generica herdaria a tarifa errada.
  const r = categoriaDaTabela("Mouse Pads", "Casa");
  assert.equal(r.categoria.nome, "Acessórios para eletrônicos e PC");
  assert.equal(r.por, "folha");
});

test("a tabela declara a FONTE e a DATA — copia sem data vira mentira", async () => {
  // A Amazon muda percentual sem aviso. Sem data, ninguem sabe se a copia foi
  // conferida ontem ou ha um ano.
  const { readFile } = await import("node:fs/promises");
  const fonte = await readFile(
    new URL("../src/lib/integrations/amazonTabelaDeComissao.ts", import.meta.url), "utf8");
  assert.match(fonte, /venda\.amazon\.com\.br\/precos/, "a URL da fonte precisa estar no arquivo");
  assert.match(fonte, /Capturada em:\*\* \d{2}\/\d{2}\/\d{4}/, "a data da captura precisa estar no arquivo");
});
