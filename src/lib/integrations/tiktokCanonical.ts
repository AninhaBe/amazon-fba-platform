import type {
  CanonicalFee,
  CanonicalFeeType,
  CanonicalOrder,
  CanonicalOrderItem,
  CanonicalOrderStatus,
  CanonicalProduct,
} from "./canonical";

// Mapeamento TikTok Shop → modelo canônico (docs/tiktok-shop-integracao.md).
// Espelha shopeeCanonical.ts: este arquivo é o ÚNICO lugar que conhece o
// formato do TikTok; sync, lucro e dashboards só veem os tipos canônicos.
//
// Escrito contra o OAS oficial (endpoints e versões escolhidos em 07/08):
//   pedidos   GET  /order/202507/orders
//   taxas     GET  /finance/202501/orders/{order_id}/statement_transactions
//   produtos  POST /product/202502/products/search
// Validado contra a loja real Crystal Fancy em 10/08/2026. Status, agrupamento
// por SKU e sinal das taxas observados estão cobertos nos testes do parser.
//
// Três peculiaridades do canal que o mapeamento precisa respeitar:
//
// 1. **Valores monetários vêm como string**, não número. `paraNumero` devolve
//    null quando o campo não veio: desconhecido ≠ zero.
// 2. **`line_items[]` não tem quantidade** — cada linha é UMA unidade. O `qty`
//    canônico sai do agrupamento por `sku_id`.
// 3. **O detalhe do pedido traz PII** (CPF, e-mail, endereço). Nada disso entra
//    no canônico, e o `raw` persistido passa por `sanitizeTiktokOrder`.

/** Item de `line_items[]` — uma unidade vendida, não uma linha agregada. */
export interface TiktokLineItem {
  id?: string;
  product_id?: string;
  product_name?: string;
  sku_id?: string;
  sku_name?: string;
  seller_sku?: string;
  sale_price?: string;
  original_price?: string;
  seller_discount?: string;
  platform_discount?: string;
  currency?: string;
  package_id?: string;
  display_status?: string;
}

/** Bloco `payment` de GET /order/202507/orders. */
export interface TiktokPayment {
  currency?: string;
  sub_total?: string;
  shipping_fee?: string;
  total_amount?: string;
  original_total_product_price?: string;
  seller_discount?: string;
  platform_discount?: string;
  product_tax?: string;
  shipping_fee_tax?: string;
}

export interface TiktokOrder {
  id: string;
  status?: string;
  create_time?: number;
  paid_time?: number;
  delivery_time?: number;
  cancel_time?: number;
  fulfillment_type?: string;
  line_items?: TiktokLineItem[];
  payment?: TiktokPayment;
  packages?: Array<{ id?: string }>;
  [chave: string]: unknown;
}

/** Resposta de GET /finance/202501/orders/{order_id}/statement_transactions. */
export interface TiktokStatement {
  currency?: string;
  revenue_amount?: string;
  fee_and_tax_amount?: string;
  shipping_cost_amount?: string;
  settlement_amount?: string;
  sku_transactions?: Array<{
    product_name?: string;
    quantity?: string;
    revenue_amount?: string;
    fee_tax_amount?: string;
    shipping_cost_amount?: string;
    settlement_amount?: string;
  }>;
  total_count?: number;
  order_create_time?: number;
}

/** Extrato zerado sem transações é placeholder pré-settlement, não tarifa zero. */
export function tiktokStatementSettled(statement: TiktokStatement | null | undefined): boolean {
  if (!statement) return false;
  if ((statement.total_count ?? 0) > 0) return true;
  if ((statement.sku_transactions?.length ?? 0) > 0) return true;
  if ((statement.order_create_time ?? 0) > 0) return true;
  return [
    statement.revenue_amount,
    statement.fee_and_tax_amount,
    statement.shipping_cost_amount,
    statement.settlement_amount,
  ].some((value) => {
    const parsed = paraNumero(value);
    return parsed != null && parsed !== 0;
  });
}

export interface TiktokProduct {
  id?: string;
  title?: string;
  status?: string;
  skus?: Array<{
    id?: string;
    seller_sku?: string;
    price?: { sale_price?: string; tax_exclusive_price?: string; currency?: string };
    inventory?: Array<{ quantity?: number }>;
  }>;
}

export function sanitizeTiktokProduct(product: TiktokProduct): Record<string, unknown> {
  return JSON.parse(JSON.stringify({
    id: product.id,
    title: product.title,
    status: product.status,
    skus: (product.skus ?? []).map((sku) => ({
      id: sku.id,
      seller_sku: sku.seller_sku,
      price: sku.price ? { sale_price: sku.price.sale_price, tax_exclusive_price: sku.price.tax_exclusive_price, currency: sku.price.currency } : undefined,
      inventory: (sku.inventory ?? []).map((entry) => ({ quantity: entry.quantity })),
    })),
  })) as Record<string, unknown>;
}

/**
 * Allowlist exaustiva do que pode entrar em `raw`. Não fazemos sanitização por
 * denylist: campos novos, desconhecidos ou aninhados são descartados por padrão.
 */
export function sanitizeTiktokOrder(order: TiktokOrder): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    id: order.id,
    status: order.status,
    create_time: order.create_time,
    paid_time: order.paid_time,
    delivery_time: order.delivery_time,
    cancel_time: order.cancel_time,
    fulfillment_type: order.fulfillment_type,
  };
  if (order.payment) {
    raw.payment = {
      currency: order.payment.currency,
      sub_total: order.payment.sub_total,
      shipping_fee: order.payment.shipping_fee,
      total_amount: order.payment.total_amount,
      original_total_product_price: order.payment.original_total_product_price,
      seller_discount: order.payment.seller_discount,
      platform_discount: order.payment.platform_discount,
      product_tax: order.payment.product_tax,
      shipping_fee_tax: order.payment.shipping_fee_tax,
    };
  }
  raw.line_items = (order.line_items ?? []).map((item) => ({
    id: item.id,
    product_id: item.product_id,
    product_name: item.product_name,
    sku_id: item.sku_id,
    sku_name: item.sku_name,
    seller_sku: item.seller_sku,
    sale_price: item.sale_price,
    original_price: item.original_price,
    seller_discount: item.seller_discount,
    platform_discount: item.platform_discount,
    currency: item.currency,
    package_id: item.package_id,
    display_status: item.display_status,
  }));
  raw.packages = (order.packages ?? []).map((pkg) => ({ id: pkg.id }));
  return JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
}

function round2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** String monetária do TikTok → número. Ausente/ilegível vira null, não zero. */
function paraNumero(valor: string | number | null | undefined): number | null {
  if (valor == null || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

function deEpoch(segundos: number | null | undefined): string | null {
  if (!segundos) return null;
  return new Date(segundos * 1000).toISOString();
}

// ⚠️ Estes valores vêm da documentação em prosa do Partner Center, NÃO do
// schema OAS — o OAS declara `status` apenas como string, sem enum. Conferir
// contra a primeira resposta real e corrigir aqui.
const MAPA_STATUS: Record<string, CanonicalOrderStatus> = {
  UNPAID: "pending",
  ON_HOLD: "pending",
  AWAITING_SHIPMENT: "paid",
  PARTIALLY_SHIPPING: "shipped",
  AWAITING_COLLECTION: "paid",
  IN_TRANSIT: "shipped",
  DELIVERED: "delivered",
  COMPLETED: "delivered",
  CANCELLED: "cancelled",
};

export const TIKTOK_UNMAPPED_STATUS_CODE = "TIKTOK_STATUS_NAO_MAPEADO";

/**
 * Status que a API devolveu e o mapa não conhece. Carrega o valor cru e a
 * contagem porque mensagem genérica é o mesmo que silêncio: sem o nome do
 * status ninguém sabe o que acrescentar ao `MAPA_STATUS`, e a sincronização
 * fica parada repetindo "falha temporária".
 */
export class TiktokUnmappedStatusError extends RangeError {
  readonly code = TIKTOK_UNMAPPED_STATUS_CODE;
  readonly observed: Array<{ status: string; orders: number }>;
  constructor(observed: Array<{ status: string; orders?: number }>) {
    const normalizado = observed.map(({ status, orders }) => ({ status, orders: orders ?? 1 }));
    super(`${TIKTOK_UNMAPPED_STATUS_CODE}: status de pedido TikTok ainda não mapeado: ${formatUnmappedStatuses(normalizado)}. Conhecidos: ${tiktokMappedStatuses().join(", ")}.`);
    this.name = "TiktokUnmappedStatusError";
    this.observed = normalizado;
  }
}

/**
 * A mensagem do erro é o ÚNICO canal até a tela: ela é persistida em
 * `workspace_marketplace_syncs.last_error` e o banco não ganha coluna nesta
 * rodada (ADR-001). Formatação e leitura moram juntas de propósito — se uma
 * mudar sem a outra, a tela volta a mostrar erro genérico. Travado por teste
 * de ida e volta.
 */
export function formatUnmappedStatuses(observed: Array<{ status: string; orders: number }>): string {
  return observed.map(({ status, orders }) => `${status || "(vazio)"} [${orders}]`).join(", ");
}

/** Statuses de volta a partir do `last_error`; `[]` quando a mensagem é outra. */
export function parseUnmappedStatuses(message: string): Array<{ status: string; orders: number }> {
  const inicio = message.indexOf(UNMAPPED_STATUS_PREFIX);
  if (inicio < 0) return [];
  const trecho = message.slice(inicio + UNMAPPED_STATUS_PREFIX.length);
  const fim = trecho.indexOf(". Conhecidos:");
  return (fim < 0 ? trecho : trecho.slice(0, fim))
    .split(", ")
    .map((parte) => /^(.*) \[(\d+)\]$/.exec(parte.trim()))
    .filter((match): match is RegExpExecArray => match != null)
    .map((match) => ({ status: match[1] === "(vazio)" ? "" : match[1], orders: Number(match[2]) }));
}

const UNMAPPED_STATUS_PREFIX = "status de pedido TikTok ainda não mapeado: ";

/** Status conhecidos, em ordem estável — para diagnóstico e mensagem de erro. */
export function tiktokMappedStatuses(): string[] {
  return Object.keys(MAPA_STATUS);
}

/** Mapeamento sem exceção: `null` quando o status não está no mapa. */
export function tiktokStatusIfMapped(providerStatus: string): CanonicalOrderStatus | null {
  return MAPA_STATUS[providerStatus] ?? null;
}

export function canonicalTiktokStatus(providerStatus: string): CanonicalOrderStatus {
  const status = tiktokStatusIfMapped(providerStatus);
  if (!status) throw new TiktokUnmappedStatusError([{ status: providerStatus }]);
  return status;
}

/**
 * Status não mapeados de um lote, cada um com quantos pedidos o trouxeram.
 * O sync usa isto para falhar UMA vez dizendo exatamente o que apareceu, em vez
 * de estourar no primeiro pedido e esconder os demais.
 */
export function tiktokUnmappedOrderStatuses(orders: TiktokOrder[]): Array<{ status: string; orders: number }> {
  const contagem = new Map<string, number>();
  for (const order of orders) {
    const status = order.status ?? "";
    if (tiktokStatusIfMapped(status)) continue;
    contagem.set(status, (contagem.get(status) ?? 0) + 1);
  }
  return [...contagem].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([status, orders]) => ({ status, orders }));
}

/** Recusa payload incompleto antes da persistência canônica. */
export function validateTiktokOrderForSync(order: TiktokOrder): void {
  if (!String(order.id ?? "").trim()) {
    throw new TypeError("Pedido TikTok sem identificador.");
  }
  if (!order.create_time || !Number.isFinite(order.create_time)) {
    throw new TypeError(`Pedido TikTok ${order.id} sem data de criação válida.`);
  }
  canonicalTiktokStatus(order.status ?? "");
}

/**
 * Desconto POR UNIDADE **já abatido** do preço cobrado — ou `null` quando o
 * payload não prova que foi abatido.
 *
 * O TikTok manda `original_price`, `seller_discount` e `platform_discount` ao
 * lado de `sale_price`, e a documentação diz que `sale_price` já é líquido dos
 * dois. Nenhuma amostra real com cupom foi observada até 23/08/2026 — o que
 * existe é prosa, não payload. Em vez de confiar na prosa, cada linha só
 * entrega o desconto quando ELA MESMA reconcilia ao centavo:
 *
 *     original_price − seller_discount − platform_discount = sale_price
 *
 * Faltou campo, veio desconto negativo ou não reconciliou = **desconhecido**.
 * É essa reconciliação que impede o cupom de virar dedução em cima de uma
 * receita que já está líquida: descontar duas vezes é pior do que não mostrar a
 * cascata. E, provado o abatimento, o desconto entra apenas como `listPrice` /
 * `promotionDiscount` (informativo, `docs/canonical-schema.md`) — nunca como
 * `CanonicalFee`, que subtrairia do lucro uma segunda vez.
 */
function descontoDaLinha(linha: TiktokLineItem, unitPrice: number): number | null {
  const precoDeTabela = paraNumero(linha.original_price);
  const vendedor = paraNumero(linha.seller_discount);
  const plataforma = paraNumero(linha.platform_discount);
  if (precoDeTabela == null || vendedor == null || plataforma == null) return null;
  const desconto = round2(vendedor + plataforma);
  if (desconto < 0) return null;
  if (round2(precoDeTabela - desconto) !== round2(unitPrice)) return null;
  return desconto;
}

/**
 * Agrupa `line_items[]` por SKU para produzir itens canônicos com quantidade.
 * O TikTok emite uma linha por unidade; somar sem agrupar geraria N itens de
 * quantidade 1 e quebraria a leitura de "unidades vendidas por SKU".
 */
export function agruparItens(linhas: TiktokLineItem[]): CanonicalOrderItem[] {
  const porSku = new Map<string, CanonicalOrderItem>();
  // Desconto acumulado do grupo. `null` = alguma linha não provou o abatimento;
  // somar só as linhas provadas afirmaria um cupom menor do que o concedido.
  const descontoPorSku = new Map<string, number | null>();

  for (const linha of linhas) {
    const parentProductId = String(linha.product_id ?? "");
    const skuId = String(linha.sku_id ?? "").trim();
    const externalProductId = skuId ? tiktokVariantProductId(parentProductId, skuId) : parentProductId;
    // A chave é sku_id (identificador do canal); seller_sku é o código do
    // vendedor e é o que casa com o custo cadastrado.
    const chave = `${externalProductId}::${linha.sku_id ?? ""}`;
    const unitPrice = paraNumero(linha.sale_price) ?? paraNumero(linha.original_price);
    if (unitPrice == null) {
      throw new TypeError(`Item TikTok ${skuId || parentProductId || "(sem id)"} sem preço comprovável.`);
    }

    const desconto = descontoDaLinha(linha, unitPrice);
    const existente = porSku.get(chave);
    if (existente) {
      existente.qty += 1;
      const acumulado = descontoPorSku.get(chave);
      descontoPorSku.set(chave, acumulado == null || desconto == null ? null : round2(acumulado + desconto));
      continue;
    }
    descontoPorSku.set(chave, desconto);
    porSku.set(chave, {
      externalProductId,
      sku: linha.seller_sku || linha.sku_id || null,
      title: [linha.product_name, linha.sku_name].filter(Boolean).join(" - ")
        || externalProductId,
      qty: 1,
      unitPrice,
      // `null` = o canal não provou o desconto (AGENTS.md: desconhecido ≠ zero).
      listPrice: null,
      promotionDiscount: null,
    });
  }

  for (const [chave, item] of porSku) {
    const acumulado = descontoPorSku.get(chave);
    if (acumulado == null) continue;
    // Por unidade, como na Amazon (`amazonCanonical.ts`): o canônico guarda a
    // parcela unitária e a quantidade separadas.
    item.promotionDiscount = round2(acumulado / item.qty);
    item.listPrice = round2(item.unitPrice + item.promotionDiscount);
  }

  return [...porSku.values()];
}

/** Todo valor monetário deste endpoint termina em `_amount`. */
const CAMPO_MONETARIO = /_amount$/;
/** Receita e resultado do pedido — não são custo, nunca foram tarifa. */
const CAMPO_NAO_TARIFA = /^(revenue|settlement)_amount$/;
/**
 * Os dois únicos campos comprovados por payload real (pedido
 * 583985901599294689). São o **agregado conhecido**: sempre entram, e é para
 * eles que a conta recua quando a decomposição não se prova.
 */
const CAMPOS_OBSERVADOS: Partial<Record<string, CanonicalFeeType>> = {
  fee_and_tax_amount: "commission",
  shipping_cost_amount: "shipping_seller",
};
/**
 * ⚠️ Nenhum padrão para `ads`, `taxes_withheld` ou `refund` — de propósito.
 * O extrato do TikTok não discrimina essas categorias e adivinhar pelo nome
 * seria inventar um fato (`docs/tiktok-shop-integracao.md`).
 */
const PADROES_TAXA: Array<{ padrao: RegExp; tipo: CanonicalFeeType }> = [
  { padrao: /shipping|logistic|delivery|freight/i, tipo: "shipping_seller" },
  { padrao: /fulfil|warehous|storage/i, tipo: "fulfillment" },
  { padrao: /commission|referral|fee/i, tipo: "commission" },
];
/** Ordem estável de saída — a linha gravada não pode depender da ordem das chaves do JSON. */
const ORDEM_TIPO: CanonicalFeeType[] = [
  "commission", "payment", "fulfillment", "shipping_seller", "ads", "taxes_withheld", "refund", "other",
];

/**
 * Em que categoria o campo cairia **se** fosse contado. `null` = não é tarifa.
 * Responder isto NÃO decide se o valor entra no total — quem decide é a
 * reconciliação com `settlement_amount`, em `tiktokFeeDecomposition`.
 */
export function classifyTiktokFeeField(campo: string): CanonicalFeeType | null {
  if (!CAMPO_MONETARIO.test(campo) || CAMPO_NAO_TARIFA.test(campo)) return null;
  return CAMPOS_OBSERVADOS[campo]
    ?? PADROES_TAXA.find(({ padrao }) => padrao.test(campo))?.tipo
    ?? "other";
}

/** Por que um campo monetário do extrato ficou de fora do total. */
export type TiktokFeePendencyReason = "sem_settlement" | "nao_reconcilia";

/** Campo que apareceu no extrato e NÃO entrou nas taxas, com nome e valor crus. */
export interface TiktokFeePendency {
  field: string;
  /** Valor como a TikTok mandou (sinal dela), não o canônico. */
  amount: number;
  reason: TiktokFeePendencyReason;
}

export interface TiktokFeeDecomposition {
  fees: CanonicalFee[];
  /**
   * Campos monetários que a TikTok passou a devolver e que a aritmética não
   * comprovou. Não somam, não somem: carregam nome e valor crus para que o
   * mapeamento novo seja uma decisão de alguém, e não um silêncio — mesma
   * disciplina de `tiktokUnmappedOrderStatuses`.
   */
  pending: TiktokFeePendency[];
  /** `true` = a soma assinada fecha com `settlement_amount` ao centavo. */
  reconciled: boolean;
}

interface CampoMonetario { field: string; tipo: CanonicalFeeType; valor: number }

/**
 * Extrato do pedido → taxas canônicas, com a aritmética do próprio pedido
 * decidindo no que dá para confiar.
 *
 * A categorização é por **padrão**, não por lista de nomes exatos: um
 * `platform_service_fee_amount` novo cai em `commission` em vez de virar
 * R$ 0,00 numa conta que paga. Mas categorizar bem não basta aqui, e é onde o
 * TikTok difere da Amazon: lá `fees` é um total independente e o breakdown só
 * o reparte — categorizar errado move dinheiro de card, não muda o total. Aqui
 * **não existe total independente**: as taxas SÃO a soma destes campos. Somar
 * um campo desconhecido não é miscategorizar, é mexer no dinheiro.
 *
 * Daí a trava: o `settlement_amount` do próprio pedido é a conferência.
 * A identidade observada é
 *
 *     revenue_amount + Σ(componentes assinados) = settlement_amount
 *     23,90 + (−9,13) + 0 = 14,77
 *
 * - **Fecha ao centavo** ⇒ a decomposição está provada *neste pedido*: todos os
 *   campos entram, e o sinal sai da própria identidade (`−valor`), de modo que
 *   um crédito — subsídio de frete, bônus — permanece crédito em vez de virar
 *   custo.
 * - **Não fecha** (ou não veio `settlement_amount`) ⇒ a decomposição não está
 *   provada. Vale só o agregado conhecido (`CAMPOS_OBSERVADOS`), e cada campo
 *   novo vira pendência **nomeada** em `pending`. É isso que impede o caso do
 *   `fee_per_item_sold_amount`: componente do `fee_and_tax_amount` que subisse
 *   ao nível de cima somaria em cima do próprio pai — e a soma deixaria de
 *   fechar com o settlement, que é exatamente como este código percebe.
 *
 * Não confundir com o item B4 (provar a identidade na amostra inteira, adiado):
 * aqui é só usar, num pedido, um campo que já está no payload dele.
 */
export function tiktokFeeDecomposition(extrato: TiktokStatement, currency: string): TiktokFeeDecomposition {
  const campos: CampoMonetario[] = [];
  for (const [field, bruto] of Object.entries(extrato as Record<string, unknown>)) {
    // Só escalar: `sku_transactions[]` e qualquer bloco aninhado são detalhe.
    if (typeof bruto !== "string" && typeof bruto !== "number") continue;
    const tipo = classifyTiktokFeeField(field);
    if (tipo == null) continue;
    const valor = paraNumero(bruto);
    // null = não veio (desconhecido) → não grava linha. Zero é um fato conhecido
    // e entra para não ser confundido com uma tarifa ainda indisponível.
    if (valor == null) continue;
    campos.push({ field, tipo, valor });
  }

  const novos = campos.filter((campo) => CAMPOS_OBSERVADOS[campo.field] == null);
  const revenue = paraNumero(extrato.revenue_amount);
  const settlement = paraNumero(extrato.settlement_amount);
  const reconciled = revenue != null && settlement != null
    && round2(campos.reduce((total, campo) => total + campo.valor, revenue)) === round2(settlement);

  const contadas = reconciled || !novos.length
    ? campos
    : campos.filter((campo) => CAMPOS_OBSERVADOS[campo.field] != null);
  const fees = contadas.map(({ field, tipo, valor }) => ({
    feeType: tipo,
    providerFeeCode: field,
    // ⚠️ O TikTok devolve o que ELE cobra com sinal NEGATIVO — confirmado no
    // extrato real do pedido 583985901599294689 (`fee_and_tax_amount: "-9.13"`
    // sobre `revenue_amount: "23.9"`, fechando em `settlement_amount: "14.77"`).
    // O canônico grava taxa como POSITIVA (positivo = debitado do vendedor).
    //
    // Provada a identidade, o sinal vem dela (`−valor`) e crédito continua
    // crédito. Sem prova, `Math.abs` mantém o comportamento conservador de
    // sempre: errar para o lado do custo deprime o lucro; errar para o outro
    // inventa lucro que não existe.
    amount: reconciled ? semZeroNegativo(round2(-valor)) : round2(Math.abs(valor)),
    currency,
  }));

  return {
    fees: fees.sort((esquerda, direita) =>
      ORDEM_TIPO.indexOf(esquerda.feeType) - ORDEM_TIPO.indexOf(direita.feeType)
      || esquerda.providerFeeCode.localeCompare(direita.providerFeeCode)),
    pending: reconciled ? [] : novos.map(({ field, valor }) => ({
      field,
      amount: valor,
      reason: revenue == null || settlement == null ? "sem_settlement" as const : "nao_reconcilia" as const,
    })),
    reconciled,
  };
}

/** `-0` é o mesmo número que `0` e um ruído a menos na tela e nos testes. */
function semZeroNegativo(valor: number): number {
  return valor === 0 ? 0 : valor;
}

export function canonicalTiktokFees(extrato: TiktokStatement, currency: string): CanonicalFee[] {
  return tiktokFeeDecomposition(extrato, currency).fees;
}

export interface NormalizeTiktokOrderOptions {
  /**
   * Extrato financeiro do pedido. undefined/null = ainda indisponível (o
   * TikTok só fecha depois do settlement) → o pedido entra sem tarifa e o
   * dashboard o marca como incompleto, em vez de assumir tarifa zero.
   */
  statement?: TiktokStatement | null;
}

export function normalizeTiktokOrder(
  order: TiktokOrder,
  { statement }: NormalizeTiktokOrderOptions = {}
): CanonicalOrder {
  validateTiktokOrderForSync(order);
  const currency = order.payment?.currency
    ?? order.line_items?.[0]?.currency
    ?? statement?.currency
    ?? "BRL";

  const items = agruparItens(order.line_items ?? []);
  const itemGross = items.length
    ? items.reduce((soma, item) => soma + item.unitPrice * item.qty, 0)
    : null;
  const paymentGross = paraNumero(order.payment?.sub_total);
  const grossSource = itemGross ?? paymentGross;
  if (grossSource == null) {
    throw new TypeError(`Pedido TikTok ${order.id} sem itens ou subtotal confiável.`);
  }
  const gross = round2(grossSource);
  const providerStatus = order.status ?? "";

  return {
    externalOrderId: String(order.id),
    status: canonicalTiktokStatus(providerStatus),
    providerStatus,
    occurredAt: deEpoch(order.create_time)!,
    closedAt: providerStatus === "COMPLETED"
      ? deEpoch(order.delivery_time)
      : providerStatus === "CANCELLED"
      ? deEpoch(order.cancel_time)
      : null,
    currency,
    gross,
    // Frete pago pelo comprador. Ausente = desconhecido (null), nunca zero.
    buyerShipping: paraNumero(order.payment?.shipping_fee),
    // `fulfillment_type` distingue quem envia; sem resposta real para conferir
    // os valores possíveis, não arriscamos classificar errado.
    fulfillment: null,
    packId: order.packages?.[0]?.id ?? null,
    items,
    fees: statement ? canonicalTiktokFees(statement, currency) : [],
    raw: sanitizeTiktokOrder(order),
  };
}

const MAPA_STATUS_PRODUTO: Record<string, CanonicalProduct["status"]> = {
  ACTIVATE: "active",
  DRAFT: "paused",
  PENDING: "paused",
  FAILED: "paused",
  SELLER_DEACTIVATED: "paused",
  PLATFORM_DEACTIVATED: "paused",
  FREEZE: "paused",
  DELETED: "closed",
};

export function canonicalTiktokProductStatus(providerStatus: string): CanonicalProduct["status"] {
  const status = MAPA_STATUS_PRODUTO[providerStatus];
  if (!status) {
    throw new RangeError(`Status de produto TikTok ainda não mapeado: ${providerStatus || "(vazio)"}.`);
  }
  return status;
}

export function tiktokVariantProductId(productId: string, skuId: string): string {
  return `${productId}::sku:${skuId}`;
}

/**
 * Uma oferta canônica por variação. A PK do catálogo é
 * `external_product_id`, portanto usar apenas o product_id faria uma variação
 * sobrescrever a outra (ou, pior, associaria o estoque agregado ao primeiro
 * SKU). O identificador composto é determinístico e o product_id pai continua
 * preservado no raw sanitizado.
 */
export function normalizeTiktokProducts(product: TiktokProduct): CanonicalProduct[] {
  const productId = String(product.id ?? "").trim();
  if (!productId) throw new TypeError("Produto TikTok sem identificador.");
  const providerStatus = product.status ?? "UNKNOWN";
  const raw = sanitizeTiktokProduct(product);
  const skus = product.skus ?? [];
  if (!skus.length) {
    throw new TypeError(`Produto TikTok ${productId} sem variações; preço e estoque não podem ser inferidos.`);
  }
  return skus.map((sku, index) => {
    const skuId = String(sku.id ?? "").trim();
    if (!skuId) throw new TypeError(`Produto TikTok ${productId} possui variação sem identificador.`);
    // product/search 202502 respondeu `tax_exclusive_price` na loja BR real.
    const price = paraNumero(sku.price?.sale_price) ?? paraNumero(sku.price?.tax_exclusive_price);
    if (price == null) throw new TypeError(`Variação TikTok ${skuId} sem preço conhecido.`);
    if (!sku.inventory?.length || sku.inventory.some((item) => !Number.isFinite(item.quantity))) {
      throw new TypeError(`Variação TikTok ${skuId} sem estoque conhecido.`);
    }
    const availableQty = sku.inventory.reduce((total, item) => total + item.quantity!, 0);
    return {
      externalProductId: tiktokVariantProductId(productId, skuId),
      sku: sku.seller_sku || skuId,
      title: skus.length > 1 ? `${product.title ?? productId} · ${sku.seller_sku || `Variação ${index + 1}`}` : (product.title ?? productId),
      status: canonicalTiktokProductStatus(providerStatus), providerStatus,
      price,
      currency: sku.price?.currency ?? "BRL",
      availableQty, fulfillment: null, thumbnail: null, permalink: null, raw,
    };
  });
}

/** Compatibilidade para consumidores antigos; somente produtos mono-SKU. */
export function normalizeTiktokProduct(product: TiktokProduct): CanonicalProduct {
  const normalized = normalizeTiktokProducts(product);
  if (normalized.length !== 1) {
    throw new TypeError(`Produto TikTok ${product.id ?? ""} possui múltiplas variações; use normalizeTiktokProducts.`);
  }
  return normalized[0];
}
