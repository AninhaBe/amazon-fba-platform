import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

// O TESTE QUE IMPEDE A QUINTA OCORRENCIA.
//
// As quatro primeiras, todas o mesmo defeito por caminhos diferentes:
//   25/08/2026 — o card de Lucro da Amazon nao descontava anuncio. Consertado.
//   29/08/2026 — o PAINEL ao lado do card nao descontava. Consertado.
//   29/08/2026 — a CASCATA embaixo do painel nao descontava. Consertada.
//   30/08/2026 — MERCADO LIVRE, MONITOR e HOME nunca descontaram: R$ 2.827,10
//                de anuncio fora do lucro (R$ 2.411,25 no ML em 3 dias,
//                R$ 415,85 na Amazon em 19).
//
// Cada conserto alcancava a superficie que alguem tinha olhado. O que faltava
// era uma pergunta que ninguem precisasse lembrar de fazer: **quem gasta com
// anuncio e nao desconta anuncio do lucro?**
//
// ⚠️ SEM LISTA FIXA, E ISSO E O PONTO. Um teste com os quatro nomes escritos
// dentro passaria no dia em que a Shopee ligar o app de Ads ou a Ana criar a
// conta do TikTok — os dois estao a uma aprovacao de distancia (ver
// `docs/estado-atual.md`). Os canais sao DESCOBERTOS: pelas duas tabelas de
// metrica no banco quando ele existe, e pelo codigo que grava nelas sempre.

const raiz = (caminho) => new URL(`../${caminho}`, import.meta.url);
const fonte = (caminho) => readFile(raiz(caminho), "utf8");

/** As DUAS tabelas: um canal pode gravar so numa (o ML so grava na de produto). */
const TABELAS_DE_ADS = ["workspace_ad_metrics", "workspace_ad_product_metrics"];

async function arquivosTs(dir) {
  const achados = [];
  for (const entrada of await readdir(raiz(dir), { withFileTypes: true })) {
    if (entrada.isDirectory()) achados.push(...(await arquivosTs(`${dir}/${entrada.name}`)));
    else if (entrada.name.endsWith(".ts")) achados.push(`${dir}/${entrada.name}`);
  }
  return achados;
}

/**
 * O provider como ele aparece no banco — descoberto do proprio codigo, nao
 * listado aqui: e o literal que os gravadores usam na coluna `provider`.
 */
const literalDeProvider = (src) => [...src.matchAll(/"(amazon|mercado_livre|shopee|tiktok_shop)"/g)].map((m) => m[1]);

/**
 * PRODUTOR DE LUCRO = arquivo que ESCREVE `estimatedProfit`, e nao um que le o
 * de outro. A distincao e o ponto sem serifa: `overview.profit.estimatedProfit`
 * e leitura (tem ponto antes), `estimatedProfit:` e producao.
 */
const PRODUZ = /(^|[^.\w])estimatedProfit\s*[:=,]/m;
// A propria fronteira declara o campo no tipo; ela nao produz numero de canal.
const NAO_E_PRODUTOR = new Set(["src/lib/financialMath.ts"]);

async function produtoresDeLucro() {
  const produtores = [];
  for (const caminho of await arquivosTs("src/lib")) {
    if (NAO_E_PRODUTOR.has(caminho)) continue;
    const src = await fonte(caminho);
    if (!PRODUZ.test(src)) continue;
    produtores.push({ caminho, src, providers: [...new Set(literalDeProvider(src))] });
  }
  return produtores;
}

/** Canais que GRAVAM gasto de anuncio, descobertos pelo codigo que escreve nas tabelas. */
async function providersQueAnunciam() {
  const encontrados = new Set();
  for (const caminho of await arquivosTs("src/lib")) {
    const src = await fonte(caminho);
    if (!TABELAS_DE_ADS.some((t) => new RegExp(`INSERT INTO ${t}`).test(src))) continue;
    for (const p of literalDeProvider(src)) encontrados.add(p);
  }
  return encontrados;
}

test("todo canal que gasta com anuncio desconta anuncio do lucro", async () => {
  const anunciam = await providersQueAnunciam();
  assert.ok(anunciam.size > 0, "nenhum gravador de anuncio encontrado — a descoberta quebrou, nao o produto");

  const produtores = await produtoresDeLucro();
  for (const provider of anunciam) {
    const doCanal = produtores.filter((p) => p.providers.includes(provider));
    assert.ok(
      doCanal.length > 0,
      `${provider} grava gasto com anuncio e nenhum produtor de lucro fala dele`,
    );
    for (const produtor of doCanal) {
      assert.match(
        produtor.src,
        /descontarAnuncio/,
        `${produtor.caminho} produz o lucro de ${provider}, que gasta com anuncio, e nao chama ` +
          "`descontarAnuncio` — e o defeito de 25 a 30/08/2026 nascendo de novo",
      );
    }
  }
});

test("a subtracao do anuncio existe em UM lugar no sistema inteiro", async () => {
  // A fronteira so vale se ninguem puder refazer a conta por fora. Producao e
  // consumo: o consumidor que subtrai conta o mesmo dinheiro duas vezes.
  const matematica = await fonte("src/lib/financialMath.ts");
  assert.equal(
    (matematica.match(/lucroAntesDoAnuncio - gasto/g) ?? []).length,
    1,
    "a subtracao mora em `descontarAnuncio`, uma vez",
  );

  for (const caminho of [...(await arquivosTs("src/lib")), ...(await arquivosTs("src/app"))]) {
    if (caminho === "src/lib/financialMath.ts") continue;
    const src = await fonte(caminho);
    // Sem ponto antes: `coverage.estimatedProfit - taxes` e outro numero (o
    // intermediario da cobertura de custo), e subtrair dele e legitimo.
    assert.ok(
      !/(^|[^.\w])estimatedProfit\s*-\s*/m.test(src),
      `${caminho} subtrai algo de \`estimatedProfit\`, que ja inclui o anuncio — ver a fronteira em src/lib/financialMath.ts`,
    );
  }
});

test("a fronteira esta ESCRITA onde a proxima pessoa procura", async () => {
  // Regra que so existe em teste vira folclore. Ela precisa estar no arquivo
  // que a pessoa abre quando vai mexer em lucro.
  const matematica = await fonte("src/lib/financialMath.ts");
  // A frase e quebrada pelas colunas do comentario — por isso `[\s*]+` no meio.
  assert.match(matematica, /`estimatedProfit`[\s*]+INCLUI o gasto com anúncio/i);
  assert.match(matematica, /Quem consome NÃO subtrai de[\s*]+novo/i);
});

// ═══ A METADE QUE SO O BANCO SABE ═══════════════════════════════════════════
//
// O codigo diz quem PODE gastar; o banco diz quem GASTOU. Um canal ligado por
// configuracao, sem gravador novo, aparece so aqui — e e exatamente o caso que
// a lista fixa perderia. Sem `DATABASE_URL` este bloco nao roda: ele nao e o
// gate (o gate esta acima), e sim a confirmacao contra o dado real.
test("nenhum provider com gasto gravado ficou de fora (exige DATABASE_URL)", async (t) => {
  if (!process.env.DATABASE_URL) return t.skip("sem DATABASE_URL — rode contra o banco para conferir o dado real");

  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // ⚠️ AS DUAS TABELAS, e `UNION` (nao `UNION ALL`) porque a pergunta e
    // "quais canais", nao "quantas linhas". `workspace_id` e uuid numa e text na
    // outra (migration 0016 explica) — por isso nada de join entre elas aqui.
    const { rows } = await client.query(
      `SELECT DISTINCT provider FROM workspace_ad_metrics WHERE cost > 0
       UNION
       SELECT DISTINCT provider FROM workspace_ad_product_metrics WHERE cost > 0`,
    );
    const produtores = await produtoresDeLucro();
    for (const { provider } of rows) {
      const doCanal = produtores.filter((p) => p.providers.includes(provider));
      assert.ok(doCanal.length > 0, `${provider} tem gasto gravado e nenhum produtor de lucro fala dele`);
      for (const produtor of doCanal) {
        assert.match(
          produtor.src,
          /descontarAnuncio/,
          `${produtor.caminho} produz o lucro de ${provider}, que TEM gasto gravado, sem descontar anuncio`,
        );
      }
    }
  } finally {
    await client.end();
  }
});
