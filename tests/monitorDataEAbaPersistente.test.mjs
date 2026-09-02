import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dataHoraNaTabela, pareceData } from "../src/app/components/dataNaTabela.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (codigo) =>
  codigo.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * ⚠️ OS DOIS DEFEITOS QUE ISTO REPROVA foram reportados pela vendedora com print
 * em 02/09/2026, no monitor da conta da Shopee.
 */

test("DATA: o ISO cru vira dia e hora de Brasilia — nunca o Z na tela", () => {
  // O que ela viu: "2026-09-02T19:16:44.000Z" na coluna Data. Nao e so feio: o
  // Z e UTC, e o pedido das 16:16 dela aparecia como 19:16.
  const formatado = dataHoraNaTabela("2026-09-02T19:16:44.000Z");
  assert.equal(formatado, "02/09/2026 16:16", "a hora saiu do fuso de Brasilia");
  assert.ok(!/[TZ]/.test(formatado), "sobrou marca de ISO na tela");
});

test("e data PURA nao ganha hora inventada", () => {
  // "00:00" seria um horario que a fonte nao deu — a mesma regra do zero que
  // nao pode virar fato.
  assert.equal(dataHoraNaTabela("2026-09-02"), "02/09/2026");
});

test("valor ausente ou invalido devolve null, para a tela decidir o que mostrar", () => {
  for (const vazio of [null, undefined, "", "sem data", 42]) {
    assert.equal(dataHoraNaTabela(vazio), null, `${JSON.stringify(vazio)} devia devolver null`);
  }
});

test("a deteccao e pelo VALOR, nao pelo nome da coluna", () => {
  // ⚠️ A CAUSA DO DEFEITO era um recorte por nome: so formatava chaves
  // terminadas em "At", e a coluna se chama "date". Coluna nova com outro nome
  // nasceria crua de novo. Agora qualquer ISO completo e reconhecido.
  assert.ok(pareceData("2026-09-02T19:16:44.000Z"));
  assert.ok(pareceData("2026-09-02 19:16:44"));
  assert.ok(!pareceData("2026-09-02"), "data pura nao carrega hora");
  assert.ok(!pareceData("R$ 1.234,56"));
  assert.ok(!pareceData(42));
});

test("a tabela do monitor usa a peca — e nao formata por conta propria", async () => {
  const codigo = semComentarios(await fonte("src/app/components/ShopeeModulePage.tsx"));
  assert.match(codigo, /pareceData\(row\[key\]\)\?dataHoraNaTabela\(row\[key\]\)/,
    "a celula voltou a decidir formato por conta propria");
  assert.ok(!/endsWith\("At"\)/.test(codigo), "o recorte por sufixo de nome voltou");
});

test("ABA: ela vive na URL nos DOIS monitores — periodo e aba se preservam", async () => {
  // ⚠️ O DEFEITO, verbatim dela: *"clicando em pedidos e depois na data, joga de
  // volta para composicao"*. A aba era `useState` inicializado do endereco e
  // NUNCA escrito de volta: existia so na memoria do componente.
  //
  // A ancora e a DEFINICAO (de onde o valor nasce) e a ESCRITA (o clique), que
  // sao as duas pontas do defeito. Casar so o nome `secao` nao provaria nada.
  for (const [tela, aba] of [
    ["src/app/components/ShopeeModulePage.tsx", "pedidos"],
    ["src/app/components/TikTokModulePage.tsx", "transacoes"],
  ]) {
    const codigo = semComentarios(await fonte(tela));
    assert.ok(!/useState<"[a-z|"]*">\([a-z]*\.get\("secao"\)/.test(codigo),
      `${tela}: a aba voltou a ser estado local`);
    // ⚠️ COMPARACAO LITERAL, sem regex montada em template: `` e `\.` dentro
    // de template literal deixam de significar o que parecem (caso do catalogo,
    // 02/09/2026). Chata e verificavel ganha de esperta e silenciosa.
    assert.ok(codigo.includes(`.get("secao")==="${aba}"`), `${tela}: a aba deixou de nascer da URL`);
    assert.ok(codigo.includes("const secao:"), `${tela}: a aba deixou de ser derivada da URL`);
    assert.match(codigo, /onClick=\{\(\)=>update\(\{secao:key\}\)\}/,
      `${tela}: o clique deixou de escrever a aba na URL`);
  }
});

test("e trocar de aba nao dispara busca nova — a chave nao carrega a aba", async () => {
  // Se `secao` entrasse na chave da busca, cada clique de aba viraria uma ida ao
  // servidor para trazer exatamente a mesma lista.
  const { shopeeModuleQuery } = await import("../src/app/components/ShopeeModulesModel.ts");
  const base = "connection_id=shopee:1&offset=0";
  assert.equal(
    shopeeModuleQuery(`${base}&secao=composicao`, "shopee:1", "costs"),
    shopeeModuleQuery(`${base}&secao=pedidos`, "shopee:1", "costs"),
    "a aba passou a mudar a chave da busca",
  );
});
