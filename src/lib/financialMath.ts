export interface CostCoverage {
  cogs: number;
  estimatedProfit: number;
  unitsWithCost: number;
  unitsWithoutCost: number;
  skusMissingCost: string[];
}

export function calculateCostCoverage(
  netProceeds: number,
  unitsBySku: Record<string, number>,
  costs: Record<string, { cost: number } | undefined>
): CostCoverage {
  let cogs = 0;
  let unitsWithCost = 0;
  let unitsWithoutCost = 0;
  const skusMissingCost: string[] = [];

  for (const [sku, units] of Object.entries(unitsBySku)) {
    const cost = costs[sku]?.cost;
    if (cost == null || cost < 0) {
      unitsWithoutCost += units;
      skusMissingCost.push(sku);
    } else {
      cogs += units * cost;
      unitsWithCost += units;
    }
  }

  return {
    cogs: +cogs.toFixed(2),
    estimatedProfit: +(netProceeds - cogs).toFixed(2),
    unitsWithCost,
    unitsWithoutCost,
    skusMissingCost,
  };
}

export function percentage(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

export function calculateHistoricalCostCoverage(
  netProceeds: number,
  sales: { sku: string; units: number; purchasedAt: string }[],
  costs: Record<string, { cost: number; updatedAt: string; history?: { cost: number; from: string }[] } | undefined>
): CostCoverage {
  let cogs = 0;
  let unitsWithCost = 0;
  let unitsWithoutCost = 0;
  const missing = new Set<string>();
  for (const sale of sales) {
    const entry = costs[sale.sku];
    const history = entry?.history?.length ? entry.history : entry ? [{ cost: entry.cost, from: entry.updatedAt }] : [];
    const cost = history.filter((change) => change.from <= sale.purchasedAt).at(-1)?.cost;
    if (cost == null || cost < 0) {
      unitsWithoutCost += sale.units;
      missing.add(sale.sku);
    } else {
      cogs += sale.units * cost;
      unitsWithCost += sale.units;
    }
  }
  return { cogs: +cogs.toFixed(2), estimatedProfit: +(netProceeds - cogs).toFixed(2), unitsWithCost, unitsWithoutCost, skusMissingCost: [...missing] };
}

/**
 * ═══ A FRONTEIRA DO ANÚNCIO ═══════════════════════════════════════════════
 *
 * **`estimatedProfit` INCLUI o gasto com anúncio. Quem consome NÃO subtrai de
 * novo.** Esta linha é o contrato, e ela existe porque a alternativa já custou
 * quatro consertos.
 *
 * O QUE ACONTECEU. A decisão da vendedora em 25/08/2026 — *"o card de lucro
 * passa a descontar também o ads, isso é lucro real"* — foi aplicada onde ela
 * apontou: o CARD da Amazon. O painel ao lado ficou com a definição anterior, e
 * a mesma tela passou a exibir dois números chamados lucro com sinais opostos.
 * Consertado o painel (29/08), a cascata escrita embaixo ainda somava até o
 * número antigo. Três superfícies, três cópias da mesma subtração, cada conserto
 * alcançando só a cópia que alguém tinha visto.
 *
 * E enquanto a Amazon ganhava a terceira cópia, MERCADO LIVRE, MONITOR e HOME
 * seguiam ignorando o anúncio inteiro. Medido em 30/08/2026: **R$ 2.827,10 de
 * gasto com anúncio fora do lucro** — R$ 2.411,25 no ML em 3 dias e R$ 415,85 na
 * Amazon em 19 dias. Não era um número errado numa tela: era a maior despesa da
 * operação ausente da conta em quase todas elas.
 *
 * A CAUSA, e por que a regra é esta. Enquanto a subtração morar em quem EXIBE, o
 * número de lucro tem tantas definições quantas telas existirem, e a próxima
 * tela nasce com a definição antiga — foi assim quatro vezes. Movendo a
 * subtração para quem PRODUZ o número, existe uma definição só: o produtor
 * canônico de cada canal desconta o anúncio ao fabricar `estimatedProfit`, e
 * toda superfície (card, rosca, cascata, monitor, home, insight) apenas LÊ.
 *
 * ⚠️ O corolário que fecha a porta: **consumidor que subtrai anúncio de
 * `estimatedProfit` conta o mesmo dinheiro duas vezes.** Se você está numa tela
 * e sente falta da subtração, ela já foi feita — procure `descontarAnuncio` no
 * produtor do canal.
 *
 * ═══ E A REGRA É POR CANAL, NÃO GLOBAL (30/08/2026, decisão da vendedora) ═══
 *
 * ⚠️ **Mercado Livre: anúncio NÃO entra no lucro.** Palavras dela: *"nem era pra
 * puxar ads. O ads o seller desconta depois no mercado livre, quando fizer seu
 * próprio fechamento."* No ML o anúncio é conciliado por fora, então descontar
 * aqui subtrairia duas vezes na cabeça de quem faz o fechamento.
 *
 * ⚠️ **Amazon: anúncio ENTRA.** Decisão dela em 25/08/2026 — *"o card de lucro
 * passa a descontar também o ads, isso é lucro real"* —, e o número foi
 * conferido contra o console: R$ 417,09 da Ads API = R$ 256,22 já faturado no
 * extrato + R$ 160,87 de cobrança acumulada.
 *
 * **Quem define a semântica de cada canal é a vendedora, não nós.** Ela conhece
 * o fechamento que faz em cada um; nós conhecemos a API. Um canal novo entra
 * aqui com a decisão DELA escrita ao lado, nunca por simetria com os outros.
 *
 * Os produtores que cumprem a fronteira COM anúncio dentro:
 *   - `integrations/amazonOverviewCanonical.ts`       (dashboard da Amazon)
 *   - `profit.ts`                                     (MONITOR e HOME)
 * A Shopee já cumpria: o anúncio dela vem no escrow e sempre entrou em
 * `estimatedProfit` (ver `shopeeOverviewCanonical.ts`).
 *
 * ⚠️ E a fronteira NÃO é uma lista fixa. `tests/anuncioEntraNoLucro.test.mjs`
 * descobre os canais que gastam com anúncio por `SELECT DISTINCT` nas duas
 * tabelas de métrica e exige o termo de anúncio no produtor de lucro de cada um
 * — o canal número cinco entra sozinho na vigilância.
 */
/**
 * Canais em que o anúncio **não** entra no lucro, e o porquê — declaração
 * explícita, para que a ausência de `descontarAnuncio` no produtor seja uma
 * DECISÃO registrada e não um esquecimento.
 *
 * `tests/anuncioEntraNoLucro.test.mjs` lê isto: canal que gasta com anúncio ou
 * desconta, ou está aqui com motivo. Não há terceira opção silenciosa.
 */
export const ANUNCIO_FORA_DO_LUCRO: Record<string, string> = {
  mercado_livre:
    "Decisão da vendedora em 30/08/2026: \"nem era pra puxar ads. O ads o seller " +
    "desconta depois no mercado livre, quando fizer seu proprio fechamento.\" " +
    "Descontar aqui subtrairia duas vezes.",
};

export interface AnuncioDoPeriodo {
  /**
   * Gasto com anúncio no período. `null` = o canal anuncia e a métrica ainda não
   * chegou: DESCONHECIDO, nunca zero (AGENTS.md). `0` = não gastou, e isso é um
   * fato.
   */
  gasto: number | null;
  /**
   * O anúncio já veio como tarifa no extrato do canal e já saiu do repasse.
   * Descontar a API de Ads por cima contaria o mesmo dinheiro duas vezes.
   */
  jaNoExtrato: boolean;
  /**
   * Último dia com métrica gravada, `YYYY-MM-DD`. A tela cola isto no número:
   * não extrapolamos os dias que faltam, dizemos até quando a conta vai.
   */
  ateDia: string | null;
}

export interface LucroComAnuncio {
  /** `null` quando o gasto é desconhecido — nunca o número otimista que assume zero. */
  estimatedProfit: number | null;
  /** O que foi descontado. `null` = desconhecido; `0` = não gastou. */
  ads: number | null;
  /** O canal anuncia e a métrica do período não chegou. */
  adsDesconhecido: boolean;
  ateDia: string | null;
}

/**
 * Aplica a fronteira: recebe o lucro ANTES do anúncio e devolve o lucro que vai
 * para a tela — já com o anúncio dentro.
 *
 * Chamada pelos quatro produtores. É a única subtração de anúncio do sistema.
 */
export function descontarAnuncio(
  lucroAntesDoAnuncio: number | null,
  anuncio: AnuncioDoPeriodo
): LucroComAnuncio {
  // Anúncio postado no extrato já saiu do repasse líquido que virou
  // `lucroAntesDoAnuncio`. Aqui ele vale zero, e isso não é desconhecimento.
  const gasto = anuncio.jaNoExtrato ? 0 : anuncio.gasto;
  const adsDesconhecido = gasto == null;
  return {
    estimatedProfit:
      lucroAntesDoAnuncio == null || gasto == null
        ? null
        : +(lucroAntesDoAnuncio - gasto).toFixed(2),
    ads: gasto,
    adsDesconhecido,
    ateDia: anuncio.ateDia,
  };
}
