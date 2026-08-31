import { getFinanceSummaryFromTransactions, type FinanceSummaryFromTransactions } from "./transactions";
import { getCosts } from "./costStore";
import type { Period } from "./period";
import { calculateHistoricalCostCoverage } from "./financialMath";
import { getAmazonOverviewCanonicalCached } from "./integrations/amazonOverviewCanonical";
import { dbQuery } from "./db";
import { currentAccountId } from "./accountContext";
import { currentWorkspaceId } from "./workspaceScope";
import { amazonTaxAmount, getAmazonTaxRateSetting } from "./integrations/amazonSettings";

export interface ProfitSummary {
  finance: FinanceSummaryFromTransactions;
  cogs: number; // custo das mercadorias vendidas (unidades × custo cadastrado)
  /**
   * Repasse líquido − COGS − imposto (quando configurado) − ANÚNCIO.
   *
   * ⚠️ O anúncio JÁ ESTÁ AQUI DENTRO desde 30/08/2026 — ver a fronteira em
   * `financialMath.ts`. Quem consome (MONITOR, HOME) não subtrai de novo.
   * `null` quando o gasto com anúncio é desconhecido: o número sem anúncio
   * seria otimista, e otimista sem aviso é mentira.
   */
  estimatedProfit: number | null;
  unitsWithCost: number;
  unitsWithoutCost: number; // unidades vendidas sem custo cadastrado
  skusMissingCost: string[];
  /** Alíquota declarada pela vendedora. `null` = ainda não configurada. */
  taxRate: number | null;
  /** Imposto do período. `null` quando não há alíquota — nunca zero por omissão. */
  taxes: number | null;
  /** Gasto com anúncio JÁ descontado de `estimatedProfit`. `null` = desconhecido. */
  ads: number | null;
  /** A conta anuncia e a métrica do período não chegou. */
  adsDesconhecido: boolean;
  /** Último dia com métrica de anúncio. Não extrapolamos os dias que faltam. */
  adsAteDia: string | null;
}

/**
 * Lucro estimado do período, tudo a partir da Transactions API 2024-06-19
 * (a Finances v0 devolve valores zerados). Dinheiro (receita, taxas, repasse)
 * e unidades por SKU vêm da mesma fonte; o custo das mercadorias sai do
 * cruzamento com os custos cadastrados na vigência de cada venda.
 */
export async function getProfitSummary(period: Period): Promise<ProfitSummary> {
  const [finance, costs, taxRate] = await Promise.all([
    getFinanceSummaryFromTransactions(period),
    getCosts(),
    // A alíquota é declarada pela vendedora, não vem da Amazon. Falhar aqui não
    // pode derrubar o lucro inteiro — sem ela o resultado sai sem imposto e a
    // tela diz isso, que é o mesmo comportamento de quem nunca configurou.
    getAmazonTaxRateSetting(dbQuery, currentWorkspaceId(), currentAccountId()).catch(() => null),
  ]);

  // A cobertura de custo continua saindo daqui: `salesLines` é o que diz quais
  // SKUs venderam e em que data, e é o insumo do "N unidades sem custo".
  const coverage = calculateHistoricalCostCoverage(finance.netProceeds, finance.salesLines, costs);

  // ═══ UMA DEFINIÇÃO SÓ DE LUCRO DA AMAZON (31/08/2026) ═══════════════════════
  //
  // ⚠️ Este produtor DEIXOU DE CALCULAR o lucro e passou a LER o do canônico —
  // o mesmo que o dashboard da Amazon exibe. Antes eram duas fórmulas, e elas
  // discordavam na conta dela em R$ 292,16 no mesmo instante: a tela central
  // dizia +R$ 276,53 e o dashboard −R$ 15,63.
  //
  // AS DUAS DIFERENÇAS, medidas termo a termo:
  //
  //   1. BASE. Aqui partia-se de `netProceeds` (repasse líquido, R$ 609,45); o
  //      canônico parte da receita BRUTA (R$ 748,56). A bruta é a base do card
  //      de Faturamento ao lado — `netProceeds` nunca fecharia com card nenhum.
  //      E ele não é mais verdadeiro, é mais TARDIO: cobre só o que a Amazon já
  //      postou, que é a mesma doença da tarifa ausente.
  //
  //   2. ANÚNCIO. Aqui descontava-se o `ProductAdsPayment` do extrato
  //      (R$ 256,22), que é só o FATURADO. O canônico desconta a Ads API
  //      (R$ 428,88), que é o gasto real — provado em 30/08 contra o console:
  //      R$ 417,09 = R$ 256,22 faturado + R$ 160,87 acumulado. Descontar o
  //      menor número INFLA o lucro.
  //
  // ⚠️ ENUMERAR ANTES DE MIGRAR — e este é o critério, não o caso.
  //
  // Antes de trocar a fórmula, listei tudo que existe dentro do `netProceeds`
  // desta conta em 30 dias, em vez de assumir "netProceeds = vendas − tarifas":
  //
  //   Shipment [RELEASED]           +380,70   → vira receita bruta − fees
  //   Shipment [DEFERRED]           +365,47   → idem
  //   ProductAdsPayment [RELEASED]  −256,22   → passa a vir da Ads API, maior
  //   DebtRecovery [RELEASED]       +119,50   → SAI, e sai certo (abaixo)
  //                                 = 609,45
  //
  // Assumir a fórmula teria perdido os R$ 119,50 em silêncio e a gente teria
  // chamado isso de "alinhamento". É o mesmo erro da premissa "a Amazon não tem
  // imposto do vendedor", na direção contrária: lá afirmamos o que não medimos,
  // aqui teríamos deixado de ver o que não listamos.
  //
  // ⚠️ POR QUE O `DebtRecovery` DE +R$ 119,50 SOME, E ISSO NÃO É DEFEITO.
  //
  // Quem vier depois vai ver R$ 119,50 desaparecerem do lucro e achar que se
  // perdeu um termo. Não se perdeu: **é movimento de caixa, não resultado.**
  // São os R$ 119,50 que a Amazon cobrou no cartão dela em 30/08 para quitar a
  // dívida de anúncio, e que ela estranhou. O custo do anúncio JÁ está contado
  // (R$ 428,88 pela Ads API); somar o pagamento da dívida como ganho seria
  // contar o mesmo dinheiro duas vezes, com o sinal trocado. Parar de somar
  // dinheiro que nunca foi lucro não é remoção.
  //
  // ⚠️ E A GUARDA DE DUPLA CONTAGEM TROCOU DE LADO. `anuncioJaNoExtrato` existia
  // para zerar a Ads API quando o extrato já trazia `AdvertisingFee`. Com o
  // anúncio vindo SEMPRE da Ads API, a guarda que importa é a inversa: o
  // `ProductAdsPayment` do extrato não pode entrar em `fees`. Ele não entra por
  // construção — `fees` do canônico vem de `workspace_channel_order_fees`, cujos
  // únicos tipos são commission, refund e fulfillment —, e há teste para isso.
  const canonico = await getAmazonOverviewCanonicalCached(period);

  return {
    finance,
    ...coverage,
    // O lucro e seus componentes são os do canônico, sem exceção: dois lugares
    // calculando o mesmo número é como eles voltam a divergir.
    cogs: canonico?.profit.cogs ?? coverage.cogs,
    taxRate: canonico?.profit.taxRate ?? taxRate,
    taxes: canonico?.profit.taxes ?? amazonTaxAmount(finance.revenue, taxRate),
    estimatedProfit: canonico?.profit.estimatedProfit ?? null,
    ads: canonico?.profit.ads ?? null,
    adsDesconhecido: canonico?.profit.adsDesconhecido ?? true,
    adsAteDia: canonico?.profit.adsAteDia ?? null,
  };
}
