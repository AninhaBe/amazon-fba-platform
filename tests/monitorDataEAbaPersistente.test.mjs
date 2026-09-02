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
    // O clique escreve a aba E preserva o offset atual — ver o teste da chave
    // da busca, no fim deste arquivo, que explica por que o offset vai junto.
    assert.ok(codigo.includes("update({secao:key,offset:"), `${tela}: o clique deixou de escrever a aba na URL`);
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

test("TROCAR DE ABA NAO MUDA A CHAVE DA BUSCA — nem quando a URL nao tem offset", async () => {
  // ⚠️ O DEFEITO QUE ISTO REPROVA (02/09/2026): ela reportou "os botoes do
  // monitor da conta nao funcionam", com o console LIMPO. Nao era JS morto: o
  // clique injetava `offset=0` numa URL que nao tinha offset, a chave da busca
  // mudava, o efeito re-disparava e `setPayload(null)` apagava a tela — numa
  // conta com 10.126 vendas. Do lado de ca: clicou e ficou segundos igual.
  //
  // Botao morto e busca inteira sao indistinguiveis para quem olha.
  const { shopeeModuleQuery } = await import("../src/app/components/ShopeeModulesModel.ts");
  const CONN = "shopee:275804987";

  // A logica do `update`, transcrita — e a assercao de fonte logo abaixo impede
  // que a transcricao envelheca.
  const update = (atual, values) => {
    const next = new URLSearchParams(atual);
    for (const [chave, valor] of Object.entries(values)) {
      if (valor) next.set(chave, valor); else next.delete(chave);
    }
    if (!("offset" in values)) next.set("offset", "0");
    return next.toString();
  };

  for (const url of [
    `connection_id=${CONN}&days=30`,          // o caso dela: SEM offset
    `connection_id=${CONN}&days=30&offset=50`, // e o caso de quem paginou
  ]) {
    const antes = shopeeModuleQuery(url, CONN, "monitor");
    const depois = shopeeModuleQuery(update(url, { secao: "pedidos", offset: new URLSearchParams(url).get("offset") }), CONN, "monitor");
    assert.equal(depois, antes, `trocar de aba mudou a chave da busca (${url})`);
  }

  // E a tela precisa REALMENTE passar o offset atual no clique.
  const tela = semComentarios(await fonte("src/app/components/ShopeeModulePage.tsx"));
  assert.ok(tela.includes('update({secao:key,offset:params.get("offset")})'),
    "o clique voltou a deixar o update injetar offset=0");
  const tiktok = semComentarios(await fonte("src/app/components/TikTokModulePage.tsx"));
  assert.ok(tiktok.includes('update({secao:key,offset:sp.get("offset")})'),
    "o mesmo defeito continua no monitor do TikTok");
});
