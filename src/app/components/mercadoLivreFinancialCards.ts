// Cards financeiros do Mercado Livre — mesmo padrão da Amazon
// (`src/app/amazon/amazonFinancialCards.ts`) e do TikTok: componente sem dado
// NÃO vira zero, e cada card diz exatamente o que está faltando.
//
// Adaptado às métricas do ML, não copiado: não existe Logística FBA nem comissão
// da Amazon aqui; em compensação o ML tem frete pago pelo vendedor, canceladas e
// a distinção entre faturamento bruto (que o painel deles mostra, com
// canceladas) e receita aprovada.
//
// Módulo puro, sem dependências, para ser testável.

export interface MercadoLivreCardsInput {
  currency: string;
  /** "Vendas brutas" do painel do ML: aprovadas + canceladas, sem frete. */
  revenue30d: number;
  approvedRevenue: number;
  cancelledRevenue: number;
  cancelledOrders: number;
  paidOrders: number;
  fees: number;
  cogs: number;
  sellerShipping: number;
  buyerShipping: number;
  /** `null` quando a alíquota não foi configurada — nunca zero por omissão. */
  taxes: number | null;
  taxRate: number | null;
  estimatedProfit: number;
  marginPct: number;
  /** Unidades vendidas sem custo cadastrado: invalida COGS, lucro, margem e ROI. */
  unitsWithoutCost: number;
  /** `false` quando nem todo frete do período foi capturado. */
  shippingCostsComplete: boolean;
}

export interface MercadoLivreCard {
  key: string;
  label: string;
  value: string;
  context: string;
  tone?: "positive" | "default";
  raw?: number | null;
}

const money = (v: number, currency: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);
const percent = (v: number) =>
  `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

export function mercadoLivreFinancialCards(input: MercadoLivreCardsInput): MercadoLivreCard[] {
  const { currency } = input;
  const custoIncompleto = input.unitsWithoutCost > 0;
  const faltaCusto = `Aguardando custo de ${input.unitsWithoutCost} unidade(s)`;

  // Lucro, margem e ROI só existem se TODO componente de custo existir. Com SKU
  // sem custo cadastrado o resultado seria otimista — e otimista sem aviso é
  // mentira.
  const resultadoValido = !custoIncompleto;
  const roi = resultadoValido && input.cogs > 0 ? (input.estimatedProfit / input.cogs) * 100 : null;

  const num = (v: number, contextoQuandoZero?: string, tone?: "positive"): Omit<MercadoLivreCard, "key" | "label"> => ({
    value: money(v, currency),
    context: v === 0 && contextoQuandoZero ? contextoQuandoZero : "Total do período",
    tone,
    raw: v,
  });

  const bloqueado = (contexto: string): Omit<MercadoLivreCard, "key" | "label"> => ({
    value: "—",
    context: contexto,
    raw: null,
  });

  return [
    {
      key: "revenue", label: "Faturamento",
      ...num(input.revenue30d),
      context: input.cancelledOrders > 0
        ? `${input.paidOrders} aprovadas + ${input.cancelledOrders} canceladas`
        : `${input.paidOrders} vendas aprovadas`,
    },
    { key: "approved", label: "Aprovadas", ...num(input.approvedRevenue, "Nenhuma venda aprovada no período") },
    {
      key: "cancelled", label: "Canceladas",
      ...num(input.cancelledRevenue, "Nenhum cancelamento no período"),
      context: input.cancelledRevenue === 0
        ? "Nenhum cancelamento no período"
        : `${input.cancelledOrders} pedido(s) cancelado(s)`,
    },
    { key: "fees", label: "Tarifa de venda", ...num(input.fees, "Nenhuma tarifa cobrada no período") },
    {
      key: "sellerShipping", label: "Frete do vendedor",
      // Frete incompleto não pode virar total: a pessoa decidiria preço com um
      // custo menor que o real.
      ...(input.shippingCostsComplete
        ? num(input.sellerShipping, "Nenhum frete assumido no período")
        : bloqueado("Aguardando o custo de frete de todos os envios")),
    },
    { key: "buyerShipping", label: "Frete do comprador", ...num(input.buyerShipping, "Nenhum frete pago pelo comprador") },
    {
      key: "tax", label: "Impostos",
      // Não é dado que o ML manda: é alíquota que a vendedora declara.
      ...(input.taxRate == null || input.taxes == null
        ? bloqueado("Configure a alíquota na calculadora")
        : { ...num(input.taxes), context: `${percent(input.taxRate)} sobre o faturamento` }),
    },
    {
      key: "cogs", label: "Custo dos produtos",
      ...(custoIncompleto ? bloqueado(faltaCusto) : num(input.cogs, "Nenhum custo lançado no período")),
    },
    {
      key: "profit", label: "Lucro",
      ...(resultadoValido
        ? {
            value: money(input.estimatedProfit, currency),
            // Sem alíquota o lucro sai SEM imposto — e precisa dizer, senão
            // parece líquido de tudo.
            context: input.taxRate == null
              ? "Receita − tarifas − frete − custo (sem imposto)"
              : "Receita − tarifas − frete − custo − imposto",
            tone: "positive" as const,
            raw: input.estimatedProfit,
          }
        : bloqueado(faltaCusto)),
    },
    {
      key: "marginPct", label: "Margem",
      value: resultadoValido ? percent(input.marginPct) : "—",
      context: resultadoValido ? "Lucro sobre a receita processada" : faltaCusto,
    },
    {
      key: "roiPct", label: "ROI",
      value: roi == null ? "—" : percent(roi),
      context: roi == null ? (custoIncompleto ? faltaCusto : "Aguardando custo dos produtos") : "Lucro sobre o custo investido",
    },
    {
      key: "ticket", label: "Ticket médio",
      // Das APROVADAS: `revenue30d` inclui canceladas e dividir por `paidOrders`
      // inflava o número (corrigido em 15/08/2026).
      ...(input.paidOrders > 0
        ? num(input.approvedRevenue / input.paidOrders)
        : bloqueado("Nenhuma venda aprovada no período")),
      context: input.paidOrders > 0 ? "Por venda aprovada" : "Nenhuma venda aprovada no período",
    },
  ];
}
