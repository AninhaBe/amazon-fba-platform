import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../scripts/ts-resolver.mjs";

const { amazonFinancialCards } = await import("../src/app/(app)/amazon/amazonFinancialCards.ts");
const { calculateTiktokFinancialV2 } = await import("../src/lib/integrations/tiktokFinancialV2.ts");
const { SUFIXO_SEM_IMPOSTO, comSemImposto } = await import("../src/lib/semImposto.ts");

const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const carta = (cards, key) => cards.find((c) => c.key === key);
// `Intl.NumberFormat` separa "R$" do numero com espaco NAO separavel (U+00A0).
const dinheiro = (texto) => texto.replace(/ /g, " ");
// Comentario que MENCIONA o rotulo nao e o mesmo que escreve-lo a mao.
const semComentarios = (texto) => texto.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");

// Decisão dela em 26/08/2026: alíquota de imposto NÃO cadastrada deixa de
// bloquear lucro e margem — os números aparecem rotulados "(sem imposto)".
//
// A nuance é o teste inteiro: só a alíquota (configuração da vendedora) sai do
// bloqueio. Tarifa, frete e custo do MARKETPLACE desconhecidos continuam
// bloqueando, porque aí o `null ≠ 0` é sobre dado que o canal não entregou.

test("o rótulo é um só, e não duplica", () => {
  assert.equal(SUFIXO_SEM_IMPOSTO, " (sem imposto)");
  assert.equal(comSemImposto("Margem", false), "Margem");
  assert.equal(comSemImposto("Margem", true), "Margem (sem imposto)");
  assert.equal(comSemImposto("Margem (sem imposto)", true), "Margem (sem imposto)");
});

// ── Amazon ──────────────────────────────────────────────────────────────────

const amazonBase = {
  finance: { currency: "BRL", revenue: 1000, fees: 100, refunds: 0, orderCount: 10, feeBreakdown: [] },
  cogs: 400, estimatedProfit: 500, unitsWithoutCost: 0, adsConectado: false,
};

test("Amazon: sem alíquota, lucro e margem aparecem com o rótulo", () => {
  const cards = amazonFinancialCards({ ...amazonBase, taxRate: null, taxes: null });
  const lucro = carta(cards, "profit");
  const margem = carta(cards, "marginPct");
  assert.equal(dinheiro(lucro.value), "R$ 500,00");
  assert.match(lucro.context, /\(sem imposto\)$/);
  assert.equal(margem.value, "50,0%");
  assert.match(margem.context, /\(sem imposto\)$/);
});

test("Amazon: com alíquota o rótulo some", () => {
  const cards = amazonFinancialCards({ ...amazonBase, taxRate: 8, taxes: 80, estimatedProfit: 420 });
  assert.doesNotMatch(carta(cards, "profit").context, /sem imposto/);
  assert.doesNotMatch(carta(cards, "marginPct").context, /sem imposto/);
});

test("Amazon: dado do canal ausente CONTINUA bloqueando, com ou sem alíquota", () => {
  // Repasse não postado: o extrato existe e está vazio.
  const semRepasse = amazonFinancialCards({
    ...amazonBase, finance: { ...amazonBase.finance, orderCount: 0 }, taxRate: null, taxes: null,
  });
  assert.equal(carta(semRepasse, "profit").value, "—");
  assert.equal(carta(semRepasse, "marginPct").value, "—");

  // Unidade vendida sem custo cadastrado.
  const semCusto = amazonFinancialCards({ ...amazonBase, unitsWithoutCost: 3, taxRate: null, taxes: null });
  assert.equal(carta(semCusto, "profit").value, "—");
  assert.match(carta(semCusto, "profit").context, /3 unidade/);

  // Ads conectado e sem métrica: gasto desconhecido ≠ zero.
  //
  // ⚠️ 30/08/2026: quem decide isso passou a ser o PRODUTOR (`anuncioDoCanal` +
  // `descontarAnuncio`), que manda `estimatedProfit: null` — a tela so repete.
  // Antes a regra morava aqui tambem, e regra em dois lugares foi o defeito.
  const semAds = amazonFinancialCards({
    ...amazonBase, adsConectado: true, ads: null, estimatedProfit: null, adsNoLucro: null,
    taxRate: null, taxes: null,
  });
  assert.equal(carta(semAds, "profit").value, "—");
});

// ── TikTok ──────────────────────────────────────────────────────────────────

const pedidoTiktok = (extra = {}) => ({
  revenue: 1000, fees: 100, sellerShipping: 50, ads: 0, taxesWithheld: 0, refunds: 0,
  buyerShipping: 0, statementSettled: true,
  items: [{ quantity: 1, unitCost: 400, unitDiscount: 0 }],
  ...extra,
});

test("TikTok: sem alíquota, lucro e margem saem calculados sem o imposto", () => {
  const { overview, coverage } = calculateTiktokFinancialV2({
    periodCovered: true, taxRate: null, orders: [pedidoTiktok()],
  });
  assert.notEqual(overview.profit, null, "sem alíquota o lucro tem que existir");
  assert.equal(overview.tax, null, "o imposto em si continua desconhecido — null, nunca zero");
  assert.equal(coverage.financials.status, "complete");
  assert.equal(coverage.tax.status, "partial", "a cobertura do imposto continua apontando o que falta");
  // 1000 − 100 − 50 − 400 = 450, sem imposto.
  assert.equal(overview.profit, 450);
  assert.equal(overview.marginPct, 45);
});

test("TikTok: tarifa desconhecida CONTINUA bloqueando mesmo com alíquota cadastrada", () => {
  const { overview, coverage } = calculateTiktokFinancialV2({
    periodCovered: true, taxRate: 8, orders: [pedidoTiktok({ fees: null })],
  });
  assert.equal(overview.profit, null);
  assert.equal(overview.marginPct, null);
  assert.notEqual(coverage.financials.status, "complete");
});

test("TikTok: unidade sem custo NAO bloqueia mais — vira sinal ao lado do numero", () => {
  // ⚠️ ESTE TESTE INVERTEU EM 30/08/2026, por decisao da vendedora: *"tem que
  // mostrar a margem independente de se tem algo nao cadastrado [...] basta
  // sinalizar pra cadastrar"*. O custo saiu de `components`; o que a TIKTOK
  // posta continua bloqueando, porque disso ela nao tem como cuidar.
  const { overview } = calculateTiktokFinancialV2({
    periodCovered: true, taxRate: null,
    orders: [pedidoTiktok({ items: [{ quantity: 1, unitCost: null, unitDiscount: 0 }] })],
  });
  assert.notEqual(overview.profit, null, "o lucro sai com o custo que se sabe");
  assert.equal(overview.cogs, null, "e o custo continua declarado como desconhecido");
  assert.equal(overview.unitsWithoutCost, 1, "o numero do sinal viaja junto");
});

test("TikTok: os cards derivados do imposto ganham o rótulo, os outros não", () => {
  const modelo = fonte("src/app/components/TikTokWorkspaceModel.ts");
  assert.match(modelo, /DERIVAM_DO_IMPOSTO = new Set[\s\S]{0,120}"profit", "marginPct", "roiPct"/);
  assert.match(modelo, /comSemImposto\("Total oficial do período", overview\.taxRate == null/);
});

// ── Mercado Livre ───────────────────────────────────────────────────────────

test("ML: a alíquota saiu da condição de bloqueio e virou rótulo", () => {
  const tela = fonte("src/app/components/MercadoLivreWorkspace.tsx");
  // A afirmacao e "so DADO DO CANAL bloqueia", nao "a expressao tem uma palavra
  // so": em 30/08/2026 entrou `estimatedProfit == null` (lucro desconhecido
  // quando o sync de Ads nao responde), que tambem e dado do canal. O que nao
  // pode voltar e a aliquota — e e isso que a linha seguinte guarda.
  assert.match(tela, /const resultIncomplete = resultParcial(\s*\|\|\s*overview\.profit\.estimatedProfit == null)?;/, "só dado do canal bloqueia");
  assert.doesNotMatch(tela, /resultIncomplete = semAliquota/, "a alíquota não pode voltar para o bloqueio");
  // Lucro e margem, no dashboard, no painel de baixo e no monitor.
  // ⚠️ ESTA LINHA EXIGIA "Lucro estimado" ATE 02/09/2026, e a troca e de
  // INTENCAO, nao de texto. O painel fala do universo da RECEITA PAGA; o "Lucro
  // estimado" e do periodo inteiro e vive nos cards. Exibir o nome de um sobre
  // o centro do outro foi o defeito que produziu margem de 5673% no painel da
  // Amazon — a ADR-028 manda dar NOMES DISTINTOS a numeros de universos
  // distintos. O que esta guarda sempre protegeu continua igual: o rotulo do
  // resultado carrega "sem imposto" quando nao ha aliquota cadastrada.
  assert.match(tela, /comSemImposto\("Resultado da receita paga", semAliquota\)/);
  assert.match(tela, /comSemImposto\("Margem", semAliquota\)/);
  assert.match(tela, /comSemImposto\("Margem de contribuição", semAliquota\)/);
  assert.match(tela, /comSemImposto\("após todos os custos", semAliquota\)/);
  // ⚠️ ESTA LINHA EXIGIA A FRASE ERRADA ate 01/09/2026. O que ela garante e que
  // a MARGEM leva o rotulo "sem imposto" quando nao ha aliquota — o texto da
  // base era incidental, e era mentira: dizia "sobre o faturamento" enquanto a
  // conta saia do apurado. Agora a base vem da peca compartilhada
  // (`declaracaoDeBase`) e a guarda casa o envelope, nao o recheio.
  assert.match(tela, /comSemImposto\(baseDoResultado \?\? BASE_SEM_DIFERENCA, semAliquota\)/);
});

test("ML: o que bloqueia continua sendo pedido, custo e frete do canal", () => {
  const tela = fonte("src/app/components/MercadoLivreWorkspace.tsx");
  const bloco = tela.slice(tela.indexOf("const faltas"), tela.indexOf("const resultParcial"));
  assert.match(bloco, /pedido\(s\) sem conciliar/);
  assert.match(bloco, /unidade\(s\) sem custo/);
  assert.match(bloco, /frete de alguns pedidos/);
  assert.doesNotMatch(bloco, /aliquota|alíquota/i, "a alíquota não é falta de dado do canal");
});

test("ML: a pendência 'Cadastrar alíquota' continua na tela", () => {
  const tela = fonte("src/app/components/MercadoLivreWorkspace.tsx");
  // Mostrar o número com rótulo não dispensa apontar o que falta.
  assert.ok(tela.split("Cadastrar alíquota").length - 1 >= 2, "os CTAs de alíquota precisam sobreviver à mudança");
  assert.match(tela, /A alíquota de imposto ainda não está cadastrada/);
});

test("ML: o lucro do canônico já sai sem imposto quando não há alíquota", () => {
  const canonico = fonte("src/lib/integrations/mercadoLivreOverviewCanonical.ts");
  // ⚠️ O NOME FOI E VOLTOU NO MESMO DIA (30/08/2026), e a exigencia nunca mudou.
  // Virou `lucroAntesDoAnuncio` quando o anuncio entrou no lucro do ML, e voltou
  // a ser `estimatedProfit` horas depois, quando a vendedora decidiu que no
  // Mercado Livre o anuncio NAO entra — ela concilia por fora. Ver a regra por
  // canal em `financialMath.ts` → ANUNCIO_FORA_DO_LUCRO.
  // O que este teste cobra segue sendo `(taxes ?? 0)`: sem aliquota o lucro sai
  // SEM imposto, e nao vira `null`.
  // ⚠️ E A ASSERCAO NAO FIXA MAIS O NOME DA BASE (01/09/2026). Ela casava
  // `processedRevenue` inteiro e ficou vermelha quando a base virou o
  // FATURAMENTO — vermelho por uma troca que ela nao existe para impedir, que e
  // o "teste vermelho por motivo que nao e o produto" do AGENTS.md. O que este
  // teste guarda e o `(taxes ?? 0)`; a base tem teste proprio.
  assert.match(canonico, /estimatedProfit = \w+ - fees - cogs - \(taxes \?\? 0\) - sellerShipping/);
});

// ── Shopee ──────────────────────────────────────────────────────────────────

test("Shopee: a alíquota saiu da condição de bloqueio, no agregado e por linha", () => {
  const canonico = fonte("src/lib/integrations/shopeeOverviewCanonical.ts");
  assert.match(canonico, /\[fees, sellerShipping, ads, taxesWithheld, refunds\]\.every/, "taxes saiu da lista");
  assert.match(canonico, /- \(taxes \?\? 0\) -/, "o lucro sai sem imposto em vez de virar null");
  assert.match(canonico, /const complete = lineFees != null && lineSellerShipping != null;/, "por linha idem");
  assert.doesNotMatch(canonico, /lineFees != null && lineSellerShipping != null && lineTax != null/);
});

test("Shopee: a tela rotula e mantém o CTA; dado do canal continua bloqueando", () => {
  const tela = fonte("src/app/components/ShopeeWorkspace.tsx");
  assert.doesNotMatch(tela, /overview\.profit\.taxes == null \|\| overview\.profit\.estimatedProfit/, "taxes saiu do resultIncomplete");
  assert.match(tela, /comSemImposto\("Lucro estimado", semAliquota\)/);
  assert.match(tela, /comSemImposto\("Margem", semAliquota\)/);
  assert.match(tela, /Cadastrar alíquota/);
  // O que segue bloqueando é dado da Shopee.
  assert.match(tela, /overview\.profit\.fees == null \|\| overview\.profit\.sellerShipping == null/);
  assert.match(tela, /overview\.profit\.cogs == null/);
});

// ── Os quatro juntos ────────────────────────────────────────────────────────

test("os quatro canais usam o MESMO rótulo, nenhum escreve o texto à mão", () => {
  const arquivos = [
    "src/app/(app)/amazon/amazonFinancialCards.ts",
    "src/app/components/MercadoLivreWorkspace.tsx",
    "src/app/components/ShopeeWorkspace.tsx",
    "src/app/components/TikTokWorkspaceModel.ts",
  ];
  for (const arquivo of arquivos) {
    const s = fonte(arquivo);
    // ⚠️ A ANCORA E O MODULO, NAO A PROFUNDIDADE DO CAMINHO. A versao anterior
    // casava exatamente `../../lib` e ficou vermelha quando as telas desceram um
    // nivel para dentro do route group `(app)` — reprovando um movimento que nao
    // toca em imposto nenhum. Guarda que casa a aparencia pune quem mexe na
    // estrutura; ver docs/achado-guarda-que-depende-da-forma.md.
    assert.match(s, /from "(@\/lib|(?:\.\.\/)+lib)\/semImposto"/, `${arquivo} precisa importar o rótulo compartilhado`);
    assert.doesNotMatch(semComentarios(s), /"\(sem imposto\)"/, `${arquivo} não pode escrever o rótulo à mão`);
  }
});

test("o módulo morto de cards do ML não voltou", () => {
  // Ele existia com 12 cards e teste próprio, sem NENHUMA página importando —
  // e codificava a regra oposta à que estava no ar. Apagado em 26/08/2026.
  assert.throws(() => fonte("src/app/components/mercadoLivreFinancialCards.ts"), /ENOENT/);
});
