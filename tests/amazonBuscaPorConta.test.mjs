import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Medido em producao em 28/08/2026: trocar de periodo na Amazon disparava TRES
// requisicoes (produtos, saldo e o briefing da central) contra duas nos outros
// canais — e o dashboard, o unico que depende do periodo, nem estava entre elas
// (o aquecimento ja o tinha). Produtos e saldo NAO tem periodo na pergunta;
// eram refeitos a cada clique so porque moravam num efeito com `[periodQuery]`.
//
// O conserto tem duas metades e as duas precisam continuar valendo:
//   1. quem nao depende do periodo nao ouve o periodo;
//   2. quem depende da CONTA ouve a conta — e troca de conta nao pode deixar
//      dado da loja anterior na tela, que seria a mentira de hoje elevada de
//      "outro periodo" para "outra loja".

const CAMINHO = "src/app/amazon/page.tsx";
const fonte = await readFile(new URL(`../${CAMINHO}`, import.meta.url), "utf8");

function efeitoQueContem(trecho) {
  const pos = fonte.indexOf(trecho);
  assert.notEqual(pos, -1, `nao achei ${trecho} em ${CAMINHO}`);
  const inicio = fonte.lastIndexOf("useEffect(", pos);
  const fim = fonte.indexOf("});", pos);
  const deps = /\}, \[([^\]]*)\]\);/.exec(fonte.slice(fim));
  return { corpo: fonte.slice(inicio, fim), deps: (deps?.[1] ?? "").trim() };
}

test("produtos e saldo nao sao refeitos quando so o periodo muda", () => {
  for (const rota of ["`/api/products`", "`/api/amazon/balance`"]) {
    const { deps } = efeitoQueContem(rota);
    assert.doesNotMatch(
      deps,
      /periodQuery/,
      `${CAMINHO}: ${rota} voltou para um efeito que depende do periodo. Nenhuma das duas ` +
        `respostas muda com o periodo — refazer a cada clique e so espera a mais para ela.`
    );
    assert.match(
      deps,
      /contaAtual/,
      `${CAMINHO}: ${rota} precisa ouvir a CONTA. Buscar so na montagem deixaria dado da ` +
        `loja anterior na tela depois de trocar de conta.`
    );
  }
});

test("o cache de produtos sabe de qual conta e, e decide o fetch", () => {
  // Guardar so as linhas faria o cache servir produtos de outra loja.
  assert.match(fonte, /let productsCache: \{ conta: string \| null; linhas: ProductRow\[\] \} \| null/);
  // E ele precisa ser consultado para PULAR a busca, nao so para o esqueleto:
  // era isso que existia antes e nao evitava requisicao nenhuma.
  assert.match(fonte, /if \(!productsCache \|\| productsCache\.conta !== contaAtual\)/);
});

test("troca de conta limpa a lista antes de pintar", () => {
  // Ajuste durante o render (padrao do React), nao efeito: efeito roda depois
  // da pintura, e ai a lista da loja anterior aparece por pelo menos um quadro.
  const bloco = fonte.slice(fonte.indexOf("const [contaDosProdutos"), fonte.indexOf("useEffect(", fonte.indexOf("const [contaDosProdutos")));
  assert.match(bloco, /if \(contaAtual !== contaDosProdutos\)/);
  assert.match(bloco, /setProducts\(\[\]\)/);
  // Mas a primeira vez que a conta fica conhecida (null -> conta) NAO limpa: a
  // lista que esta na tela ja e dela, e limpar seria um esqueleto gratuito.
  assert.match(bloco, /contaAtual !== null && contaDosProdutos !== null/);
});
