/**
 * Captura a CATEGORIA de cada ASIN vendido, pela Catalog Items API.
 *
 * ⚠️ POR QUE ISTO EXISTE: a fonte de tarifa `tabela` (ADR-027) precisa da cadeia
 * ASIN -> CATEGORIA -> percentual publicado. Medido em 01/09/2026, o elo do meio
 * NAO EXISTIA em lugar nenhum do banco: zero produtos da Amazon nas tres tabelas
 * de catalogo (`workspace_marketplace_products`, `workspace_channel_products`,
 * `workspace_channel_offer_history`), e nenhum `productType` ou `classificationId`
 * gravado por qualquer caminho do codigo.
 *
 * 📌 A CATEGORIA E UTIL INDEPENDENTE DA DECISAO DO PERCENTUAL. Ela serve para
 * agrupar relatorio, para a curva ABC por categoria, e para responder "que tipo
 * de produto vende" sem abrir a Amazon. O elo fica resolvido de uma vez.
 *
 * Limite medido pelo cabecalho na primeira chamada: `x-amzn-RateLimit-Limit: 2.0`
 * — DOIS por segundo, proprio da Catalog e quatro vezes o da Transactions (0,5).
 * O espacamento abaixo respeita isso; o codigo do app ainda nao espaca sozinho
 * (divergencia ja documentada em `docs/api-amazon-sp-api.md`).
 *
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/ts-resolver.mjs scripts/capturar-categoria-amazon.mjs [--aplicar]
 */
process.env.DB_POOL_MAX = "2";
import { dbQuery } from "../src/lib/db.ts";
import { runWithWorkspace } from "../src/lib/workspaceScope.ts";
import { runWithAccount } from "../src/lib/accountContext.ts";

const WS = "22ae3d9d-6f28-4ec2-96dd-a106b2b3e40d";
const SELLER = "A15NQMF7A6J1Y0";
const CONN = `amazon:${SELLER}`;
const MKT = "A2Q3Y263D00KWC";
const APLICAR = process.argv.includes("--aplicar");
const INTERVALO_MS = 500; // 2 req/s, o teto que o cabecalho devolveu

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** A arvore de classificacao, da folha para a raiz: ["Luminarias de Mesa", ..., "Casa"]. */
const trilha = (no) => {
  const nomes = [];
  for (let atual = no; atual; atual = atual.parent) nomes.push(atual.displayName);
  return nomes;
};

await runWithWorkspace(WS, async () => {
  const asins = (await dbQuery(
    `SELECT DISTINCT i.external_product_id AS asin
       FROM workspace_channel_order_items i
      WHERE i.workspace_id = $1 AND i.provider = 'amazon' AND i.connection_id = $2
        AND i.external_product_id IS NOT NULL
      ORDER BY 1`, [WS, CONN])).map((r) => r.asin);
  console.log(`${asins.length} ASINs a capturar | modo: ${APLICAR ? "APLICANDO" : "SECO"}\n`);

  const { getAccounts } = await import("../src/lib/accountStore.ts");
  const conta = (await getAccounts()).find((c) => c.sellerId === SELLER);

  const porCategoria = new Map();
  let capturados = 0, semClassificacao = 0, falhas = 0, limiteVisto = null;

  await runWithAccount({ workspaceId: WS, sellerId: SELLER, refreshToken: conta.refreshToken }, async () => {
    const { getAccessToken } = await import("../src/lib/spapi.ts");
    const token = await getAccessToken();

    for (const [i, asin] of asins.entries()) {
      if (i > 0) await espera(INTERVALO_MS);
      const url = `https://sellingpartnerapi-na.amazon.com/catalog/2022-04-01/items/${asin}`
        + `?marketplaceIds=${MKT}&includedData=summaries,productTypes,classifications`;
      const r = await fetch(url, { headers: { "x-amz-access-token": token } });
      limiteVisto = r.headers.get("x-amzn-RateLimit-Limit") ?? limiteVisto;
      if (!r.ok) {
        console.log(`  ${asin}  HTTP ${r.status} — pulado`);
        falhas += 1;
        continue;
      }
      const j = await r.json();
      const doMercado = (lista) => (lista ?? []).find((x) => x.marketplaceId === MKT);
      const classificacao = doMercado(j.classifications)?.classifications?.[0];
      const resumo = doMercado(j.summaries);
      const caminho = classificacao ? trilha(classificacao) : [];

      // ⚠️ AUSENCIA E AUSENCIA, NAO "Outros". ASIN sem classificacao devolvida
      // fica com `categoria: null` — inventar um rotulo generico aqui faria a
      // tela afirmar uma categoria que a Amazon nao disse (AGENTS.md).
      const registro = {
        asin,
        productType: doMercado(j.productTypes)?.productType ?? null,
        categoria: caminho[0] ?? null,
        categoriaRaiz: caminho.length ? caminho[caminho.length - 1] : null,
        classificationId: classificacao?.classificationId ?? null,
        trilha: caminho.length ? caminho : null,
        marca: resumo?.brand ?? null,
        titulo: resumo?.itemName ?? null,
        capturadoEm: new Date().toISOString(),
      };
      if (!registro.categoria) semClassificacao += 1;
      else porCategoria.set(registro.categoriaRaiz, (porCategoria.get(registro.categoriaRaiz) ?? 0) + 1);

      if (APLICAR) {
        await dbQuery(
          `INSERT INTO workspace_marketplace_products
             (workspace_id, provider, connection_id, external_product_id, status, payload, synced_at)
           VALUES ($1, 'amazon', $2, $3, 'active', $4::jsonb, now())
           ON CONFLICT (workspace_id, provider, connection_id, external_product_id)
           DO UPDATE SET payload = EXCLUDED.payload, synced_at = now()`,
          [WS, CONN, asin, JSON.stringify(registro)]);
      }
      capturados += 1;
      if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${asins.length}…`);
    }
  });

  console.log(`\n=== FIM ===`);
  console.log(`capturados: ${capturados} | sem classificacao: ${semClassificacao} | falhas: ${falhas}`);
  console.log(`teto informado pela API: ${limiteVisto} req/s`);
  console.log("\ncategoria raiz, por quantidade de ASIN:");
  for (const [cat, n] of [...porCategoria].sort((a, b) => b[1] - a[1])) console.log(`  ${String(cat).padEnd(24)} ${n}`);
});
process.exit(0);
