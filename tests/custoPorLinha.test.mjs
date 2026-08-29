import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { comCustoSalvo, custoExibido, custoValido, proximoEstado, ROTULO_DO_CUSTO, salvarCusto }
  from "../src/app/components/custoPorLinha.ts";

// Pedido da dona do produto em 29/08/2026, nas palavras dela: "quero apenas
// digitar, salvar, sem ter nenhum carregamento a partir disso".
//
// O que causava o carregamento nao era recarga do navegador: o save chamava
// `retry()`, que subia o contador de tentativa; o efeito do modulo zera o
// payload e a tela INTEIRA virava esqueleto. Perdia scroll e foco, e ainda
// eram DUAS idas ao servidor para buscar um valor que o POST ja devolvia.
//
// Os tres testes abaixo travam o que se perde numa refatoracao futura.

test("uma linha salva atualiza TODAS as linhas do mesmo custo", () => {
  // Enquanto o custo for por anuncio, um anuncio com variacoes mostra varias
  // linhas que dividem o MESMO id de custo. A recarga atualizava todas sem
  // querer. Patch por LINHA atualizaria uma e deixaria a outra com o valor
  // velho — e ela concluiria, com razao, que nao salvou.
  const linhaA = { id: "shopee:loja:sku-1", cost: 10 };
  const linhaB = { id: "shopee:loja:sku-1", cost: 10 };  // outra variacao, mesmo custo
  const outra  = { id: "shopee:loja:sku-2", cost: 30 };
  const patch = comCustoSalvo({}, "shopee:loja:sku-1", 25);
  assert.equal(custoExibido(patch, linhaA), 25);
  assert.equal(custoExibido(patch, linhaB), 25, "a segunda variacao ficou com o valor velho na tela");
  assert.equal(custoExibido(patch, outra), 30, "linha de outro custo nao pode se mexer");
});

test("salvar dispara UMA requisicao e mais nenhuma", async () => {
  // Se alguem reintroduzir o retry por conveniencia, o contador passa de 1.
  const chamadas = [];
  const buscar = async (url, opcoes) => {
    chamadas.push({ url, metodo: opcoes.method });
    return { ok: true, json: async () => ({ entry: { id: "c1", cost: 25 } }) };
  };
  const salvo = await salvarCusto({ url: "/api/x/costs?connection_id=1", corpo: { productId: "p", cost: 25 }, buscar });
  assert.equal(chamadas.length, 1, `esperava 1 requisicao, houve ${chamadas.length}`);
  assert.equal(chamadas[0].metodo, "POST");
  // E o valor exibido vem do SERVIDOR, nao do que foi digitado: e ele quem normaliza.
  assert.deepEqual(salvo, { chave: "c1", valor: 25 });
});

test("o erro fica na tela ate ela mexer no campo", () => {
  // Antes, a recarga apagava a falha e devolvia o campo ao valor antigo — dava
  // para sair da tela achando que salvou.
  let estado = proximoEstado("saving", "falhou");
  assert.equal(estado, "error");
  assert.equal(proximoEstado(estado, "ok"), "saved", "so uma nova acao muda o estado");
  assert.equal(proximoEstado("error", "editou"), "idle", "mexer no campo limpa o erro");
  // Invalido segue a mesma regra e NAO se confunde com falha de rede.
  assert.equal(proximoEstado("idle", "invalido"), "invalido");
  assert.equal(proximoEstado("invalido", "editou"), "idle");
});

test("vazio e negativo nao sao custo; zero e um fato", () => {
  assert.equal(custoValido(""), null);
  assert.equal(custoValido("   "), null);
  assert.equal(custoValido("-1"), null);
  assert.equal(custoValido("abc"), null);
  assert.equal(custoValido("0"), 0, "zero e valor conhecido, nao ausencia");
  assert.equal(custoValido("12.5"), 12.5);
});

test("as quatro telas falam a MESMA lingua para o mesmo estado", async () => {
  // Quatro vocabularios para o mesmo estado e divida que so aparece quando
  // alguem le as quatro juntas — e quem le as quatro juntas e a dona do produto.
  assert.deepEqual(
    { ...ROTULO_DO_CUSTO },
    { saving: "Salvando…", saved: "Salvo", error: "Falha ao salvar", pendente: "Pendente" }
  );
  for (const caminho of ["src/app/components/ShopeeModulePage.tsx", "src/app/components/TikTokModulePage.tsx"]) {
    const fonte = await readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
    assert.ok(fonte.includes("ROTULO_DO_CUSTO"), `${caminho}: use o vocabulario compartilhado, nao frases proprias`);
    assert.ok(!fonte.includes("onSaved={retry}"), `${caminho}: o salvar voltou a recarregar a lista`);
  }
});
