import test from "node:test";
import assert from "node:assert/strict";
import { TABELA_DE_COMISSAO_AMAZON_BR, comissaoPelaTabela } from "../src/lib/integrations/amazonTabelaDeComissao.ts";
import { categoriaDaTabela } from "../src/lib/integrations/amazonCategoriaDaTabela.ts";

// A tabela vem da pagina publica de precos da Amazon (venda.amazon.com.br/precos),
// capturada em 02/09/2026. Estes casos sao os que foram MEDIDOS de forma
// independente — no Gestor Seller e no nosso proprio extrato — e servem para
// provar que a copia esta certa, nao so que existe.

const daFolha = (folha, raiz) => {
  const r = categoriaDaTabela(folha, raiz);
  assert.ok(r, `sem mapeamento para ${folha} / ${raiz}`);
  return r.categoria;
};

test("os tres percentuais que foram medidos de forma independente batem", () => {
  // 12% nos kits de casa e cozinha — o que o Gestor Seller mostrava.
  assert.equal(comissaoPelaTabela(daFolha("Potes", "Casa"), 100).percentual, 0.12);
  assert.equal(comissaoPelaTabela(daFolha("Hashis", "Cozinha"), 100).percentual, 0.12);
  // 14% no cadarco — "Roupas e acessorios".
  assert.equal(comissaoPelaTabela(daFolha("Cadarços", "Moda"), 100).percentual, 0.14);
  // 15% no mouse pad, que e acessorio abaixo de R$ 100.
  assert.equal(comissaoPelaTabela(daFolha("Mouse Pads", "Computadores e Informática"), 49.9).percentual, 0.15);
});

test("a faixa de preco vira 10% acima do teto — e o teto e por CATEGORIA", () => {
  const acessorio = daFolha("Mouse Pads", "Computadores e Informática");
  assert.equal(comissaoPelaTabela(acessorio, 100).percentual, 0.15, "no teto ainda e 15%");
  assert.equal(comissaoPelaTabela(acessorio, 100.01).percentual, 0.10, "acima do teto cai para 10%");
  const moveis = TABELA_DE_COMISSAO_AMAZON_BR["Móveis"];
  assert.equal(comissaoPelaTabela(moveis, 200).percentual, 0.15);
  assert.equal(comissaoPelaTabela(moveis, 200.01).percentual, 0.10, "movel tem teto proprio, R$ 200");
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
