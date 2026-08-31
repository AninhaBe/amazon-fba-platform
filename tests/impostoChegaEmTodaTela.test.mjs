import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

// A QUARTA DIVERGENCIA DE BASES DO MESMO DIA (31/08/2026).
//
// A conta A15NQMF7A6J1Y0 tem `amazon:tax_rate` cadastrado em 5%. Mesmo instante,
// duas telas da Amazon:
//   MONITOR e HOME (`profit.ts`)            -> descontavam o imposto
//   DASHBOARD (`amazonOverviewCanonical.ts`) -> NAO descontavam
//
// A causa nao era esquecimento: o canonico AFIRMAVA em tres lugares que "a
// Amazon nao tem aliquota de imposto do vendedor (tax = 0)" e foi construido
// sobre isso. Premissa falsa escrita no codigo, com a prova contraria no proprio
// banco — e a tela de configuracao aceitando o valor que o calculo ignorava.
//
// ⚠️ POR QUE ISTO E TESTE E NAO ANOTACAO: numero que diverge ENTRE TELAS e o
// defeito que a vendedora detecta sozinha, e depois dele ela nao confia em
// nenhuma das duas. Foi a quarta ocorrencia da mesma familia num unico dia
// (anuncio, tarifa, faturamento, imposto). Anotacao nao pega a quinta.

const raiz = (caminho) => new URL(`../${caminho}`, import.meta.url);
const fonte = (caminho) => readFile(raiz(caminho), "utf8");

async function arquivosTs(dir) {
  const achados = [];
  for (const entrada of await readdir(raiz(dir), { withFileTypes: true })) {
    if (entrada.isDirectory()) achados.push(...(await arquivosTs(`${dir}/${entrada.name}`)));
    else if (entrada.name.endsWith(".ts")) achados.push(`${dir}/${entrada.name}`);
  }
  return achados;
}

/**
 * PRODUTOR DE LUCRO DA AMAZON = arquivo que ESCREVE `estimatedProfit` e fala da
 * Amazon. Descoberto, nao listado: o dia em que nascer um terceiro caminho de
 * lucro da Amazon, ele entra nesta vigilancia sozinho.
 */
const PRODUZ = /(^|[^.\w])estimatedProfit\s*[:=,]/m;
const NAO_E_PRODUTOR = new Set(["src/lib/financialMath.ts"]);

async function produtoresDaAmazon() {
  const achados = [];
  for (const caminho of await arquivosTs("src/lib")) {
    if (NAO_E_PRODUTOR.has(caminho)) continue;
    const src = await fonte(caminho);
    if (!PRODUZ.test(src)) continue;
    if (!/"amazon"/.test(src)) continue;
    achados.push({ caminho, src });
  }
  return achados;
}

test("todo produtor de lucro da Amazon LE a aliquota cadastrada", async () => {
  const produtores = await produtoresDaAmazon();
  assert.ok(produtores.length >= 2, "esperava ao menos o canonico e o profit.ts — a descoberta quebrou");

  for (const { caminho, src } of produtores) {
    assert.match(
      src,
      /getAmazonTaxRateSetting/,
      `${caminho} produz lucro da Amazon e nao le a aliquota cadastrada — ` +
        "cadastro que nao chega no calculo foi o defeito de 31/08/2026",
    );
    assert.match(
      src,
      /amazonTaxAmount/,
      `${caminho} le a aliquota mas nao calcula imposto com ela`,
    );
  }
});

test("e o imposto entra na formula do lucro, nao fica so no objeto", async () => {
  // Ler a aliquota e expor `taxes` sem subtrair seria pior que nao ler: a tela
  // mostraria o imposto ao lado de um lucro que nao o desconta.
  for (const { caminho, src } of await produtoresDaAmazon()) {
    assert.match(
      src,
      /- \(taxes \?\? 0\)/,
      `${caminho} calcula o imposto e nao subtrai do lucro`,
    );
  }
});

test("a premissa falsa nao pode voltar ao canonico", async () => {
  // Ela estava escrita em tres lugares e foi DELETADA, nao comentada. Se voltar,
  // volta como justificativa para remover o termo de imposto de novo.
  const canonico = await fonte("src/lib/integrations/amazonOverviewCanonical.ts");
  assert.doesNotMatch(canonico, /Amazon não tem imposto do vendedor/);
  assert.doesNotMatch(canonico, /sem alíquota de imposto do vendedor/);
  assert.doesNotMatch(canonico, /\(tax = 0\)/);
});

test("a rota do dashboard entrega aliquota e imposto para a tela", async () => {
  // O furo (c): o cadastro existia, o canonico passou a calcular, e o numero
  // ainda nao chegaria se a rota nao carregasse os campos. Este objeto e montado
  // campo a campo e o TypeScript nao reclama do que falta.
  const pagina = await fonte("src/app/amazon/page.tsx");
  const i = pagina.indexOf("const profit: ProfitData = {");
  const montagem = pagina.slice(i, pagina.indexOf("      };", i));
  assert.match(montagem, /taxRate: payload\.profit\.taxRate/);
  assert.match(montagem, /taxes: payload\.profit\.taxes/);
});

test("'(sem imposto)' so aparece quando NAO ha aliquota cadastrada", async () => {
  // Com aliquota, a frase seria mentira sobre o proprio calculo. Sem aliquota,
  // ela e informacao acionavel — "falta cadastrar" —, nao desculpa.
  const cards = await fonte("src/app/amazon/amazonFinancialCards.ts");
  assert.match(cards, /comSemImposto\([^)]*input\.taxRate == null\)/);
});
