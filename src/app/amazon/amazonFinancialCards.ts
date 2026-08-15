// Cards financeiros da Amazon — mesmo padrão do TikTok (`TikTokWorkspaceModel.ts`):
// componente sem dado NÃO vira zero. Cada card diz exatamente o que está faltando,
// porque "R$ 0,00" e "ainda não sei" são fatos diferentes e confundi-los corrompe
// qualquer decisão de preço ou de compra de estoque.
//
// Módulo puro, sem dependências, para ser testável.

export interface AmazonFinanceInput {
  currency: string;
  revenue: number;
  fees: number;
  refunds: number;
  promotions?: number;
  buyerShipping?: number;
  feeBreakdown?: { type: string; amount: number }[];
}

export interface AmazonCardsInput {
  finance: AmazonFinanceInput | null;
  cogs: number;
  estimatedProfit: number;
  /** Unidades vendidas sem custo cadastrado — invalida COGS, lucro, margem e ROI. */
  unitsWithoutCost: number;
  /** Alíquota de imposto configurada para a conta; hoje não existe na Amazon. */
  taxRate?: number | null;
}

export interface AmazonCard {
  key: string;
  label: string;
  value: string;
  context: string;
  tone?: "positive" | "default";
  /** Valor cru, quando conhecido. É o que permite animar o número na tela. */
  raw?: number | null;
}

const money = (v: number, currency: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);
const percent = (v: number) =>
  `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

// Somatório dos tipos de tarifa que compõem cada card. Tipo que não estiver aqui
// continua contando no total de "Taxas" — nada é descartado.
const LOGISTICA_FBA = ["FBAPerUnitFulfillmentFee", "FBAPerOrderFulfillmentFee", "FBAWeightBasedFee", "FBAStorageFee", "FBAInventoryFee"];
const ANUNCIOS = ["AdvertisingFee", "ProductAdsPaymentEvent", "CostOfAdvertising"];
const RETENCOES = ["MarketplaceFacilitatorTax", "MarketplaceFacilitatorVAT", "TaxWithheld", "WithheldTax"];

/**
 * Tipo de tarifa ausente num período **conciliado** vale ZERO, não "não sei": a
 * Amazon já postou o extrato e simplesmente não cobrou aquilo. Tratar como
 * desconhecido fazia três dos doze cards exibirem "—" para sempre, sugerindo
 * falha de leitura quando o fato é que a tarifa não existe (hoje a logística FBA
 * está isenta pela promoção de vendedor novo).
 *
 * Sem extrato conciliado, aí sim é desconhecido — e continua "—".
 */
function somaTipos(
  breakdown: { type: string; amount: number }[] | undefined,
  tipos: string[],
  conciliado: boolean
): number | null {
  const achados = (breakdown ?? []).filter((f) => tipos.includes(f.type));
  if (achados.length) return +achados.reduce((s, f) => s + f.amount, 0).toFixed(2);
  return conciliado ? 0 : null;
}

export function amazonFinancialCards(input: AmazonCardsInput): AmazonCard[] {
  const f = input.finance;
  const currency = f?.currency ?? "BRL";
  const semExtrato = "Aguardando repasse postado pela Amazon";
  const custoIncompleto = input.unitsWithoutCost > 0;

  // Zero tem significado próprio e merece explicação: "não cobraram" é notícia,
  // e o card que só diz "Total do período conciliado" desperdiça a informação.
  const num = (
    v: number | null | undefined,
    contextoQuandoFalta: string,
    tone?: "positive",
    contextoQuandoZero?: string
  ): Omit<AmazonCard, "key" | "label"> =>
    v == null
      ? { value: "—", context: contextoQuandoFalta, raw: null }
      : {
          value: money(v, currency),
          context: v === 0 && contextoQuandoZero ? contextoQuandoZero : "Total do período conciliado",
          tone,
          raw: v,
        };

  const logistica = somaTipos(f?.feeBreakdown, LOGISTICA_FBA, f != null);
  const anuncios = somaTipos(f?.feeBreakdown, ANUNCIOS, f != null);
  const retencoes = somaTipos(f?.feeBreakdown, RETENCOES, f != null);

  // Lucro, margem e ROI só existem se TODO componente de custo existir. Com SKU
  // sem custo cadastrado, o resultado seria otimista — e otimista sem aviso é mentira.
  const resultadoValido = f != null && !custoIncompleto;
  const margem = resultadoValido && f.revenue > 0 ? (input.estimatedProfit / f.revenue) * 100 : null;
  const roi = resultadoValido && input.cogs > 0 ? (input.estimatedProfit / input.cogs) * 100 : null;

  const faltaCusto = custoIncompleto
    ? `Aguardando custo de ${input.unitsWithoutCost} unidade(s)`
    : "Aguardando custos dos produtos";

  return [
    { key: "revenue", label: "Faturamento", ...num(f?.revenue, "Aguardando cobertura completa do período") },
    { key: "fees", label: "Taxas", ...num(f?.fees, semExtrato) },
    { key: "fbaShipping", label: "Logística FBA", ...num(logistica, "Aguardando tarifas de logística no extrato", undefined, "A Amazon não cobrou logística no período") },
    { key: "buyerShipping", label: "Frete do comprador", ...num(f?.buyerShipping, "Aguardando frete pago pelo comprador", undefined, "Nenhum frete pago pelo comprador") },
    { key: "ads", label: "Anúncios", ...num(anuncios, "Aguardando despesas com anúncios no extrato", undefined, "Nenhuma despesa com anúncios no período") },
    { key: "taxesWithheld", label: "Impostos retidos", ...num(retencoes, "Aguardando retenções discriminadas no extrato", undefined, "A Amazon não reteve imposto no período") },
    { key: "refunds", label: "Estornos", ...num(f?.refunds, semExtrato, undefined, "Nenhum estorno no período") },
    {
      key: "tax", label: "Impostos",
      value: input.taxRate == null ? "—" : percent(input.taxRate),
      // Diferente dos demais: não é dado que a Amazon manda, é alíquota que a
      // vendedora define. Enquanto a Amazon não tiver a tela de configuração que
      // ML, Shopee e TikTok já têm, o card não tem como preencher — e precisa
      // dizer isso, em vez de parecer que estamos esperando a Amazon.
      context: input.taxRate == null ? "Depende de configurar a alíquota" : "Alíquota configurada",
    },
    {
      key: "cogs", label: "Custo dos produtos",
      // Sem período conciliado não há como afirmar custo zero: "não houve venda" e
      // "ainda não sei o que foi vendido" dariam o mesmo R$ 0,00 na tela.
      ...(f == null || custoIncompleto ? { value: "—", context: faltaCusto } : num(input.cogs, faltaCusto)),
    },
    {
      key: "profit", label: "Lucro",
      ...(resultadoValido
        ? { value: money(input.estimatedProfit, currency), context: "Faturamento − taxas − custo", tone: "positive" as const, raw: input.estimatedProfit }
        : { value: "—", context: custoIncompleto ? faltaCusto : "Aguardando todos os componentes financeiros", raw: null }),
    },
    {
      key: "marginPct", label: "Margem",
      value: margem == null ? "—" : percent(margem),
      context: margem == null ? (custoIncompleto ? faltaCusto : "Aguardando receita e lucro completos") : "Lucro sobre faturamento",
    },
    {
      key: "roiPct", label: "ROI",
      value: roi == null ? "—" : percent(roi),
      context: roi == null ? (custoIncompleto ? faltaCusto : "Aguardando lucro e custo completos") : "Lucro sobre o custo investido",
    },
  ];
}
