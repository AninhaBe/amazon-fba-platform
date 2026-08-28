import { dbQuery, hasDb } from "../db";
import { currentWorkspaceId } from "../workspaceScope";

/**
 * Métricas de anúncio POR PRODUTO, agregadas no período da tela.
 *
 * Lê só do banco (`workspace_ad_product_metrics`, migration 0016) — nunca chama
 * a Amazon, como o resto da leitura de anúncio (o relatório é assíncrono e roda
 * no cron).
 *
 * ⚠️ ACOS e ROAS NÃO são somados nem recalculados: são métricas de RAZÃO, e
 * somar razão não significa nada. Ao agregar vários dias, tomamos a média
 * PONDERADA pelo que dá sentido a cada uma — ACOS pelo gasto, ROAS pela venda —
 * e só quando houve venda atribuída. Sem venda, `null`: a fonte manda `0` nesse
 * caso (medido no PADS do ML em 28/08/2026) e `0` leria como desempenho ótimo.
 */

export interface AdsProdutoLinha {
  productId: string;
  sku: string | null;
  title: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  purchases: number;
  acos: number | null;
  roas: number | null;
  currency: string;
}

/**
 * `provider` é parâmetro porque a leitura é a MESMA nos canais — a tabela da
 * migration 0016 nasceu agnóstica, e o Mercado Livre grava nela com
 * `provider='mercado_livre'`. Só a origem do dado muda; a conta não.
 */
export async function anunciosPorProdutoNoPeriodo(
  inicioISO: string,
  fimISO: string,
  provider = "amazon",
): Promise<AdsProdutoLinha[]> {
  if (!hasDb()) return [];
  const rows = await dbQuery<{
    product_id: string; sku: string | null; product_title: string | null;
    impressions: string; clicks: string; cost: string; sales: string; purchases: string;
    acos: string | null; roas: string | null; currency: string | null;
  }>(
    `SELECT product_id,
            NULLIF(sku, '')            AS sku,
            MAX(product_title)         AS product_title,
            SUM(impressions)::text     AS impressions,
            SUM(clicks)::text          AS clicks,
            SUM(cost)::text            AS cost,
            SUM(sales)::text           AS sales,
            SUM(purchases)::text       AS purchases,
            -- Médias ponderadas, e SÓ com venda atribuída no período. Sem
            -- pedido, a razão não tem significado e vira null (nunca 0).
            CASE WHEN SUM(purchases) > 0 AND SUM(cost) > 0
                 THEN (SUM(acos * cost) FILTER (WHERE acos IS NOT NULL) / NULLIF(SUM(cost) FILTER (WHERE acos IS NOT NULL), 0))::text
            END AS acos,
            CASE WHEN SUM(purchases) > 0 AND SUM(sales) > 0
                 THEN (SUM(roas * sales) FILTER (WHERE roas IS NOT NULL) / NULLIF(SUM(sales) FILTER (WHERE roas IS NOT NULL), 0))::text
            END AS roas,
            MAX(currency)              AS currency
       FROM workspace_ad_product_metrics
      WHERE workspace_id = $1 AND provider = $2
        AND day BETWEEN ($3::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
                    AND ($4::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
      GROUP BY product_id, NULLIF(sku, '')
      ORDER BY SUM(cost) DESC`,
    [currentWorkspaceId(), provider, inicioISO, fimISO],
  );

  return rows.map((row) => ({
    productId: row.product_id,
    sku: row.sku,
    title: row.product_title,
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    cost: Number(row.cost ?? 0),
    sales: Number(row.sales ?? 0),
    purchases: Number(row.purchases ?? 0),
    acos: row.acos == null ? null : Number(row.acos),
    roas: row.roas == null ? null : Number(row.roas),
    currency: row.currency ?? "BRL",
  }));
}

/**
 * Junta o anúncio (do canal) com a margem real (nossa), por SKU.
 *
 * A margem entra por SKU porque é a chave que o custo cadastrado usa. Produto
 * anunciado sem margem conhecida sai com `margemRealPct: null` — a tela então
 * mostra a pendência de cadastro em vez de um veredito sobre número incompleto.
 */
export function cruzarComMargem(
  anuncios: AdsProdutoLinha[],
  margensPorSku: Array<{ sku: string; marginPct: number | null }>,
): Array<AdsProdutoLinha & { margemRealPct: number | null }> {
  const porSku = new Map(margensPorSku.map((item) => [item.sku, item.marginPct]));
  return anuncios.map((anuncio) => ({
    ...anuncio,
    margemRealPct: anuncio.sku ? porSku.get(anuncio.sku) ?? null : null,
  }));
}
