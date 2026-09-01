/**
 * ⚠️ SCRIPT DE CURA — ITERA TODOS OS INQUILINOS POR PADRAO.
 * Rodar numa conta so exige `--conexao <id>` explicito. Ver AGENTS.md.
 *
 * Captura o PRECO DO ANUNCIO pela **Listings Items API** e grava em
 * `workspace_channel_offer_history.price`.
 *
 * ⚠️ **O DEFEITO QUE ISTO CONSERTA, medido em 01/09/2026:** a tabela
 * `workspace_channel_offer_history` e populada todo dia, tem 2.538 linhas na
 * conexao maior — e a coluna `price` esta **vazia em 100% das linhas reais**.
 * So a conta `amazon:demo` tem preco (20 de 20), **e foi isso que escondeu o
 * buraco**: em demonstracao funciona.
 *
 * Sem preco, a fonte de tarifa `tabela` nao consegue estimar o pedido pendente
 * — comissao e percentual sobre preco, e ate a faixa fixa da logistica depende
 * dele. Medido: 28 linhas paradas por falta de preco, zero por falta de
 * categoria.
 *
 * 📌 **POR QUE Listings Items E NAO Catalog Items com `includedData=offers`.**
 * Decisao de 01/09/2026. A Catalog devolve o preco da OFERTA do catalogo, que
 * hoje coincide com o dela porque a buy box e fechada e ela e a unica vendedora
 * — e deixa de coincidir no primeiro anuncio com concorrente. A base da comissao
 * e o preco QUE ELA PRATICA, entao a Listings e o significado certo do numero.
 * Economizar uma chamada custaria uma armadilha que muda de significado em
 * silencio.
 *
 * 📌 **E o preco muda.** Grava-se o valor VIGENTE no momento da captura, com a
 * data (`captured_on`), e a estimativa que o usar guarda o valor usado na
 * propria linha (`unit_price`) — nunca uma referencia. Assim a estimativa
 * continua explicavel depois de a vendedora mudar o preco do anuncio.
 *
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/ts-resolver.mjs \
 *        scripts/capturar-preco-de-anuncio-amazon.mjs [--aplicar] [--conexao <id>]
 */
process.env.DB_POOL_MAX = "2";
import { dbQuery } from "../src/lib/db.ts";
import { runWithWorkspace } from "../src/lib/workspaceScope.ts";
import { runWithAccount } from "../src/lib/accountContext.ts";

const MKT = "A2Q3Y263D00KWC";
const APLICAR = process.argv.includes("--aplicar");
const SO_ESTA_CONEXAO = (() => {
  const i = process.argv.indexOf("--conexao");
  return i === -1 ? null : process.argv[i + 1];
})();
/** Espacamento conservador ate o cabecalho dizer o teto real da Listings. */
let intervaloMs = 500;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const brl = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v));

/**
 * O preco do anuncio dentro da resposta da Listings Items.
 *
 * A API expoe o preco em mais de um lugar conforme o `includedData` e o tipo do
 * anuncio. Procura-se na ordem do mais especifico para o mais geral, e devolve
 * `null` quando nenhum existe — anuncio inativo ou sem preco publicado NAO
 * herda preco de venda passada (seria media nossa disfarcada; ver ADR-027).
 */
function precoDoAnuncio(item) {
  const offers = item?.offers ?? [];
  for (const oferta of offers) {
    const p = oferta?.price?.amount ?? oferta?.price?.Amount;
    if (p != null && Number(p) > 0) return Number(p);
  }
  const compravel = item?.attributes?.purchasable_offer ?? [];
  for (const oferta of compravel) {
    const p = oferta?.our_price?.[0]?.schedule?.[0]?.value_with_tax;
    if (p != null && Number(p) > 0) return Number(p);
  }
  const listPrice = item?.attributes?.list_price?.[0]?.value;
  if (listPrice != null && Number(listPrice) > 0) return Number(listPrice);
  return null;
}

const conexoes = await dbQuery(
  `SELECT DISTINCT o.workspace_id, o.connection_id
     FROM workspace_channel_orders o
    WHERE o.provider = 'amazon' AND o.connection_id <> 'amazon:demo'
    ORDER BY 1, 2`);
const alvos = SO_ESTA_CONEXAO ? conexoes.filter((c) => c.connection_id === SO_ESTA_CONEXAO) : conexoes;
console.log(`conexoes Amazon: ${conexoes.length} | a processar: ${alvos.length} | modo: ${APLICAR ? "APLICANDO" : "SECO"}`);

for (const { workspace_id: WS, connection_id: CONN } of alvos) {
  const SELLER = CONN.replace("amazon:", "");
  console.log(`\n===== ${CONN} (workspace ${WS.slice(0, 8)}) =====`);
  await runWithWorkspace(WS, async () => {
    // O par (SKU, ASIN) vem dos itens de pedido. A Listings pergunta por SKU, e
    // `offer_history` tambem e chaveada por SKU — apesar de a coluna se chamar
    // `external_product_id` (ver a nota na gravacao).
    const skus = await dbQuery(
      `SELECT DISTINCT i.sku, i.external_product_id AS asin
         FROM workspace_channel_order_items i
        WHERE i.workspace_id = $1 AND i.provider = 'amazon' AND i.connection_id = $2
          AND i.sku IS NOT NULL AND i.external_product_id IS NOT NULL
        ORDER BY 1`, [WS, CONN]);
    console.log(`${skus.length} pares (SKU, ASIN) a consultar`);

    const { getAccounts } = await import("../src/lib/accountStore.ts");
    const conta = (await getAccounts()).find((c) => c.sellerId === SELLER);
    const comCredencial = (fn) =>
      conta ? runWithAccount({ workspaceId: WS, sellerId: SELLER, refreshToken: conta.refreshToken }, fn) : fn();
    console.log(`credencial: ${conta ? "token guardado (app-dash)" : "par do .env (conta dona)"}`);

    let comPreco = 0, semPreco = 0, falhas = 0, gravadas = 0, limite = null;

    await comCredencial(async () => {
      const { getAccessToken } = await import("../src/lib/spapi.ts");
      const token = await getAccessToken();

      for (const [i, { sku, asin }] of skus.entries()) {
        if (i > 0) await espera(intervaloMs);
        const url = `https://sellingpartnerapi-na.amazon.com/listings/2021-08-01/items/${SELLER}/${encodeURIComponent(sku)}`
          + `?marketplaceIds=${MKT}&includedData=offers,attributes,summaries`;
        const r = await fetch(url, { headers: { "x-amz-access-token": token } });
        const teto = r.headers.get("x-amzn-RateLimit-Limit");
        if (teto) {
          limite = teto;
          // Obedece o teto informado em vez de so registra-lo — a divergencia
          // documentada em docs/api-amazon-sp-api.md e justamente essa.
          const porSegundo = Number(teto);
          if (Number.isFinite(porSegundo) && porSegundo > 0) intervaloMs = Math.ceil(1000 / porSegundo);
        }
        if (!r.ok) {
          if (falhas < 3) console.log(`  ${sku}: HTTP ${r.status}`);
          falhas += 1;
          continue;
        }
        const preco = precoDoAnuncio(await r.json());
        if (preco == null) { semPreco += 1; continue; }
        comPreco += 1;

        if (APLICAR) {
          // ⚠️ A CHAVE E O SKU, NAO O ASIN — medido em 01/09/2026 e contra a
          // intuicao do nome da coluna.
          //
          // `workspace_channel_offer_history.external_product_id` guarda o SKU
          // do vendedor (CADARCO-BRANCO, CANECA-COBRE-500ML), nao o ASIN. A
          // primeira versao deste script casou por ASIN e atualizou ZERO linhas
          // em 78 SKUs com preco na mao — falha silenciosa, porque UPDATE que
          // nao casa nada nao levanta erro nenhum.
          //
          // Medido: 0 dos 74 ASINs de pedido casam com a coluna; 67 dos SKUs
          // casam. O nome da coluna diz "product_id" e o conteudo e SKU — mesma
          // familia do `billing` que parecia faturamento, e entra na lista de
          // renames.
          //
          // 📌 E e UPSERT, nao UPDATE puro: so 99 linhas existem para hoje, e as
          // demais precisam nascer. Sao no maximo 78 linhas por conexao — alguns
          // KB, muito abaixo do freio de disco combinado.
          const r2 = await dbQuery(
            `INSERT INTO workspace_channel_offer_history
               (workspace_id, provider, connection_id, external_product_id, captured_on,
                sku, price, currency, updated_at)
             VALUES ($1, 'amazon', $2, $3, CURRENT_DATE, $3, $4, 'BRL', now())
             ON CONFLICT (workspace_id, provider, connection_id, external_product_id, captured_on)
             DO UPDATE SET price = EXCLUDED.price,
                           currency = COALESCE(workspace_channel_offer_history.currency, 'BRL'),
                           updated_at = now()
             RETURNING 1`, [WS, CONN, sku, preco]);
          gravadas += r2.length;
        }
        if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${skus.length}…`);
      }
    });

    console.log(`\ncom preco: ${comPreco} | sem preco: ${semPreco} | falhas: ${falhas} | linhas atualizadas: ${gravadas}`);
    console.log(`teto informado pela Listings: ${limite ?? "nao informado"} req/s`);
    if (APLICAR) {
      const [conf] = await dbQuery(
        `SELECT COUNT(*)::int linhas, COUNT(price)::int com_preco,
                ROUND(MIN(price)::numeric,2)::text menor, ROUND(MAX(price)::numeric,2)::text maior
           FROM workspace_channel_offer_history
          WHERE workspace_id = $1 AND provider = 'amazon' AND connection_id = $2
            AND captured_on = CURRENT_DATE`, [WS, CONN]);
      console.log(`conferencia de hoje: ${conf.com_preco} de ${conf.linhas} linhas com preco`
        + (conf.com_preco > 0 ? ` (de ${brl(conf.menor)} a ${brl(conf.maior)})` : ""));
    }
  });
}
process.exit(0);
