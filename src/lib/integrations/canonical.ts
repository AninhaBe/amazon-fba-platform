// Modelo canônico multicanal (ver docs/canonical-schema.md).
// Todo adaptador de canal converge para estes tipos na ingestão; o restante da
// plataforma (lucro, radar, dashboards) nunca vê formatos específicos de canal.

export type CanonicalOrderStatus =
  | "pending"
  | "paid"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

/** Status que contam como receita nos dashboards. */
export const REVENUE_STATUSES: ReadonlySet<CanonicalOrderStatus> = new Set([
  "paid",
  "shipped",
  "delivered",
]);

export type CanonicalFeeType =
  | "commission"
  | "shipping_seller"
  | "fulfillment"
  | "payment"
  | "ads"
  | "taxes_withheld"
  | "refund"
  | "other";

/**
 * OS TIPOS DE TARIFA QUE REDUZEM O RESULTADO — tudo menos `refund`.
 *
 * ⚠️ ESTA CONSTANTE EXISTE PARA MATAR A LISTA NEGRA. Ordem da dona do produto em
 * 12/09/2026, verbatim: *"lista negra nao existe, se esta no nexo com esse termo,
 * pode remover"*. Onze consultas escreviam `fee_type <> 'refund'` ou
 * `NOT IN ('refund','estimated')`; agora escrevem `= ANY(...)` com esta lista.
 *
 * ✅ A TROCA É EQUIVALENTE POR CONSTRUÇÃO, não por medição: o CHECK
 * `channel_order_fees_vocabulario_canonico` (migration 0028) só permite os oito
 * valores de `CanonicalFeeType`. Esta lista é esses oito menos `refund`, então
 * **não existe linha no banco que distinga as duas formas** — nenhum número
 * muda. Foi por isso que ela pôde ser trocada sem janela de medição.
 *
 * 🔴 E `other` FICA AQUI, o que é o ponto mais importante deste comentário.
 * Medido em 12/09/2026: a Amazon tem 452 linhas `other` somando R$ 1.786,73.
 * Uma lista positiva "semântica" (só commission + fulfillment) tiraria esse
 * dinheiro do custo e **inflaria o lucro em R$ 1.786,73 em silêncio**. A
 * migration 0028 já tinha decidido isso por escrito: descartar um fato do
 * extrato é pior que rotulá-lo grosseiramente.
 *
 * ⚠️ A DIREÇÃO DO FAIL-CLOSED AQUI É O INVERSO DA HABITUAL, e quem mexer nisto
 * precisa saber: o argumento normal contra lista negra é que o desconhecido
 * entra por padrão. Como aqui se trata de **dinheiro que reduz o resultado**,
 * deixar o desconhecido entrar é o lado SEGURO — tipo novo esquecido de fora
 * não dá erro, só infla o lucro. Por isso a lista é fechada COM alarme:
 * `tests-integracao/vocabularioDeTarifaNaoCresceSozinho` reprova quando o CHECK
 * do banco ganha um valor que esta lista não tem.
 *
 * 📌 O QUE ELA NÃO COBRE, e quando cresce: só serve para a tabela REAL
 * (`workspace_channel_order_fees`) e para a view efetiva. A tabela de
 * ESTIMATIVAS tem vocabulário mais estreito — a migration 0026 baniu `other`
 * lá de propósito. Cresce quando o CHECK da 0028 crescer, e o teste acima
 * avisa.
 */
export const TIPOS_DE_TARIFA_QUE_CUSTAM: readonly CanonicalFeeType[] = [
  "commission",
  "shipping_seller",
  "fulfillment",
  "payment",
  "ads",
  "taxes_withheld",
  "other",
];

/**
 * A mesma lista, pronta para interpolar em SQL: `'commission', 'shipping_seller', ...`.
 *
 * Interpolar em vez de passar por parâmetro é deliberado — são literais de um
 * tipo fechado, nunca entrada de usuário, e um `$n` a mais em nove consultas
 * renumeraria todos os parâmetros seguintes, que é exatamente o tipo de churn
 * onde nasce defeito silencioso.
 */
export const SQL_TARIFAS_QUE_CUSTAM = TIPOS_DE_TARIFA_QUE_CUSTAM.map((t) => `'${t}'`).join(", ");

export interface CanonicalFee {
  feeType: CanonicalFeeType;
  /** Código original do canal ('sale_fee', 'FBAPerUnitFulfillmentFee', …). */
  providerFeeCode: string;
  /** Positivo = debitado do vendedor; crédito entra negativo. */
  amount: number;
  currency: string;
  /**
   * Quando o marketplace LANCOU esta tarifa, se souber. `null`/ausente = nao
   * capturado — nunca "mesmo dia do pedido". Ver migrations/0029.
   *
   * Importa sobretudo no ESTORNO: medido em 01/09/2026, a data de lancamento
   * fica em MEDIANA 11 dias depois do pedido (minimo 1, maximo 44). Pela data
   * do pedido, o estorno aparece num periodo em que nada aconteceu.
   */
  postedAt?: string | null;
}

export interface CanonicalOrderItem {
  /**
   * Id do produto no canal. Quando o canal tem variacao, vem COMPOSTO
   * (`<anuncio>::sku:<variacao>`) — o mesmo formato do catalogo, senao a juncao
   * catalogo x venda nao fecha. Ver `variantProductId.ts` e ADR-029.
   */
  externalProductId: string;
  /**
   * Identificador da VARIACAO no canal (`model_id` na Shopee, `sku.id` no
   * TikTok). `null` quando o canal nao tem variacao ou quando o pedido antigo
   * nao trouxe o dado. E a chave ESTAVEL: `sku` textual o vendedor renomeia.
   */
  modelId?: string | null;
  /** seller_sku do canal; nunca assumir único entre canais. */
  sku: string | null;
  title: string;
  qty: number;
  /** Líquido de desconto — é dele que saem margem e lucro. */
  /**
   * Preço unitário praticado. `null` = a fonte ainda não expôs — pedido
   * `Pending` na Amazon devolve o item sem `ItemPrice` (migration 0021).
   *
   * ⚠️ Quem soma `qty * unitPrice` tem de EXCLUIR a linha sem preço, nunca
   * coalescer para zero: zero é o fato "não custou nada", e coalescer recria a
   * mentira que a coluna nullable existe para remover.
   */
  unitPrice: number | null;
  /**
   * Preço de tabela por unidade, antes de promoção. `null` = canal não informa.
   * Guardar as parcelas (e não só o líquido) é o que permite responder "usaram
   * cupom?" sem abrir pedido a pedido no painel do marketplace.
   */
  listPrice?: number | null;
  /** Desconto por unidade. `null` = desconhecido; `0` = houve e foi zero. */
  promotionDiscount?: number | null;
  /** Identificador da campanha, quando o canal informa. */
  promotionIds?: string | null;
}

export interface CanonicalOrder {
  externalOrderId: string;
  status: CanonicalOrderStatus;
  providerStatus: string;
  occurredAt: string;
  closedAt: string | null;
  currency: string;
  /** Soma dos itens (unit_price × qty), sem frete do comprador. */
  /**
   * Receita bruta do pedido. `null` = **desconhecido**, não zero (AGENTS.md).
   * A Amazon omite `OrderTotal` enquanto o pedido está `Pending`; gravar 0 ali
   * afirmaria que a venda não teve receita.
   */
  gross: number | null;
  /**
   * Frete pago pelo comprador. null = ainda desconhecido (ex.: custos do
   * shipment não sincronizados) — diferente de 0 (grátis/sem frete).
   */
  buyerShipping: number | null;
  fulfillment: "platform" | "seller" | null;
  packId: string | null;
  items: CanonicalOrderItem[];
  /** Pode chegar parcial; canais como Amazon/TikTok completam depois. */
  fees: CanonicalFee[];
  raw: unknown;
}

export interface CanonicalProduct {
  externalProductId: string;
  sku: string | null;
  title: string;
  status: "active" | "paused" | "closed";
  providerStatus: string;
  price: number;
  currency: string;
  availableQty: number;
  fulfillment: "platform" | "seller" | null;
  thumbnail: string | null;
  permalink: string | null;
  raw: unknown;
}
