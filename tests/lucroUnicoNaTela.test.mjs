import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { amazonFinancialCards, lucroDoPeriodo } from "../src/app/amazon/amazonFinancialCards.ts";

// O DEFEITO (relatado por ela em 29/08/2026): a mesma tela da Amazon exibia
// DOIS numeros chamados lucro com sinais OPOSTOS — -R$ 35,61 na faixa de cards e
// +R$ 365,53 no painel de composicao, com selo verde de "Composicao completa".
// A diferenca era exatamente a maior despesa do periodo: o anuncio.
//
// A causa: a decisao dela de 25/08 ("o card de lucro passa a descontar tambem o
// ads") foi aplicada ao CARD e nao ao PAINEL. Ela relatou uma vez, recebeu
// metade do conserto, e achou a outra metade quatro dias depois.
//
// Estes testes existem para que a conta so possa morar em UM lugar.
//
// ⚠️⚠️ A INTENCAO DESTE ARQUIVO MUDOU EM 30/08/2026, E O PORQUE ESTA AQUI.
//
// Ate aqui ele exigia que a subtracao do anuncio morasse em UM lugar DA TELA DA
// AMAZON (`lucroDoPeriodo`). Essa exigencia estava certa e resolvia o defeito
// relatado — e ainda assim o andar estava errado. Enquanto a tela da Amazon
// ganhava a terceira copia da conta, MERCADO LIVRE, MONITOR e HOME nao
// descontavam anuncio NENHUM: R$ 2.827,10 de gasto fora do lucro, medidos em
// 30/08/2026 (R$ 2.411,25 no ML em 3 dias, R$ 415,85 na Amazon em 19).
//
// A subtracao subiu para quem PRODUZ o numero, sob a fronteira escrita em
// `src/lib/financialMath.ts`: **`estimatedProfit` ja inclui o anuncio, e quem
// consome nao subtrai de novo.** Com isso:
//   - `gastoComAnuncioDoPeriodo` DEIXOU DE EXISTIR: decidir "quanto de anuncio
//     entra e se ele e desconhecido" e trabalho do canonico (`anuncioDoCanal` +
//     `descontarAnuncio`), nao de um modulo de tela. Manter a funcao aqui seria
//     manter a segunda copia da regra que a fronteira existe para proibir.
//   - `lucroDoPeriodo` virou LEITOR: le o lucro que chegou pronto e diz o que
//     foi descontado.
// Por isso os fixtures abaixo passaram a trazer `estimatedProfit` JA LIQUIDO de
// anuncio (-17,33 = 295,65 - 312,98) e `adsNoLucro` com o que foi descontado.
// O assert nao foi "ajustado" para a nova saida: a PERGUNTA e que mudou, de
// "quem subtrai?" para "alguem alem do produtor subtrai?".

const FINANCE = {
  currency: "BRL",
  revenue: 1000,
  fees: 0,
  refunds: 0,
  buyerShipping: 0,
  orderCount: 16,
  feeBreakdown: [{ type: "commission", amount: 0 }],
};
const ADS = { cost: 312.98, sales: 496.16, purchases: 16, ateDia: "2026-08-24", esperadoAte: "2026-08-24" };
// O lucro chega PRONTO do produtor: 295,65 antes do anuncio, 312,98 de anuncio.
const LUCRO_COM_ANUNCIO = -17.33;
const base = {
  finance: FINANCE, cogs: 200, unitsWithoutCost: 0, adsConectado: true,
  estimatedProfit: LUCRO_COM_ANUNCIO, adsNoLucro: ADS.cost,
};

const carta = (cards, key) => cards.find((c) => c.key === key);
const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

test("card e painel leem o MESMO lucro, e nenhum dos dois subtrai", () => {
  const { lucro, gastoComAnuncio } = lucroDoPeriodo({ ...base, ads: ADS });
  assert.equal(lucro, LUCRO_COM_ANUNCIO, "o leitor devolve o lucro como o produtor mandou");
  assert.equal(gastoComAnuncio, ADS.cost, "e diz o que foi descontado, para a cascata escrever");
  assert.equal(carta(amazonFinancialCards({ ...base, ads: ADS }), "profit").raw, lucro);
  assert.ok(lucro < 0, "com R$ 312,98 de anuncio sobre R$ 295,65, o resultado e negativo");
});

test("a tela NAO desconta o anuncio de novo", () => {
  // A guarda que substitui a antiga checagem de `jaNoExtrato`. Aquela protegia
  // contra dupla contagem DENTRO da tela; a fronteira protege contra a tela
  // inteira contar de novo o que o produtor ja tirou.
  const cards = amazonFinancialCards({ ...base, ads: ADS });
  assert.equal(carta(cards, "profit").raw, LUCRO_COM_ANUNCIO);
  assert.notEqual(
    carta(cards, "profit").raw,
    +(LUCRO_COM_ANUNCIO - ADS.cost).toFixed(2),
    "descontar o anuncio aqui contaria o mesmo dinheiro duas vezes",
  );
});

test("lucro desconhecido chega como `null` do produtor e a tela repete `null`", () => {
  // `null` != `0` (AGENTS.md). Quem decide isso agora e `anuncioDoCanal`: canal
  // que anuncia e sem metrica no periodo produz lucro `null`. A tela nao tem
  // mais opiniao sobre o assunto — e nao pode ter, ou seriam duas regras.
  const r = lucroDoPeriodo({ ...base, estimatedProfit: null, adsNoLucro: null });
  assert.equal(r.lucro, null);
  assert.equal(r.desconhecido, true);
  assert.equal(carta(amazonFinancialCards({ ...base, estimatedProfit: null, adsNoLucro: null }), "profit").raw, null);
});

test("quem nao anuncia tem lucro conhecido", () => {
  // Sem anuncio, o produtor manda o lucro cheio e `adsNoLucro` zero: ausencia
  // de anuncio e FATO, nao lacuna.
  const semAds = { ...base, estimatedProfit: 295.65, adsNoLucro: 0, ads: null, adsConectado: false };
  assert.equal(lucroDoPeriodo(semAds).lucro, 295.65);
  assert.equal(lucroDoPeriodo(semAds).desconhecido, false);
  assert.equal(carta(amazonFinancialCards(semAds), "profit").raw, 295.65);
});

test("a tela da Amazon nao recalcula o anuncio por conta propria", async () => {
  // A trava contra o defeito voltar: a pagina tem que CHAMAR a funcao, e nao
  // reescrever a subtracao. Duas copias da conta foi o que deixou uma para tras.
  const page = await fonte("src/app/amazon/page.tsx");
  // A fonte unica cresceu: era `gastoComAnuncioDoPeriodo` (so o gasto) e virou
  // `lucroDoPeriodo` (a conta inteira), quando ficou claro que a SUBTRACAO
  // tambem estava duplicada.
  assert.match(page, /lucroDoPeriodo\(\{/, "o painel precisa usar a fonte unica do lucro");
  assert.ok(
    !/estimatedProfit\s*-\s*\(?\s*(profit\??\.)?ads/.test(page),
    "descontar `ads` direto na tela recria a segunda copia da conta"
  );
});

test("a cascata escrita fecha no MESMO lucro da rosca e da faixa", async () => {
  // Era a TERCEIRA copia (achada em 29/08/2026, no mesmo conserto): a rosca
  // passou a descontar o anuncio, mas as linhas logo abaixo dela ainda somavam
  // ate `estimatedProfit` — o numero antigo, maior e positivo. Lucro e margem
  // da cascata agora leem `lucroComAnuncio`, como todo o resto da tela.
  const page = await fonte("src/app/amazon/page.tsx");
  // ⚠️ O PORTAO MUDOU EM 30/08/2026 (decisao da vendedora): custo faltando nao
  // apaga mais o lucro. A exigencia deste teste NAO mudou — a cascata continua
  // tendo que fechar em `lucroComAnuncio`, a fonte unica. So o rotulo passou a
  // depender do lucro existir, e nao de o custo estar completo.
  assert.match(page, /label=\{lucroComAnuncio == null \? "Repasse líquido" : "Lucro estimado"\}[\s\S]{0,200}lucroComAnuncio/,
    "a linha de lucro da cascata precisa fechar no lucro com anuncio");
  assert.ok(
    !/estimatedProfit \?\? 0\) \/ \(profit\?\.finance\.revenue/.test(page),
    "a margem da cascata nao pode dividir o lucro sem anuncio pela receita"
  );
  assert.match(page, /label="Anúncios"/, "a cascata precisa MOSTRAR a linha que ela desconta");
});

// AS TRES SUPERFICIES. O mesmo numero aparecia em tres lugares da tela da Amazon:
// a faixa de cards, a rosca de composicao e a cascata escrita abaixo dela. A Ana
// relatou em 25/08 e o conserto foi no CARD; relatou de novo em 29/08 e o
// conserto foi na ROSCA; a CASCATA so apareceu porque fui olhar. Cada conserto
// alcancava a copia que alguem tinha visto — nunca a conta.
//
// Enquanto cada superficie fizesse a propria subtracao, elas seriam tres contas
// que CONCORDAM, e voltariam a divergir no primeiro mes em que alguem mexesse
// numa so. Estes testes exigem UMA fonte, nao tres resultados iguais.

test("as tres superficies leem o lucro da MESMA funcao", async () => {
  const esperado = lucroDoPeriodo({ ...base, ads: ADS }).lucro;
  assert.ok(esperado < 0, "com R$ 312,98 de anuncio sobre R$ 295,65, o resultado e negativo");

  // 1) FAIXA DE CARDS — comportamento: o card devolve o mesmo numero.
  assert.equal(carta(amazonFinancialCards({ ...base, ads: ADS }), "profit").raw, esperado);

  // 2 e 3) ROSCA e CASCATA vivem em JSX e nao dao para instanciar aqui. O que da
  // para exigir e que nenhuma das duas REFACA a conta: a tela chama a funcao uma
  // vez, guarda em `lucroComAnuncio`, e as duas leem essa variavel.
  const page = await fonte("src/app/amazon/page.tsx");
  assert.match(page, /const anuncio = lucroDoPeriodo\(\{/, "a tela precisa chamar a fonte unica");
  assert.match(page, /const lucroComAnuncio = anuncio\.lucro;/, "a tela nao pode recalcular o lucro");
  assert.match(page, /result: lucroComAnuncio,/, "a rosca precisa fechar no lucro da funcao");
  assert.match(page, /label=\{lucroComAnuncio == null \? "Repasse líquido" : "Lucro estimado"\}[\s\S]{0,200}lucroComAnuncio/,
    "a cascata precisa fechar no lucro da funcao");
});

test("a subtracao do anuncio existe em UM lugar no codigo inteiro", async () => {
  // A trava contra a quarta copia. Nao basta as tres concordarem hoje: a conta
  // precisa ser impossivel de duplicar sem quebrar isto.
  const cards = await fonte("src/app/amazon/amazonFinancialCards.ts");
  const page = await fonte("src/app/amazon/page.tsx");
  // ⚠️ MUDOU EM 30/08/2026: antes o teto era UMA subtracao na camada de tela
  // (dentro de `lucroDoPeriodo`). Agora e ZERO — a conta subiu para o produtor.
  assert.ok(
    !/estimatedProfit\s*-\s*/.test(cards),
    "a camada de tela nao subtrai mais anuncio: quem subtrai e `descontarAnuncio`, no produtor",
  );
  assert.ok(
    !/estimatedProfit\s*-\s*/.test(page),
    "a tela nao subtrai anuncio: o numero ja chega com ele dentro"
  );
  // E a subtracao existe UMA vez no lugar novo.
  const matematica = await fonte("src/lib/financialMath.ts");
  const subtracoes = (matematica.match(/lucroAntesDoAnuncio - gasto/g) ?? []).length;
  assert.equal(subtracoes, 1, "so `descontarAnuncio` pode subtrair o anuncio do lucro");
});
