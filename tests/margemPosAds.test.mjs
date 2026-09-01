import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { margemPosAds, margemPosAdsDoCanal } from "../src/lib/margemPosAds.ts";

// A conta que a aba de Ads existe para mostrar: o que ESTE produto deixou no
// periodo, ja pago o anuncio. Os marketplaces nao conseguem fazer — eles nao
// sabem o custo dela.

const base = {
  provider: "amazon",
  productId: "B0HBGLBL6Y",
  sku: "kit-clips-320",
  titulo: "Kit clips 320",
  moeda: "BRL",
  gasto: 10,
  vendasAtribuidas: 200,
  pedidosAtribuidos: 4,
  acos: null,
  roas: null,
  janelaAtribuicao: "clicks14d",
  receitaPeriodo: 300,
  tarifaPeriodo: 45,
  custoPeriodo: 120,
  unidadesPeriodo: 6,
};

test("sobrou = receita - tarifa - custo - anuncio", () => {
  assert.equal(margemPosAds(base).sobrou, 125);
  assert.deepEqual(margemPosAds(base).falta, []);
});

test("produto anunciado que NAO vendeu da prejuizo do tamanho do anuncio", () => {
  // Receita 0, tarifa 0 e custo 0 sao FATO (nao vendeu), entao ha veredito — e
  // ele e a linha mais util da tela: dinheiro saindo sem retorno.
  const semVenda = { ...base, receitaPeriodo: 0, tarifaPeriodo: 0, custoPeriodo: 0, unidadesPeriodo: 0 };
  assert.equal(margemPosAds(semVenda).sobrou, -10);
});

test("tarifa nao postada e custo ausente NAO viram zero", () => {
  // `null` != `0` (AGENTS.md). Tratar tarifa ausente como zero deixaria o
  // "sobrou" otimista — afirmaria lucro que talvez nao exista.
  assert.deepEqual(margemPosAds({ ...base, tarifaPeriodo: null }), { sobrou: null, falta: ["tarifa"] });
  assert.deepEqual(margemPosAds({ ...base, custoPeriodo: null }), { sobrou: null, falta: ["custo"] });
  const doisFaltando = margemPosAds({ ...base, tarifaPeriodo: null, custoPeriodo: null });
  assert.equal(doisFaltando.sobrou, null);
  assert.deepEqual(doisFaltando.falta, ["tarifa", "custo"]);
});

test("o total do canal NAO engole produto sem veredito", () => {
  // Somar quem tem custo com quem nao tem afirmaria um resultado apoiado em
  // dado que nao existe. O total soma o que tem veredito e CONTA o resto, para
  // a tela dizer quantos ficaram de fora — com numero, nunca "parcial".
  const total = margemPosAdsDoCanal([base, { ...base, productId: "X", custoPeriodo: null }]);
  assert.equal(total.sobrou, 125);
  assert.equal(total.gasto, 20, "o gasto conta SEMPRE: ja saiu do bolso dela");
  assert.equal(total.produtosComVeredito, 1);
  assert.equal(total.produtosSemVeredito, 1);
});

test("nenhum produto com veredito: o canal responde '—', nunca zero", () => {
  const total = margemPosAdsDoCanal([{ ...base, custoPeriodo: null }]);
  assert.equal(total.sobrou, null, "zero diria 'nao sobrou nada', que e outra afirmacao");
  assert.equal(total.gasto, 10);
});

test("a conta mora em src/lib, alcancavel por quem nao e tela", async () => {
  // A regra que fecha a licao das tres copias do lucro: conta vive onde
  // qualquer consumidor alcanca. Se so a tela alcanca, a segunda tela escreve a
  // segunda copia — foi assim que o lucro da Amazon virou tres.
  const pagina = await readFile(new URL("../src/app/ads/page.tsx", import.meta.url), "utf8");
  assert.match(pagina, /from "@\/lib\/margemPosAds"/, "a tela importa a conta, nao reimplementa");
  assert.ok(
    !/receitaPeriodo\s*-\s*/.test(pagina),
    "a subtracao nao pode ser refeita na tela"
  );
  const rota = await readFile(new URL("../src/app/api/ads/route.ts", import.meta.url), "utf8");
  assert.ok(!/sobrou/i.test(rota.replace(/\/\*[\s\S]*?\*\//g, "")), "a rota entrega componentes, nao o resultado");
});

test("o comentario do POR QUE nao e por venda atribuida esta NO CODIGO", async () => {
  // Exigencia explicita: quem for "melhorar" isto daqui a tres meses precisa
  // esbarrar no motivo, e nao so no desenho que ninguem abre.
  const fonte = await readFile(new URL("../src/lib/margemPosAds.ts", import.meta.url), "utf8");
  assert.match(fonte, /venda atribu[ií]da/i);
  assert.match(fonte, /clicks14d/, "a janela que nao casa precisa estar nomeada");
  assert.match(fonte, /m[eé]dia/i, "e o motivo de nao poder usar media nossa tambem");
});

test("a aba de Ads NUNCA parte do lucro do canal — seria desconto duplo", async () => {
  // Fronteira definida em 30/08/2026: a partir dela o `estimatedProfit` dos
  // quatro canais JA INCLUI o ads, e quem consome esse numero nao subtrai de
  // novo. Este modulo parte de receita/tarifa/custo medidos, onde o ads AINDA
  // NAO entrou — entao subtrai. Juntar as duas rotas conta o mesmo dinheiro
  // duas vezes, que e a armadilha do `anuncioJaNoExtrato` da Amazon.
  //
  // ⚠️ A colisao aqui nao e de arquivo, e de SEMANTICA: o contrato de um numero
  // que a gente LE mudou sem que nenhum arquivo nosso fosse tocado. Portao de
  // commit nao pega isso; este teste pega.
  for (const caminho of [
    "src/lib/margemPosAds.ts",
    "src/lib/adsMultiCanal.ts",
    "src/app/ads/page.tsx",
    "src/app/api/ads/route.ts",
  ]) {
    const arquivo = await readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
    const codigo = arquivo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(
      !/estimatedProfit/.test(codigo),
      `${caminho}: lucro do canal ja inclui ads; descontar de novo conta duas vezes`
    );
  }
  const fonte = await readFile(new URL("../src/lib/margemPosAds.ts", import.meta.url), "utf8");
  assert.match(fonte, /ESTE MÓDULO USA \(b\)/, "o arquivo precisa declarar de onde parte");
});
