import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { amazonFinancialCards, gastoComAnuncioDoPeriodo, lucroDoPeriodo } from "../src/app/amazon/amazonFinancialCards.ts";

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
const base = { finance: FINANCE, cogs: 200, estimatedProfit: 295.65, unitsWithoutCost: 0, adsConectado: true };

const carta = (cards, key) => cards.find((c) => c.key === key);
const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

test("o lucro do painel sai da MESMA funcao do card", () => {
  const { gastoComAnuncio } = gastoComAnuncioDoPeriodo({ ...base, ads: ADS });
  const lucroDoPainel = +(base.estimatedProfit - gastoComAnuncio).toFixed(2);
  assert.equal(lucroDoPainel, carta(amazonFinancialCards({ ...base, ads: ADS }), "profit").raw);
  assert.ok(lucroDoPainel < 0, "com R$ 312,98 de anuncio sobre R$ 295,65, o resultado e negativo");
});

test("anuncio postado no extrato nao e descontado duas vezes", () => {
  // Se a Amazon algum dia postar anuncio como tarifa de pedido, o valor ja saiu
  // de `estimatedProfit`. Descontar a Ads API por cima contaria o mesmo dinheiro
  // duas vezes — e agora sao DOIS lugares que dependem dessa guarda.
  const comExtrato = {
    ...base,
    ads: ADS,
    finance: { ...FINANCE, feeBreakdown: [{ type: "AdvertisingFee", amount: 312.98 }] },
  };
  const r = gastoComAnuncioDoPeriodo(comExtrato);
  assert.equal(r.jaNoExtrato, true);
  assert.equal(r.gastoComAnuncio, 0, "o extrato ja levou o anuncio embora");
  assert.equal(r.desconhecido, false);
});

test("Ads conectado sem metrica e DESCONHECIDO — para os dois lugares", () => {
  // `null` != `0` (AGENTS.md). Sem esta flag na funcao, o card dizia "—" e o
  // painel exibia um lucro que assume zero de anuncio: o mesmo defeito de novo,
  // so que por outro caminho.
  const r = gastoComAnuncioDoPeriodo({ ...base, ads: null });
  assert.equal(r.desconhecido, true);
  assert.equal(carta(amazonFinancialCards({ ...base, ads: null }), "profit").raw, null);
});

test("sem Ads conectado, ausencia de anuncio e fato, nao lacuna", () => {
  const r = gastoComAnuncioDoPeriodo({ ...base, ads: null, adsConectado: false });
  assert.equal(r.desconhecido, false, "quem nao anuncia tem lucro conhecido");
  assert.equal(r.gastoComAnuncio, 0);
  assert.equal(carta(amazonFinancialCards({ ...base, ads: null, adsConectado: false }), "profit").raw, 295.65);
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
  assert.match(page, /label=\{costsIncomplete \? "Repasse líquido" : "Lucro estimado"\}[\s\S]{0,200}lucroComAnuncio/,
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
  assert.match(page, /result: costsIncomplete \? null : lucroComAnuncio/, "a rosca precisa fechar no lucro da funcao");
  assert.match(page, /label=\{costsIncomplete \? "Repasse líquido" : "Lucro estimado"\}[\s\S]{0,200}lucroComAnuncio/,
    "a cascata precisa fechar no lucro da funcao");
});

test("a subtracao do anuncio existe em UM lugar no codigo inteiro", async () => {
  // A trava contra a quarta copia. Nao basta as tres concordarem hoje: a conta
  // precisa ser impossivel de duplicar sem quebrar isto.
  const cards = await fonte("src/app/amazon/amazonFinancialCards.ts");
  const page = await fonte("src/app/amazon/page.tsx");
  const subtracoes = (cards.match(/estimatedProfit\s*-\s*/g) ?? []).length;
  assert.equal(subtracoes, 1, "so `lucroDoPeriodo` pode subtrair o anuncio do lucro");
  assert.ok(
    !/estimatedProfit\s*-\s*/.test(page),
    "a tela nao subtrai anuncio: quem faz isso e `lucroDoPeriodo`"
  );
});
