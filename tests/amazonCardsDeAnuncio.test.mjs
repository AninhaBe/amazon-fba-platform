import test from "node:test";
import assert from "node:assert/strict";
import { amazonFinancialCards, diasSemAnuncio } from "../src/app/amazon/amazonFinancialCards.ts";

const brl = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const carta = (cards, key) => cards.find((c) => c.key === key);

// Sem `AdvertisingFee` no extrato — que é o caso REAL. Verificado em 25/08/2026:
// os únicos tipos gravados em `workspace_channel_order_fees` são `commission`,
// `refund` e `fulfillment`. A Amazon não posta anúncio como tarifa de pedido.
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

// ⚠️ A INTENCAO DOS FIXTURES MUDOU EM 30/08/2026, E O PORQUE E O MESMO DA
// FRONTEIRA (`src/lib/financialMath.ts`): `estimatedProfit` passou a CHEGAR com
// o anuncio dentro, produzido por `profit.ts`, porque enquanto a subtracao
// morava na tela da Amazon ela nao existia no ML, no MONITOR nem na HOME —
// R$ 2.827,10 de anuncio fora do lucro, medidos naquele dia.
//
// Entao `base` traz o lucro JA LIQUIDO (295,65 - 312,98 = -17,33) e `adsNoLucro`
// com o que o produtor descontou, para a tela poder ESCREVER o que foi tirado.
// Nenhum assert foi afrouxado: o card continua tendo que exibir -17,33 e dizer
// "anuncio". O que mudou e de onde o -17,33 vem.
const LUCRO_ANTES_DO_ANUNCIO = 295.65;
const LUCRO_COM_ANUNCIO = -17.33;
const base = {
  finance: FINANCE, cogs: 200, unitsWithoutCost: 0, adsConectado: true,
  estimatedProfit: LUCRO_COM_ANUNCIO, adsNoLucro: ADS.cost,
};

test("o lucro desconta o anuncio", () => {
  // O NÚMERO QUE MOTIVOU A ENTREGA (25/08/2026): a tela exibia R$ 295,65 de
  // lucro enquanto a conta gastava R$ 312,98 em anúncio no mesmo período. O
  // resultado de verdade era NEGATIVO.
  //
  // Decisão dela: *"o card de lucro passa a descontar também o ads, isso é
  // lucro real"*.
  const cards = amazonFinancialCards({ ...base, ads: ADS });
  assert.equal(carta(cards, "profit").raw, LUCRO_COM_ANUNCIO);
  assert.equal(carta(cards, "profit").value, brl(LUCRO_COM_ANUNCIO));
  assert.equal(carta(cards, "profit").tone, "danger", "prejuízo não pode sair verde");
});

test("a composicao do lucro diz que anuncio entrou", () => {
  const c = amazonFinancialCards({ ...base, ads: ADS, taxRate: 8, taxes: 80 });
  assert.match(carta(c, "profit").context, /anúncio/, "quem lê precisa saber o que foi descontado");
});

test("margem e ROI seguem o lucro real, nao o de antes do anuncio", () => {
  // Sem isto a margem continuaria positiva ao lado de um lucro negativo — dois
  // cards vizinhos se contradizendo, que foi exatamente o defeito de 24/08
  // ("Custo R$ 0,00" ao lado de "aguardando repasse").
  const cards = amazonFinancialCards({ ...base, ads: ADS });
  assert.ok(carta(cards, "marginPct").raw < 0);
  assert.ok(carta(cards, "roiPct").raw < 0);
  assert.equal(carta(cards, "marginPct").tone, "danger");
});

test("ACOS e gasto sobre a venda do anuncio", () => {
  const c = amazonFinancialCards({ ...base, ads: ADS });
  assert.equal(carta(c, "acos").raw.toFixed(1), "63.1");
  assert.equal(carta(c, "acos").tone, "danger");
});

test("TACOS e gasto sobre o faturamento total", () => {
  // ACOS e TACOS respondem perguntas diferentes: o anúncio se paga? (ACOS) e
  // quanto da operação inteira ele consome? (TACOS). Só o segundo mostra
  // dependência de mídia.
  const c = amazonFinancialCards({ ...base, ads: ADS });
  assert.equal(carta(c, "tacos").raw.toFixed(1), "31.3"); // 312,98 / 1000
  assert.notEqual(carta(c, "tacos").raw, carta(c, "acos").raw);
});

test("sem venda atribuida o ACOS e '—', nunca 0%", () => {
  // Dividir por zero daria Infinity; exibir "0,0%" diria que o anúncio saiu de
  // graça. Os dois mentem — o certo é não ter resposta ainda.
  const c = amazonFinancialCards({ ...base, ads: { ...ADS, sales: 0, purchases: 0 } });
  assert.equal(carta(c, "acos").value, "—");
  assert.match(carta(c, "acos").context, /Nenhuma venda atribuída/);
});

test("com Ads conectado e sem metrica, o lucro fica '—'", () => {
  // `null ≠ 0`: gasto desconhecido não pode virar lucro otimista. É a mesma
  // regra que fez o card de custo parar de afirmar lucro zero sem repasse.
  // Quem decide o desconhecimento agora e o produtor (`anuncioDoCanal`): ele
  // manda `estimatedProfit: null`, e a tela repete. Antes a tela decidia — e
  // era a segunda copia da regra.
  const c = amazonFinancialCards({ ...base, estimatedProfit: null, adsNoLucro: null, ads: null, adsConectado: true });
  assert.equal(carta(c, "profit").value, "—");
  assert.match(carta(c, "profit").context, /gasto com anúncio/);
  assert.equal(carta(c, "marginPct").value, "—");
});

test("sem Ads conectado o lucro sai normal", () => {
  // Quem não anuncia não pode ficar com a tela travada esperando um dado que
  // nunca vem. Aqui lucro sem anúncio É o lucro real.
  const c = amazonFinancialCards({ ...base, estimatedProfit: LUCRO_ANTES_DO_ANUNCIO, adsNoLucro: 0, ads: null, adsConectado: false });
  assert.equal(carta(c, "profit").raw, LUCRO_ANTES_DO_ANUNCIO);
  assert.match(carta(c, "ads").context, /Nenhuma conta de anúncio conectada/);
});

test("anuncio postado como tarifa nao e descontado duas vezes", () => {
  // Se a Amazon algum dia postar anúncio como tarifa de pedido, o valor já
  // entrou em `fees` e já saiu de `estimatedProfit`. Descontar a Ads API por
  // cima contaria o mesmo dinheiro duas vezes.
  // A guarda mudou de andar junto com a conta: quem enxerga o extrato e decide
  // nao descontar de novo e `anuncioJaNoExtrato`, em `src/lib/anuncioDoCanal.ts`.
  // Aqui o produtor ja mandou o lucro liquido UMA vez — e a tela nao mexe.
  const c = amazonFinancialCards({
    ...base,
    estimatedProfit: LUCRO_COM_ANUNCIO,
    finance: { ...FINANCE, fees: 312.98, feeBreakdown: [{ type: "AdvertisingFee", amount: 312.98 }] },
    ads: ADS,
  });
  assert.equal(carta(c, "profit").raw, LUCRO_COM_ANUNCIO, "o lucro já vinha líquido de anúncio");
  assert.match(carta(c, "ads").context, /extrato/);
});

test("dia faltando aparece com numero, nunca como 'parcial'", () => {
  // AGENTS.md: não extrapolar, e nunca escrever "parcial" — dizer O QUE falta,
  // com número. O lucro desconta só o anúncio já contabilizado.
  const c = amazonFinancialCards({ ...base, ads: { ...ADS, ateDia: "2026-08-22", esperadoAte: "2026-08-24" } });
  assert.match(carta(c, "ads").context, /até 22\/08 — faltam 2 dias/);
  assert.match(carta(c, "profit").context, /faltam 2 dias/);
  for (const k of ["ads", "profit"]) {
    assert.doesNotMatch(carta(c, k).context, /parcial|incompleto/i);
  }
});

test("um dia faltando fala no singular", () => {
  const c = amazonFinancialCards({ ...base, ads: { ...ADS, ateDia: "2026-08-23", esperadoAte: "2026-08-24" } });
  assert.match(carta(c, "ads").context, /falta 1 dia$/);
});

test("diasSemAnuncio nao desloca por fuso", () => {
  // Datas YYYY-MM-DD lidas como UTC nos dois lados: a diferença é dia civil
  // exato. Foi o deslocamento de um dia que errou a data de liberação do ML.
  assert.equal(diasSemAnuncio("2026-08-24", "2026-08-24"), 0);
  assert.equal(diasSemAnuncio("2026-08-24", "2026-08-25"), 1);
  assert.equal(diasSemAnuncio("2026-08-25", "2026-08-24"), 0, "sync adiantado não é dia faltando");
  assert.equal(diasSemAnuncio(null, "2026-08-24"), 0);
});

test("o card acompanha o filtro de periodo", () => {
  // Medido em 25/08/2026 contra o dado real: cada janela do filtro devolve
  // gasto próprio — 7 dias R$ 193,93 · 15 e 30 dias R$ 312,98. O anúncio é
  // consultado com o MESMO período do resto do financeiro; se fosse fixo em 30
  // dias, o filtro de 7 dividiria gasto de 30 por faturamento de 7 e o TACOS
  // sairia 4× maior.
  const sete = amazonFinancialCards({
    ...base, finance: { ...FINANCE, revenue: 200 },
    ads: { cost: 193.93, sales: 161.35, purchases: 6, ateDia: "2026-08-24", esperadoAte: "2026-08-24" },
  });
  const trinta = amazonFinancialCards({ ...base, ads: ADS });
  assert.notEqual(carta(sete, "ads").raw, carta(trinta, "ads").raw);
  // 7 dias está PIOR que a média de 30: gasta mais do que a venda que gera.
  assert.ok(carta(sete, "acos").raw > 100, "ACOS acima de 100% é gastar mais do que se vende");
  assert.ok(carta(sete, "acos").raw > carta(trinta, "acos").raw);
});

test("o gasto de hoje aparece, com aviso de que o dia nao fechou", () => {
  // ⚠️ CORRIGE UMA AFIRMAÇÃO FALSA que chegou a ir para produção: eu disse que a
  // Amazon só publica o gasto no dia seguinte. MEDIDO em 25/08/2026 — pedi um
  // relatório de hoje e vieram 6 linhas, R$ 17,53 e 17 cliques, em 105s.
  //
  // O gasto de hoje já saiu do bolso: esconder seria pior que mostrar. Mostra,
  // avisando que ainda cresce.
  const c = amazonFinancialCards({
    ...base,
    estimatedProfit: +(LUCRO_ANTES_DO_ANUNCIO - 17.53).toFixed(2),
    adsNoLucro: 17.53,
    ads: { cost: 17.53, sales: 0, purchases: 0, ateDia: "2026-08-25", esperadoAte: "2026-08-25" },
    adsJanela: { inicioDia: "2026-08-25", esperadoAte: "2026-08-25", incluiHoje: true },
  });
  assert.equal(carta(c, "ads").raw, 17.53, "custo já pago não pode sumir da tela");
  assert.match(carta(c, "ads").context, /ainda está somando/);
  // O lucro de hoje desconta o anúncio de hoje.
  assert.equal(carta(c, "profit").raw, +(LUCRO_ANTES_DO_ANUNCIO - 17.53).toFixed(2));
  // ACOS sem venda atribuída não é 0% nem catastrófico: é cedo.
  assert.equal(carta(c, "acos").value, "—");
  assert.match(carta(c, "acos").context, /entra depois/);
  for (const k of ["ads", "acos"]) {
    assert.doesNotMatch(carta(c, k).context, /dia seguinte/, "a Amazon entrega o dia corrente");
  }
});

test("sem metrica de hoje o texto nao culpa a Amazon", () => {
  // O cron ainda não colheu o dia. A pendência é nossa — mas também não é
  // "sincronização atrasada", porque hoje sempre chega por último.
  const c = amazonFinancialCards({
    ...base, estimatedProfit: null, adsNoLucro: null, ads: null, adsConectado: true,
    adsJanela: { inicioDia: "2026-08-25", esperadoAte: "2026-08-25", incluiHoje: true },
  });
  assert.match(carta(c, "profit").context, /ainda não foi contabilizado/);
  assert.doesNotMatch(carta(c, "profit").context, /dia seguinte/);
});

test("sync atrasado continua sendo sync atrasado", () => {
  // Janela que JÁ deveria ter dado: aí a pendência é nossa mesmo, e o texto
  // não pode se esconder atrás da Amazon.
  const c = amazonFinancialCards({
    ...base, ads: null, adsConectado: true,
    adsJanela: { inicioDia: "2026-08-01", esperadoAte: "2026-08-24" },
  });
  assert.match(carta(c, "ads").context, /Aguardando sincronização/);
});

// ---------------------------------------------------------------------------
// A FIAÇÃO ENTRE A ROTA E A TELA.
//
// Os testes acima provavam que a REGRA estava certa — e ela estava. O card
// mesmo assim saiu em produção mostrando "—" com o dado já gravado no banco:
// a rota devolvia `ads`, e a página, que monta `ProfitData` CAMPO A CAMPO,
// simplesmente não lia. Os três campos são opcionais, então o TypeScript
// compilou sem uma reclamação.
//
// Regra pura testada não prova tela ligada. Estes testes cobrem a emenda.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
const arquivo = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

test("a rota devolve anuncio, janela e conexao", () => {
  const rota = arquivo("src/app/api/amazon/dashboard/route.ts");
  assert.match(rota, /ads: ads\?\.resumo \?\? null/);
  assert.match(rota, /adsJanela: ads\?\.janela \?\? null/);
  assert.match(rota, /adsConectado: ads\?\.conectado \?\? false/);
});

test("a pagina LE os tres campos ao montar ProfitData", () => {
  const pagina = arquivo("src/app/amazon/page.tsx");
  const i = pagina.indexOf("const profit: ProfitData = {");
  assert.ok(i > 0, "a montagem de ProfitData precisa existir");
  // ⚠️ A JANELA VAI ATE O FIM DO OBJETO, nao um numero fixo de caracteres.
  // Era `slice(i, i + 1200)`, e em 31/08/2026 o teste quebrou sozinho quando um
  // comentario novo empurrou `adsConectado` para alem do corte — falha que nao
  // dizia nada sobre o produto, so sobre o tamanho da fatia. Teste fragil ensina
  // a ignorar teste vermelho.
  const montagem = pagina.slice(i, pagina.indexOf("      };", i));
  for (const campo of ["ads: payload.ads", "adsJanela: payload.adsJanela", "adsConectado: payload.adsConectado"]) {
    assert.ok(montagem.includes(campo), `${campo} não chega na tela`);
  }
});

test("os cards de anuncio estao na faixa principal", () => {
  const pagina = arquivo("src/app/amazon/page.tsx");
  const i = pagina.indexOf("PRIMARY_FINANCIAL_CARDS = new Set(");
  const faixa = pagina.slice(i, i + 400);
  for (const k of ["ads", "acos", "tacos"]) {
    assert.match(faixa, new RegExp(`"${k}"`), `${k} precisa aparecer na faixa de cima`);
  }
});
