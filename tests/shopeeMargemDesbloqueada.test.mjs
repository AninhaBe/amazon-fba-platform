import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ═══ O DEFEITO QUE ESTE ARQUIVO REPROVA ═════════════════════════════════════
//
// A Shopee era o QUARTO canal — o unico que ainda escondia lucro e margem
// quando a cobertura do periodo nao estava completa. Na conta real: 9.027 de
// 9.877 vendas com tarifa apurada (91% do periodo) e a tela mostrava travessao.
//
// E o mesmo tudo-ou-nada que a vendedora ja derrubou duas vezes:
//   29/08 — custo:       "nao precisa mostrar que e parcial [...] se tem venda e
//                         nao tem custo, fica apontado la que o custo nao esta
//                         cadastrado";
//   31/08 — faturamento: "o lucro tem que ser em cima do Faturamento".
//
// ⚠️ O DESBLOQUEIO SEM A DECLARACAO SERIA PIOR QUE O TRAVESSAO. Numero sobre
// uma receita menor que o card de Faturamento ao lado, sem dizer sobre o que
// ele e, foi exatamente o que fez a vendedora concluir que a tela da Amazon
// estava errada em 31/08. Por isso os dois andam juntos, e este arquivo cobra
// os dois.

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

test("cobertura incompleta NAO anula mais o lucro no produtor", async () => {
  // Ramificacao, nao identificador: casar /financialComplete/ continuaria verde
  // com a condicao de volta no lugar. O que se exige e que a condicao do lucro
  // seja a dos COMPONENTES conhecidos.
  const texto = await fonte("src/lib/integrations/shopeeOverviewCanonical.ts");
  const inicio = texto.indexOf("const estimatedProfit =");
  assert.notEqual(inicio, -1);
  const formula = texto.slice(inicio, texto.indexOf("const marginPct = estimatedProfit"));
  assert.match(formula, /componentesConhecidos/);
  assert.doesNotMatch(
    formula,
    /const estimatedProfit = financialComplete/,
    "cobertura incompleta voltou a anular o lucro — foi o defeito de 31/08/2026",
  );
});

test("componente DESCONHECIDO continua anulando — ausencia de componente nao e cobertura", async () => {
  // O que NAO pode ser afrouxado junto: `fees == null` nao e "nao cobraram", e
  // "nao sei quanto". Lucro otimista sem aviso e mentira (AGENTS.md).
  const texto = await fonte("src/lib/integrations/shopeeOverviewCanonical.ts");
  assert.match(
    texto,
    /const componentesConhecidos = \[fees, sellerShipping, ads, taxesWithheld, refunds\]\.every\(\(v\) => v != null\)/,
  );
});

test("a tela declara a base do resultado — e usa a peca compartilhada", async () => {
  // Uma frase, um lugar, quatro canais. Se a Shopee escrever a propria versao,
  // nascem quatro declaracoes que divergem na primeira vez que alguem ajusta uma.
  const tela = await fonte("src/app/components/ShopeeWorkspace.tsx");
  assert.match(tela, /import \{ declaracaoDeBase \} from "\.\/baseDaMargem"/);
  assert.match(tela, /baseApurada: overview\.profit\.revenueDoLucro/);
  assert.match(tela, /pedidosAguardando: overview\.profit\.pedidosSemApuracao/);
});

test("a declaracao vai no SUB (visivel), nunca no info/tooltip", async () => {
  // ⚠️ ESTE E O TESTE QUE FALTOU NA AMAZON EM 31/08/2026, e por isso ele existe
  // aqui. La o teste garantia que a FRASE existia; ela existia — dentro do "i".
  // A vendedora passou o dia sem ve-la e concluiu que a tela estava errada.
  // Declaracao que exige hover nao declara nada.
  const tela = await fonte("src/app/components/ShopeeWorkspace.tsx");
  const usos = [...tela.matchAll(/(sub|info)=\{[^}]*baseDoResultado/g)].map((m) => m[1]);
  assert.ok(usos.length >= 2, `a declaracao precisa aparecer no lucro E na margem, achei ${usos.length}`);
  assert.ok(
    usos.every((onde) => onde === "sub"),
    `a declaracao foi parar num tooltip: ${usos.join(", ")}`,
  );
});

test("o lucro do briefing para de exigir cobertura completa", async () => {
  // A trava de tudo-ou-nada tinha DOIS lugares: o produtor e esta linha da tela,
  // que zerava o lucro do BriefingLead quando a cobertura era parcial. Consertar
  // so um deles deixaria a narracao muda com o card ao lado mostrando numero.
  const tela = await fonte("src/app/components/ShopeeWorkspace.tsx");
  assert.doesNotMatch(
    tela,
    /lucro=\{overview\.metrics\.revenueCoverage\.complete \? overview\.profit\.estimatedProfit : null\}/,
  );
});

// ═══ A BASE DA SHOPEE PASSA A SER O FATURAMENTO (01/09/2026) ════════════════
//
// A terceira replica da decisao dela, com as palavras que ela ja repetiu quatro
// vezes: "TEM QUE ESQUECER O APURADO E LEVAR EM CONSIDERACAO SOMENTE O
// FATURAMENTO". A Shopee dividia por `processedRevenue` — a receita ja
// conciliada — enquanto o card ao lado exibia `paid_revenue`. Duas bases, e o
// silencio entre elas.

test("a base do lucro e da margem e o FATURAMENTO, nao o apurado", async () => {
  // Ramificacao, nao identificador: o que nao pode voltar e a divisao pelo
  // processado. Casar /faturamento/ ficaria verde com a variavel existindo e
  // nao sendo usada.
  const texto = await fonte("src/lib/integrations/shopeeOverviewCanonical.ts");
  const inicio = texto.indexOf("const estimatedProfit =");
  const formula = texto.slice(inicio, texto.indexOf("const daily = new Map"));
  assert.match(formula, /faturamento - fees!/, "o numerador tem de sair do faturamento");
  assert.match(formula, /estimatedProfit \/ faturamento/, "e o denominador tambem");
  assert.doesNotMatch(formula, /processedRevenue/, "a base apurada voltou para a formula");
});

test("o card de Faturamento e a base do lucro sao o MESMO numero", async () => {
  // ⚠️ E por isso que a declaracao de base some sozinha aqui: `declaracaoDeBase`
  // devolve null quando o faturamento exibido nao e MAIOR que a base. Se alguem
  // separar os dois de novo, a frase reaparece — e ela so deveria aparecer
  // quando ha diferenca de verdade.
  const texto = await fonte("src/lib/integrations/shopeeOverviewCanonical.ts");
  assert.match(texto, /revenue30d: faturamento/, "o card tem de exibir a mesma base");
  assert.match(texto, /revenueDoLucro: \+faturamento\.toFixed\(2\)/, "e o produtor tem de declarar a mesma");
});

test("pedido que a Shopee nao valorizou fica FORA da base e e apontado com numero", async () => {
  // Ele nao vale zero (null != 0) e nao encolhe a base dos outros: a tela diz
  // quantos sao. `pedidosSemApuracao` passou a medir isso, e nao mais
  // "pagos menos processados".
  const texto = await fonte("src/lib/integrations/shopeeOverviewCanonical.ts");
  assert.match(texto, /pedidosSemApuracao: pedidosSemValor/);
  assert.match(texto, /gross IS NULL\)::int AS sem_valor/, "a contagem vem do banco, nao de estimativa");
});
