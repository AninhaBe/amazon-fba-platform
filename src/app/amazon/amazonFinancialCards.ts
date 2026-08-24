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
  /**
   * Pedidos com repasse POSTADO no período. Zero significa que a Amazon ainda
   * não postou nada — e aí todo valor derivado é desconhecido, não zero.
   * Opcional porque nem toda origem informa; ausente, o comportamento é o de
   * antes (não trava nada).
   */
  orderCount?: number;
}

export interface AmazonCardsInput {
  finance: AmazonFinanceInput | null;
  cogs: number;
  estimatedProfit: number;
  /** Unidades vendidas sem custo cadastrado — invalida COGS, lucro, margem e ROI. */
  unitsWithoutCost: number;
  /** Alíquota declarada pela vendedora. `null` = não configurada. */
  taxRate?: number | null;
  /** Imposto do período, já descontado de `estimatedProfit`. `null` sem alíquota. */
  taxes?: number | null;
}

export interface AmazonCard {
  key: string;
  label: string;
  value: string;
  context: string;
  tone?: "positive" | "danger" | "default";
  /** Valor cru, quando conhecido. É o que permite animar o número na tela. */
  raw?: number | null;
}

const money = (v: number, currency: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);
const percent = (v: number) =>
  `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

// Categorização por PADRÃO, não por lista de nomes exatos.
//
// A lista exata era um risco silencioso: a Amazon tem dezenas de tarifas FBA
// (`FBADisposalFee`, `FBARemovalFee`, `FBALongTermStorageFee`,
// `FBAInboundPlacementServiceFee`…) e só `FBAPerUnitFulfillmentFee` estava
// confirmada — o resto era suposição. Numa conta que paga tarifa, um nome fora
// da lista sairia como R$ 0,00: resposta errada com cara de certeza, agora que
// ausência em período conciliado significa zero.
//
// Tipo que não casa com nenhum padrão continua somando em "Taxas" — nada é
// descartado, e "Taxas" é sempre a autoridade sobre o total.
const LOGISTICA_FBA = (tipo: string) => /^FBA/i.test(tipo) || /fulfillment|storage/i.test(tipo);
const ANUNCIOS = (tipo: string) => /advertis|productads/i.test(tipo);
const COMISSAO = (tipo: string) => /commission|referralfee/i.test(tipo);

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
  pertence: (tipo: string) => boolean,
  conciliado: boolean
): number | null {
  const achados = (breakdown ?? []).filter((f) => pertence(f.type));
  if (achados.length) return +achados.reduce((s, f) => s + f.amount, 0).toFixed(2);
  return conciliado ? 0 : null;
}

export function amazonFinancialCards(input: AmazonCardsInput): AmazonCard[] {
  const f = input.finance;
  const currency = f?.currency ?? "BRL";
  const semExtrato = "Aguardando repasse postado pela Amazon";
  const custoIncompleto = input.unitsWithoutCost > 0;

  // NENHUM REPASSE POSTADO no período: o resumo financeiro EXISTE, mas está
  // vazio. Sem esta trava, tudo que deriva dele saía como R$ 0,00 — e zero aqui
  // não é fato, é ausência.
  //
  // Achado por ela em 24/08/2026: um pedido de R$ 21,90 aguardando pagamento,
  // e a tela mostrando "Custo dos produtos R$ 0,00" e "Lucro R$ 0,00". O painel
  // ao lado já dizia a verdade em prosa ("A Amazon ainda não postou repasse
  // deste período"), enquanto os cards afirmavam que não houve custo nem lucro.
  // É o `null ≠ 0` do AGENTS.md: "não cobraram" e "ainda não sei" viravam o
  // mesmo número.
  //
  // ⚠️ NÃO vale quando há repasse postado e o valor É zero. Aí zero é notícia —
  // a promoção de vendedor novo realmente zera comissão e logística, e o
  // `contextoQuandoZero` de cada card explica isso.
  const semRepassePostado = f != null && f.orderCount === 0;

  // Zero tem significado próprio e merece explicação: "não cobraram" é notícia,
  // e o card que só diz "Total do período conciliado" desperdiça a informação.
  const num = (
    v: number | null | undefined,
    contextoQuandoFalta: string,
    tone?: "positive" | "danger",
    contextoQuandoZero?: string
  ): Omit<AmazonCard, "key" | "label"> =>
    v == null || semRepassePostado
      ? { value: "—", context: semRepassePostado ? semExtrato : contextoQuandoFalta, raw: null }
      : {
          value: money(v, currency),
          context: v === 0 && contextoQuandoZero ? contextoQuandoZero : "Total do período conciliado",
          tone,
          raw: v,
        };

  const logistica = somaTipos(f?.feeBreakdown, LOGISTICA_FBA, f != null);
  const anuncios = somaTipos(f?.feeBreakdown, ANUNCIOS, f != null);
  const comissao = somaTipos(f?.feeBreakdown, COMISSAO, f != null);

  // Lucro, margem e ROI só existem se TODO componente de custo existir. Com SKU
  // sem custo cadastrado, o resultado seria otimista — e otimista sem aviso é mentira.
  const resultadoValido = f != null && !custoIncompleto && !semRepassePostado;
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
    // Ocupa a vaga do antigo "Impostos retidos" (`MarketplaceFacilitatorTax`), que
    // é mecanismo de EUA/Europa e nunca apareceu numa conta BR. A comissão, ao
    // contrário, é a maior tarifa da Amazon para quase todo vendedor — e não
    // tinha card nenhum. Hoje sai R$ 0,00 aqui pela promoção de vendedor novo.
    { key: "commission", label: "Comissão", ...num(comissao, "Aguardando comissão no extrato", undefined, "A Amazon não cobrou comissão no período") },
    { key: "refunds", label: "Estornos", ...num(f?.refunds, semExtrato, undefined, "Nenhum estorno no período") },
    {
      key: "tax", label: "Impostos",
      // Diferente dos demais: não é dado que a Amazon manda, é alíquota que a
      // vendedora declara — a Amazon não conhece o regime tributário dela.
      // Configurada, o card mostra o VALOR do período (o que importa no bolso) e
      // a alíquota como contexto.
      ...(input.taxRate == null
        ? { value: "—", context: "Configure a alíquota na calculadora", raw: null }
        : {
            value: money(input.taxes ?? 0, currency),
            context: `${percent(input.taxRate)} sobre o faturamento`,
            raw: input.taxes ?? 0,
          }),
    },
    {
      key: "cogs", label: "Custo dos produtos",
      // Sem período conciliado não há como afirmar custo zero: "não houve venda" e
      // "ainda não sei o que foi vendido" dariam o mesmo R$ 0,00 na tela.
      ...(f == null || custoIncompleto || semRepassePostado
        ? { value: "—", context: semRepassePostado ? semExtrato : faltaCusto }
        : num(input.cogs, faltaCusto)),
    },
    {
      key: "profit", label: "Lucro",
      ...(resultadoValido
        // Sem alíquota o lucro sai SEM imposto — e precisa dizer, senão parece
        // líquido de tudo e a pessoa decide preço com um número otimista.
        ? {
            value: money(input.estimatedProfit, currency),
            context: input.taxRate == null ? "Faturamento − taxas − custo (sem imposto)" : "Faturamento − taxas − custo − imposto",
            tone: input.estimatedProfit > 0 ? "positive" as const : input.estimatedProfit < 0 ? "danger" as const : "default" as const,
            raw: input.estimatedProfit,
          }
        : { value: "—", context: semRepassePostado ? semExtrato : custoIncompleto ? faltaCusto : "Aguardando todos os componentes financeiros", raw: null }),
    },
    {
      key: "marginPct", label: "Margem",
      value: margem == null ? "—" : percent(margem),
      context: margem == null ? (custoIncompleto ? faltaCusto : "Aguardando receita e lucro completos") : "Lucro sobre faturamento",
      tone: margem == null ? "default" : margem > 0 ? "positive" : margem < 0 ? "danger" : "default",
      raw: margem,
    },
    {
      key: "roiPct", label: "ROI",
      value: roi == null ? "—" : percent(roi),
      context: roi == null ? (custoIncompleto ? faltaCusto : "Aguardando lucro e custo completos") : "Lucro sobre o custo investido",
      tone: roi == null ? "default" : roi > 0 ? "positive" : roi < 0 ? "danger" : "default",
      raw: roi,
    },
  ];
}
