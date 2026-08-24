// Pedidos a revisar (TikTok Shop) — o frete que o TikTok DEBITOU do vendedor
// contra o frete que o extrato do próprio pedido DECLARA.
//
// ⚠️ LIÇÃO HERDADA DO MERCADO LIVRE, ANTES DE ESCREVER A PRIMEIRA LINHA.
//
// Em 16/08/2026 a primeira versão da auditoria do ML acusou 8 divergências, TODAS
// falsas, porque comparava um valor bruto contra um líquido. `mercadoLivreAuditoria.ts`
// registra o caso inteiro. A regra que sobrou de lá vale aqui e é o eixo deste
// arquivo: antes de acusar o marketplace de cobrar errado, conferir se os dois lados
// da comparação estão na MESMA BASE. Um alerta financeiro falso custa mais caro que
// alerta nenhum — a pessoa abre reclamação, é negada, e para de confiar na tela.
//
// ────────────────────────────────────────────────────────────────────────────
// AS BASES DO FRETE NO TIKTOK, COM A EVIDÊNCIA DE CADA UMA
// ────────────────────────────────────────────────────────────────────────────
//
// 1. `payment.shipping_fee` (GET /order/202507/orders → canônico `buyerShipping`).
//    OAS oficial: "Buyer paid shipping fee. shipping_fee = original_shipping_fee −
//    shipping_fee_seller_discount − shipping_fee_platform_discount". É o que o
//    COMPRADOR pagou, já líquido dos descontos de frete.
//
// 2. `shipping_cost_amount` (GET /finance/202501/orders/{order_id}/statement_transactions
//    e /finance/202501/statements/{statement_id}/statement_transactions).
//    OAS oficial: "The shipping costs for the order at the time of order settlement",
//    e no nível de SKU: "equivalent to the sum of all contributory amounts in
//    `shipping_cost_breakdown`". Esse breakdown inclui, entre outros,
//    `actual_shipping_fee_amount` (a tarifa real da transportadora),
//    `customer_paid_shipping_fee_amount` ("the actual shipping fee borne by the
//    customer") e `shipping_fee_discount_amount` (subsídios da plataforma).
//
// Ou seja: `shipping_cost_amount` JÁ É O LÍQUIDO — a parte do comprador e os
// subsídios já foram abatidos dentro dele. Subtrair `payment.shipping_fee` de
// `shipping_cost_amount` seria descontar a parcela do comprador DUAS VEZES:
// exatamente o erro do ML, com o sinal invertido. Por isso o frete do comprador
// aparece na tela como contexto e NUNCA entra na subtração — e há teste de
// regressão travando isso.
//
// ────────────────────────────────────────────────────────────────────────────
// O QUE ESTE MÓDULO COMPARA (mesma base dos dois lados)
// ────────────────────────────────────────────────────────────────────────────
//
// O repositório lê `shipping_cost_amount` por DOIS caminhos independentes:
//
//   DECLARADO  extrato POR PEDIDO (`/finance/202501/orders/{id}/statement_transactions`)
//              → `canonicalTiktokFees` grava fee `shipping_seller`
//              → `workspace_channel_order_fees`.
//
//   COBRADO    feed de STATEMENTS (`/finance/202501/statements/{id}/statement_transactions`)
//              → `normalizeTransaction` grava `seller_shipping`
//              → `workspace_financial_transactions`.
//
// É o mesmo campo, com a mesma descrição no OAS, e os dois lados aplicam o mesmo
// `Math.abs()` (o TikTok devolve o custo com sinal negativo; o canônico grava taxa
// como positiva). Mesma base, mesma convenção de sinal — comparável.
//
// Divergir aqui significa que o repasse que fechou no extrato do pedido não é o que
// entrou no demonstrativo de pagamento. É candidato a revisão, não fraude provada:
// pode ser um lançamento posterior ao fechamento do pedido. Por isso a tela se chama
// "pedidos a revisar" e mostra os dois números lado a lado.
//
// ────────────────────────────────────────────────────────────────────────────
// O QUE FICOU POR CONFIRMAR (não há payload real da loja BR para provar)
// ────────────────────────────────────────────────────────────────────────────
//
// - `shipping_cost_breakdown` NÃO é persistido em lugar nenhum hoje (nem a allowlist
//   de `tiktokFinancialLedger.ts` nem `TiktokStatement` em `tiktokCanonical.ts` o
//   guardam). Sem ele não dá para separar a tarifa real da transportadora
//   (`actual_shipping_fee_amount`) da parcela do comprador — e portanto NÃO dá para
//   auditar "o TikTok cobrou frete a mais do que o transporte custou". Enquanto isso,
//   este módulo não estima essa ponta: ela simplesmente não é afirmada.
// - Se um pedido tiver mais de um lançamento liquidado, a soma pode incluir um evento
//   posterior ao fechamento do extrato do pedido. O número de lançamentos vai junto na
//   linha para a vendedora ver isso.
// - Nada disso é preenchido com zero: valor ausente é `null` e o pedido vai para as
//   pendências, com o motivo nomeado.
//
// Módulo puro, sem I/O e sem dependências, para ser testável.

/**
 * Base de medida de um número de frete. Dois números só podem ser subtraídos
 * quando carregam a MESMA base — é a garantia que impede o falso positivo.
 */
export type BaseFrete = "custo_de_frete_do_extrato" | "frete_pago_pelo_comprador";

/** `shipping_cost_amount`: custo de frete do vendedor, já líquido. */
export const BASE_CUSTO_DO_EXTRATO: BaseFrete = "custo_de_frete_do_extrato";

/** `payment.shipping_fee`: o que o comprador pagou. NÃO é comparável com a de cima. */
export const BASE_FRETE_DO_COMPRADOR: BaseFrete = "frete_pago_pelo_comprador";

export const ROTULO_DA_BASE: Record<BaseFrete, string> = {
  custo_de_frete_do_extrato: "custo de frete do extrato (shipping_cost_amount)",
  frete_pago_pelo_comprador: "frete pago pelo comprador (payment.shipping_fee)",
};

/** Um lado da comparação, sempre acompanhado da base que ele mede. */
export interface LadoDoFrete {
  base: BaseFrete;
  /** `null` = não veio. Ausência NUNCA vira zero. */
  valor: number | null;
  currency: string | null;
}

/** Um pedido pronto para auditoria, já lido do banco pela rota. */
export interface PedidoAuditavelTiktok {
  orderId: string;
  ocorridoEm: string | null;
  /** Frete que o extrato do pedido declara. */
  declarado: LadoDoFrete;
  /** Frete que o demonstrativo de pagamento debitou. */
  cobrado: LadoDoFrete;
  /** `raw._sellercore.statementSettled`: o extrato do pedido já fechou. */
  extratoLiquidado: boolean;
  /** Lançamentos liquidados (`NOT is_estimated`, tipo `ORDER`) que somaram `cobrado`. */
  lancamentosLiquidados: number;
  /** Lançamentos ainda estimados do pedido. Contexto; não entram na conta. */
  lancamentosEstimados: number;
  /** `payment.shipping_fee`. Só contexto na tela — jamais subtraído. */
  freteDoComprador: number | null;
  statementId: string | null;
}

export const MOTIVOS_SEM_COMPARACAO = [
  "bases_diferentes",
  "extrato_do_pedido_pendente",
  "frete_ausente_no_extrato",
  "repasse_ainda_nao_liquidado",
  "moedas_diferentes",
] as const;

export type MotivoSemComparacao = (typeof MOTIVOS_SEM_COMPARACAO)[number];

/**
 * Texto do motivo. Diz o que falta, não que o dado é "parcial": a vendedora já
 * sabe o que está pendente, precisa saber o que fazer com isso.
 */
export const MOTIVO_EM_PORTUGUES: Record<MotivoSemComparacao, string> = {
  bases_diferentes: "os dois números medem coisas diferentes",
  extrato_do_pedido_pendente: "o extrato do pedido ainda não fechou",
  frete_ausente_no_extrato: "o extrato fechou sem informar frete",
  repasse_ainda_nao_liquidado: "o repasse ainda não entrou num demonstrativo",
  moedas_diferentes: "extrato e repasse não fecham na mesma moeda",
};

export interface PedidoARevisarTiktok {
  orderId: string;
  ocorridoEm: string | null;
  /** Base efetivamente comparada. Sempre a mesma nos dois lados. */
  base: BaseFrete;
  /** Frete declarado no extrato do pedido. */
  declarado: number;
  /** Frete debitado no demonstrativo de pagamento. */
  cobrado: number;
  /** `cobrado − declarado`. Positivo = debitaram a mais. */
  diferenca: number;
  /** Contexto. Não participa da subtração. */
  freteDoComprador: number | null;
  lancamentosLiquidados: number;
  statementId: string | null;
  currency: string;
}

export interface PendenciaAuditoriaTiktok {
  orderId: string;
  motivo: MotivoSemComparacao;
  /** `null` quando o lado não foi comprovado. Nunca zero por ausência. */
  declarado: number | null;
  cobrado: number | null;
}

export interface ResultadoAuditoriaTiktok {
  /** Base comparada. Existe na resposta para a tela poder nomeá-la. */
  base: BaseFrete;
  /** `null` quando nada foi comparado e nenhuma moeda pôde ser determinada. */
  currency: string | null;
  pedidos: PedidoARevisarTiktok[];
  /** Soma das diferenças positivas. `null` enquanto nada foi comparado. */
  totalAContestar: number | null;
  comparados: number;
  pendencias: PendenciaAuditoriaTiktok[];
  pendenciasPorMotivo: Record<MotivoSemComparacao, number>;
}

/**
 * Tolerância de 1 centavo. Abaixo disso é arredondamento entre as duas leituras,
 * não divergência — e listar centavos afogaria os casos que importam.
 */
export const TOLERANCIA_TIKTOK = 0.01;

const round = (valor: number) => +valor.toFixed(2);

/** A trava: só compara quem mede a mesma coisa. */
export function mesmaBase(esquerda: LadoDoFrete, direita: LadoDoFrete): boolean {
  return esquerda.base === direita.base;
}

function contadorZerado(): Record<MotivoSemComparacao, number> {
  return Object.fromEntries(MOTIVOS_SEM_COMPARACAO.map((motivo) => [motivo, 0])) as Record<
    MotivoSemComparacao,
    number
  >;
}

/** Primeira moeda comprovada entre os pedidos; `null` se nenhum lado trouxe moeda. */
function moedaDeReferencia(
  pedidos: readonly PedidoAuditavelTiktok[],
  preferida?: string | null
): string | null {
  if (preferida) return preferida;
  for (const pedido of pedidos) {
    const moeda = pedido.declarado.currency ?? pedido.cobrado.currency;
    if (moeda) return moeda;
  }
  return null;
}

export function auditarFreteTiktok(
  pedidos: readonly PedidoAuditavelTiktok[],
  input: { currency?: string | null } = {}
): ResultadoAuditoriaTiktok {
  const currency = moedaDeReferencia(pedidos, input.currency);
  const revisar: PedidoARevisarTiktok[] = [];
  const pendencias: PendenciaAuditoriaTiktok[] = [];
  const pendenciasPorMotivo = contadorZerado();
  let comparados = 0;

  const adiar = (pedido: PedidoAuditavelTiktok, motivo: MotivoSemComparacao) => {
    pendenciasPorMotivo[motivo] += 1;
    pendencias.push({
      orderId: pedido.orderId,
      motivo,
      declarado: pedido.declarado.valor,
      cobrado: pedido.cobrado.valor,
    });
  };

  for (const pedido of pedidos) {
    const { declarado, cobrado } = pedido;

    // A garantia vem antes de tudo. Se as bases divergem, o número que sairia
    // daqui seria uma acusação inventada — e é assim que nasce o falso positivo.
    if (!mesmaBase(declarado, cobrado)) {
      adiar(pedido, "bases_diferentes");
      continue;
    }
    if (!pedido.extratoLiquidado) {
      adiar(pedido, "extrato_do_pedido_pendente");
      continue;
    }
    if (declarado.valor == null) {
      adiar(pedido, "frete_ausente_no_extrato");
      continue;
    }
    if (cobrado.valor == null || pedido.lancamentosLiquidados < 1) {
      adiar(pedido, "repasse_ainda_nao_liquidado");
      continue;
    }
    // Moeda diferente entre os lados (ou do resto do período) é outra base
    // disfarçada: 10 de uma moeda não se subtrai de 10 de outra. Moeda ausente
    // também não passa — sem ela não dá para afirmar que fecham na mesma.
    const moedas = [...new Set([declarado.currency, cobrado.currency].filter((v): v is string => !!v))];
    if (moedas.length !== 1 || (currency != null && moedas[0] !== currency)) {
      adiar(pedido, "moedas_diferentes");
      continue;
    }

    comparados += 1;
    const diferenca = round(cobrado.valor - declarado.valor);
    if (Math.abs(diferenca) <= TOLERANCIA_TIKTOK) continue;

    revisar.push({
      orderId: pedido.orderId,
      ocorridoEm: pedido.ocorridoEm,
      base: declarado.base,
      declarado: round(declarado.valor),
      cobrado: round(cobrado.valor),
      diferenca,
      freteDoComprador: pedido.freteDoComprador,
      lancamentosLiquidados: pedido.lancamentosLiquidados,
      statementId: pedido.statementId,
      currency: moedas[0],
    });
  }

  // Maior diferença primeiro: é onde está o dinheiro e por onde se começa.
  revisar.sort((a, b) => b.diferenca - a.diferenca || a.orderId.localeCompare(b.orderId));

  return {
    base: BASE_CUSTO_DO_EXTRATO,
    currency,
    pedidos: revisar,
    // Nada comparado é "não sei", não "está tudo certo": `null`, não zero.
    // Só o que foi debitado A MAIS entra no total; cobrança a menor é a favor
    // dela, aparece na lista e não vira pedido de dinheiro.
    totalAContestar: comparados
      ? round(revisar.filter((p) => p.diferenca > 0).reduce((soma, p) => soma + p.diferenca, 0))
      : null,
    comparados,
    pendencias,
    pendenciasPorMotivo,
  };
}
