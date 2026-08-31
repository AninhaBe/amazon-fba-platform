import type {
  CanonicalFee,
  CanonicalFeeType,
  CanonicalOrder,
  CanonicalOrderStatus,
  CanonicalProduct,
} from "./canonical";
import { tituloDaVariacao, variantProductId } from "./variantProductId";

// Normalização Shopee → canônico (docs/canonical-schema.md).
//
// Funções puras, sem rede: o sync entrega o que já buscou (detalhe do pedido +
// escrow) e aqui só se traduz. Toda a incerteza de mapeamento de campo mora
// NESTE arquivo — quando a primeira loja real conectar e algum nome divergir,
// o ajuste é aqui, não espalhado pelo sync.
//
// Campos conferidos na documentação oficial em 05/08/2026
// (v2.order.get_order_detail e v2.payment.get_escrow_detail).

export interface ShopeeOrderItem {
  item_id?: number;
  model_id?: number;
  item_sku?: string | null;
  model_sku?: string | null;
  item_name?: string;
  model_name?: string | null;
  model_quantity_purchased?: number;
  model_original_price?: number;
  model_discounted_price?: number;
}

export interface ShopeeOrderDetail {
  order_sn: string;
  order_status: string;
  create_time: number;
  update_time?: number;
  pay_time?: number | null;
  currency?: string;
  cod?: boolean;
  region?: string;
  total_amount?: number;
  actual_shipping_fee?: number | null;
  estimated_shipping_fee?: number | null;
  reverse_shipping_fee?: number | null;
  item_list?: ShopeeOrderItem[];
  package_list?: Array<{ shipping_carrier?: string; logistics_status?: string }>;
  fulfillment_flag?: string;
  /** [BR] Status da NF-e no detalhe do pedido (`pending` | `valid`); o motivo
   * só vem em pronto-para-enviar com nota pendente. */
  invoice_data?: { status?: string; pending_reason?: string } | null;
}

/** Bloco `order_income` de v2.payment.get_escrow_detail. */
export interface ShopeeEscrowIncome {
  escrow_amount?: number;
  buyer_total_amount?: number;
  original_price?: number;
  seller_discount?: number;
  voucher_from_seller?: number;
  buyer_paid_shipping_fee?: number;
  actual_shipping_fee?: number;
  reverse_shipping_fee?: number;
  commission_fee?: number;
  service_fee?: number;
  seller_transaction_fee?: number;
  campaign_fee?: number;
  order_ams_commission_fee?: number;
  escrow_tax?: number;
  seller_return_refund?: number;
  final_escrow_product_gst?: number;
}

export interface ShopeeEscrowDetail {
  order_sn: string;
  order_income?: ShopeeEscrowIncome;
}

export interface ShopeeProductItem {
  item_id: number;
  item_sku?: string | null;
  item_name?: string;
  item_status?: string;
  currency?: string;
  stock_info_v2?: { summary_info?: { total_available_stock?: number } };
  price_info?: Array<{ current_price?: number; original_price?: number; currency?: string }>;
  image?: { image_url_list?: string[] };
  has_model?: boolean;
}

/**
 * Allowlist do payload Shopee persistido no canônico. Endereço, comprador,
 * telefone e documentos fiscais nunca entram em `raw`, mesmo que a API passe
 * a devolvê-los por padrão em algum endpoint.
 */
export function sanitizeShopeeOrder(order: ShopeeOrderDetail): Record<string, unknown> {
  return JSON.parse(JSON.stringify({
    order_sn: order.order_sn,
    order_status: order.order_status,
    create_time: order.create_time,
    update_time: order.update_time,
    pay_time: order.pay_time,
    currency: order.currency,
    cod: order.cod,
    region: order.region,
    total_amount: order.total_amount,
    actual_shipping_fee: order.actual_shipping_fee,
    estimated_shipping_fee: order.estimated_shipping_fee,
    reverse_shipping_fee: order.reverse_shipping_fee,
    fulfillment_flag: order.fulfillment_flag,
    item_list: (order.item_list ?? []).map((item) => ({
      item_id: item.item_id,
      model_id: item.model_id,
      item_sku: item.item_sku,
      model_sku: item.model_sku,
      item_name: item.item_name,
      model_name: item.model_name,
      model_quantity_purchased: item.model_quantity_purchased,
      model_original_price: item.model_original_price,
      model_discounted_price: item.model_discounted_price,
    })),
    package_list: (order.package_list ?? []).map((pkg) => ({
      shipping_carrier: pkg.shipping_carrier,
      logistics_status: pkg.logistics_status,
    })),
    // NF-e: SÓ status + motivo — metadado operacional do canal, não documento
    // fiscal nem dado de comprador (a regra do allowlist continua valendo).
    // ⚠️ RETENÇÃO (condição registrada pelo cérebro em 28/08/2026): o dashboard
    // lê estes campos de `raw`. Quando o expurgo de payload do ADR-026/R2-b for
    // desenhado, eles precisam (a) ficar fora do expurgo enquanto o pedido
    // estiver com nota pendente, ou (b) migrar para coluna nesse dia.
    invoice_data: order.invoice_data == null ? undefined : {
      status: order.invoice_data.status,
      pending_reason: order.invoice_data.pending_reason,
    },
  })) as Record<string, unknown>;
}

export function sanitizeShopeeProduct(product: ShopeeProductItem): Record<string, unknown> {
  return JSON.parse(JSON.stringify({
    item_id: product.item_id,
    item_sku: product.item_sku,
    item_name: product.item_name,
    item_status: product.item_status,
    currency: product.currency,
    stock_info_v2: product.stock_info_v2 ? {
      summary_info: product.stock_info_v2.summary_info ? {
        total_available_stock: product.stock_info_v2.summary_info.total_available_stock,
      } : undefined,
    } : undefined,
    price_info: (product.price_info ?? []).map((price) => ({
      current_price: price.current_price,
      original_price: price.original_price,
      currency: price.currency,
    })),
    image: product.image ? { image_url_list: product.image.image_url_list } : undefined,
    has_model: product.has_model,
  })) as Record<string, unknown>;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** epoch em segundos → ISO. */
function fromEpoch(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString();
}

// Status v2 da Shopee → canônico. INVOICE_PENDING é peculiaridade do Brasil:
// o pedido já está pago, só falta a NF-e — por isso conta como receita.
const STATUS_MAP: Record<string, CanonicalOrderStatus> = {
  UNPAID: "pending",
  READY_TO_SHIP: "paid",
  PROCESSED: "paid",
  INVOICE_PENDING: "paid",
  RETRY_SHIP: "paid",
  SHIPPED: "shipped",
  TO_CONFIRM_RECEIVE: "shipped",
  COMPLETED: "delivered",
  IN_CANCEL: "paid",
  CANCELLED: "cancelled",
  TO_RETURN: "refunded",
};

export function canonicalShopeeStatus(providerStatus: string): CanonicalOrderStatus {
  const status = STATUS_MAP[providerStatus];
  if (!status) throw new Error(`Status de pedido Shopee desconhecido: ${providerStatus || "ausente"}.`);
  return status;
}

/**
 * Taxas do escrow → taxonomia canônica. O código original é preservado em
 * `providerFeeCode` para conferência contra o extrato da Shopee.
 *
 * Sinal: no canônico, positivo = debitado do vendedor. A Shopee já devolve
 * essas taxas como valores positivos a descontar, então o sinal se mantém.
 */
const FEE_MAP: Array<{ field: keyof ShopeeEscrowIncome; type: CanonicalFeeType }> = [
  { field: "commission_fee", type: "commission" },
  { field: "service_fee", type: "commission" },
  { field: "seller_transaction_fee", type: "payment" },
  // ⚠️ `actual_shipping_fee` SAIU DAQUI em 30/08/2026 — ele NAO e custo da
  // vendedora, e mapea-lo como `shipping_seller` estava fazendo a tela dela
  // mostrar PREJUIZO onde havia LUCRO.
  //
  // MEDIDO CONTRA A LOJA REAL, 160 pedidos em quatro faixas de idade (0-1d,
  // 2-15d, 16-45d, 46d+): a diferenca entre `escrow_amount` e
  // (bruto - comissao - servico) NUNCA foi igual ao `actual_shipping_fee` —
  // **0 de 80** entre os que divergiam. Nas duas faixas recentes a identidade
  // fecha exata (80 de 80). Regra sem excecao.
  //
  // E o corpo do escrow fecha o argumento por outro caminho:
  //     actual_shipping_fee       9,62
  //     buyer_paid_shipping_fee   9,62   <- o COMPRADOR pagou
  //     final_shipping_fee       -9,62   <- e a Shopee estorna
  // Liquido para a vendedora: ZERO.
  //
  // O estrago: R$ 3.542,80 descontados num unico dia (256 pedidos), 33% do
  // faturamento. A tela mostrava -12,64% de margem onde a real era +20,35% — e
  // a vendedora so descobriu porque conferiu em outro software.
  //
  // Este mapeamento foi escrito em 05/08 contra a DOCUMENTACAO, antes de existir
  // loja conectada, e estava marcado com "⚠️ confirmar enum" em
  // `docs/api-shopee.md`. Nunca foi conferido contra o escrow real. Documentacao
  // e comportamento divergem — de novo.
  //
  // ⚠️ `reverse_shipping_fee` CONTINUA aqui: e frete de DEVOLUCAO, cobrado do
  // vendedor em outra circunstancia, e NAO foi verificado nesta amostra. Nao
  // tirei junto porque nao medi — tirar por analogia seria repetir o erro que
  // criou esta linha.
  { field: "reverse_shipping_fee", type: "shipping_seller" },
  { field: "campaign_fee", type: "ads" },
  { field: "order_ams_commission_fee", type: "ads" },
  { field: "escrow_tax", type: "taxes_withheld" },
  { field: "final_escrow_product_gst", type: "taxes_withheld" },
  { field: "seller_return_refund", type: "refund" },
];

export function canonicalShopeeFees(income: ShopeeEscrowIncome, currency: string): CanonicalFee[] {
  const fees: CanonicalFee[] = [];
  for (const { field, type } of FEE_MAP) {
    const value = income[field];
    // undefined = campo não veio (desconhecido). 0 = fato conhecido, mas não
    // vale gravar linha zerada.
    //
    // ⚠️ Havia aqui uma excecao para `actual_shipping_fee`, que gravava a linha
    // mesmo zerada "porque a ausencia muda a leitura de cobertura". Ela morreu
    // junto com o mapeamento em 30/08/2026: o campo nao e mais custo dela, e
    // manter a excecao deixaria uma linha orfa apontando para um tipo que este
    // mapa nao produz mais.
    if (value == null) continue;
    if (value === 0) continue;
    fees.push({
      feeType: type,
      providerFeeCode: field,
      // ⚠️ SINAL NORMALIZADO: POSITIVO = DINHEIRO QUE SAIU DA VENDEDORA.
      //
      // É a convenção de `workspace_channel_order_fees` no banco inteiro — 43 mil
      // linhas positivas em todos os canais e todos os tipos. A única exceção era
      // `shopee/refund`, 128 de 128 negativas, porque a Shopee devolve
      // `seller_return_refund` já com sinal (dinheiro voltando).
      //
      // O estrago: `shopeeOverviewCanonical` calcula `... - refunds`, e com
      // `refunds` negativo isso SOMAVA o estorno ao lucro em vez de subtrair —
      // R$ 5.411,82 a mais numa conta. A fórmula estava certa e legível; a
      // convenção de sinal é que a traía. Número errado que se decompõe
      // direitinho é mais perigoso que número que não fecha.
      //
      // `Math.abs` e não `-value`: se a Shopee um dia mandar positivo, isto
      // continua certo. Quem lê subtrai; quem grava garante o sinal.
      amount: Math.abs(round2(Number(value))),
      currency,
    });
  }
  return fees;
}

export interface NormalizeShopeeOrderOptions {
  /**
   * Escrow do pedido. undefined/null = ainda não disponível (a Shopee só fecha
   * o escrow depois do pagamento) → o pedido entra sem tarifa e o dashboard o
   * marca como incompleto, em vez de assumir tarifa zero.
   */
  escrow?: ShopeeEscrowDetail | null;
}

export function normalizeShopeeOrder(
  order: ShopeeOrderDetail,
  { escrow }: NormalizeShopeeOrderOptions = {}
): CanonicalOrder {
  const currency = order.currency ?? "BRL";
  const status = canonicalShopeeStatus(order.order_status);
  const occurredAt = requiredEpoch(order.create_time, "create_time", order.order_sn);
  const revenueBearing = ["READY_TO_SHIP", "PROCESSED", "INVOICE_PENDING", "RETRY_SHIP", "SHIPPED", "TO_CONFIRM_RECEIVE", "COMPLETED", "IN_CANCEL"].includes(order.order_status);
  if (revenueBearing && !order.item_list?.length) {
    throw new Error(`Pedido Shopee ${order.order_sn} pago sem item_list; receita não pode ser inferida.`);
  }
  const items = (order.item_list ?? []).map((line) => ({
    // ⚠️ ID COMPOSTO quando a linha traz variação (ADR-029). Tem que ser o MESMO
    // formato do catálogo: se um lado compõe e o outro não, o join catálogo ×
    // venda vai de 41/41 para 0/41. Linha sem `model_id` mantém o id do anúncio,
    // que é exatamente o que o catálogo grava para anúncio simples.
    externalProductId: variantProductId(
      requiredIdentity(line.item_id, "item_id", order.order_sn),
      line.model_id == null ? null : String(line.model_id)
    ),
    // A chave ESTÁVEL da variação. O `sku` textual abaixo o vendedor renomeia;
    // este não muda, e é o que amarra o histórico depois de uma renomeação.
    modelId: line.model_id == null ? null : String(line.model_id),
    // model_sku é o SKU da variação; item_sku é o do anúncio pai.
    sku: line.model_sku || line.item_sku || null,
    title: [line.item_name, line.model_name].filter(Boolean).join(" - ") || String(line.item_id ?? ""),
    qty: requiredPositive(line.model_quantity_purchased, "model_quantity_purchased", order.order_sn),
    // discounted_price é o efetivamente cobrado; original_price é a lista.
    unitPrice: requiredNonNegative(line.model_discounted_price ?? line.model_original_price, "model_discounted_price", order.order_sn),
  }));

  const gross = round2(items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0));
  const income = escrow?.order_income;

  return {
    externalOrderId: order.order_sn,
    status,
    providerStatus: order.order_status,
    occurredAt,
    closedAt: order.order_status === "COMPLETED" ? fromEpoch(order.update_time) : null,
    currency,
    gross,
    // Frete pago pelo comprador só é confiável pelo escrow; sem ele fica
    // desconhecido (null), nunca zero.
    buyerShipping: income?.buyer_paid_shipping_fee == null
      ? null
      : round2(Number(income.buyer_paid_shipping_fee)),
    // A Shopee não separa fulfillment próprio do vendedor nesse endpoint;
    // package_list traz a transportadora, o que não é a mesma informação.
    fulfillment: null,
    packId: null,
    items,
    fees: income ? canonicalShopeeFees(income, currency) : [],
    raw: sanitizeShopeeOrder(order),
  };
}

/**
 * Dado de UM item que veio fora do contrato da Shopee.
 *
 * Quem varre o catálogo trata isto como pendência daquele item — ele fica de
 * fora do snapshot, é contado e o valor cru da Shopee é registrado —, nunca
 * como falha do canal. Qualquer outro erro continua derrubando a página, que é
 * o comportamento certo para defeito nosso ou resposta incoerente.
 *
 * `valorCru` guarda o que a Shopee mandou de verdade: é o que permite descobrir
 * um valor novo (como `SHOPEE_DELETE` em 27/08/2026) sem ter de reproduzir.
 */
export class ShopeeItemForaDoSnapshot extends Error {
  readonly itemId: string;
  readonly valorCru: string;

  constructor(itemId: string, valorCru: string, mensagem: string) {
    super(mensagem);
    this.name = "ShopeeItemForaDoSnapshot";
    this.itemId = itemId;
    this.valorCru = valorCru;
  }
}

const ehNaoNegativo = (value: number | null | undefined): boolean =>
  value != null && Number.isFinite(Number(value)) && Number(value) >= 0;

const recusaDeZero = (field: string, identity: string): string =>
  `Shopee não informou ${field} válido para ${identity}; zero não será fabricado.`;

function requiredNonNegative(value: number | null | undefined, field: string, identity: string): number {
  if (!ehNaoNegativo(value)) throw new Error(recusaDeZero(field, identity));
  return Number(value);
}

/** Igual ao acima, mas o escopo da falha é o item — não o canal. */
function exigidoNoItem(value: number | null | undefined, field: string, itemId: string): number {
  if (!ehNaoNegativo(value)) {
    throw new ShopeeItemForaDoSnapshot(itemId, String(value ?? "(ausente)"), recusaDeZero(field, itemId));
  }
  return Number(value);
}

function requiredPositive(value: number | null | undefined, field: string, identity: string): number {
  const parsed = requiredNonNegative(value, field, identity);
  if (parsed <= 0) throw new Error(`Shopee não informou ${field} positivo para ${identity}.`);
  return parsed;
}

function requiredIdentity(value: number | string | null | undefined, field: string, identity: string): string {
  const parsed = String(value ?? "").trim();
  if (!parsed) throw new Error(`Shopee não informou ${field} válido para ${identity}.`);
  return parsed;
}

function requiredEpoch(value: number | null | undefined, field: string, identity: string): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Shopee não informou ${field} válido para ${identity}; data atual não será fabricada.`);
  }
  const date = new Date(value * 1000);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Shopee não informou ${field} válido para ${identity}; data atual não será fabricada.`);
  }
  return date.toISOString();
}

const PRODUCT_STATUS_MAP: Record<string, CanonicalProduct["status"]> = {
  NORMAL: "active",
  UNLIST: "paused",
  BANNED: "closed",
  DELETED: "closed",
  REVIEWING: "paused",
  // Medidos na loja real em 27/08/2026, NENHUM dos dois documentado pela
  // Shopee: pedimos a lista com `item_status=DELETED` e o detalhe volta com
  // `SHOPEE_DELETE` (removido pela plataforma) ou `SELLER_DELETE` (removido
  // pelo vendedor) — o `DELETED` que pedimos não apareceu uma vez sequer.
  // Como os três são item morto, o canônico é o mesmo `closed`; a diferença de
  // origem fica preservada em `providerStatus`, que guarda o valor cru.
  SHOPEE_DELETE: "closed",
  SELLER_DELETE: "closed",
};

/** Uma variação do item, na forma medida em 27/08/2026 na loja real. */
export interface ShopeeModel {
  model_id?: number;
  model_sku?: string;
  /** Nome da variação ("Madeira Preta"). É o que torna a linha legível na tela. */
  model_name?: string;
  price_info?: Array<{ current_price?: number; currency?: string }>;
  stock_info_v2?: { summary_info?: { total_available_stock?: number } };
}

/**
 * Preço, estoque e moeda de um item — do lugar certo do payload.
 *
 * ITEM SIMPLES: vem de `price_info[0]` / `stock_info_v2.summary_info` do item.
 * ITEM COM VARIAÇÃO (`has_model`): os dois campos do item vêm **ausentes**, e o
 * dado vive por variação. Preço = **menor `current_price`** entre as variações
 * (o "a partir de" que o vendedor vê); estoque = **soma** das variações; moeda
 * = a da variação.
 *
 * ⚠️ Devolve `null` quando não há preço em lugar nenhum. Continua valendo que
 * zero NÃO é fabricado — o que muda é o escopo: quem decide o que fazer com a
 * ausência é o chamador, item a item, em vez de a varredura inteira parar.
 */
const numeroValido = (valor: unknown): number | null =>
  valor != null && Number.isFinite(Number(valor)) && Number(valor) >= 0 ? Number(valor) : null;

export function precoDoProdutoShopee(
  product: ShopeeProductItem,
  models?: readonly ShopeeModel[]
): { price: number | null; availableQty: number | null; currency: string } {
  const doItem = product.price_info?.[0];
  const precoDoItem = numeroValido(doItem?.current_price);
  if (precoDoItem !== null) {
    return {
      price: precoDoItem,
      // ⚠️ Estoque ausente continua ausente. Somar 0 aqui seria afirmar
      // "esgotado" para um item que talvez tenha estoque — o mesmo `null ≠ 0`
      // que vale para o preço.
      availableQty: numeroValido(product.stock_info_v2?.summary_info?.total_available_stock),
      currency: doItem?.currency ?? product.currency ?? "BRL",
    };
  }

  const precos: number[] = [];
  let estoque: number | null = null;
  let moeda = "";
  for (const model of models ?? []) {
    const valor = numeroValido(model.price_info?.[0]?.current_price);
    if (valor !== null) {
      precos.push(valor);
      if (!moeda && model.price_info?.[0]?.currency) moeda = model.price_info[0].currency!;
    }
    const qty = numeroValido(model.stock_info_v2?.summary_info?.total_available_stock);
    if (qty !== null) estoque = (estoque ?? 0) + qty;
  }
  return {
    price: precos.length ? Math.min(...precos) : null,
    availableQty: estoque,
    currency: moeda || product.currency || "BRL",
  };
}

/**
 * O catálogo canônico da Shopee — UMA LINHA POR VARIAÇÃO (ADR-029).
 *
 * ## Por que deixou de ser uma linha por anúncio
 *
 * Medido em 28/08/2026 na loja real: o catálogo tirava o SKU do nível do item
 * (`item_sku`, vazio em 286 de 372 anúncios), enquanto o pedido já gravava o
 * `model_sku` da variação. Resultado: **71 dos 76 SKUs que vendem não existiam
 * no catálogo**, e o custo — que é chaveado por SKU — não tinha onde se prender.
 * A dona viu isso como *"um anúncio com duas variações aparece como um produto,
 * com um campo de custo"*.
 *
 * ⚠️ **Esta função sozinha quebra o join.** O `external_product_id` composto tem
 * que entrar no CATÁLOGO e no ITEM DE PEDIDO no mesmo lote, com o backfill —
 * senão o casamento catálogo × venda vai de 41/41 para 0/41. Ver a condição de
 * atomicidade no ADR-029.
 *
 * Anúncio sem variação continua **exatamente** como estava: uma linha, id
 * intacto, sem sufixo no título.
 */
export function normalizeShopeeProducts(
  product: ShopeeProductItem,
  models?: readonly ShopeeModel[]
): CanonicalProduct[] {
  const comVariacao = product.has_model === true && (models?.length ?? 0) > 0;
  if (!comVariacao) return [normalizeShopeeProduct(product, models)];

  const base = normalizeShopeeProduct(product, models);
  const lista = models ?? [];
  const linhas: CanonicalProduct[] = [];
  for (const model of lista) {
    const modelId = model.model_id == null ? "" : String(model.model_id);
    // Variação sem identificador não vira linha: o id composto seria igual ao do
    // anúncio e duas variações colidiriam numa só — pior que ficar de fora.
    if (!modelId) continue;
    const preco = numeroValido(model.price_info?.[0]?.current_price);
    const estoque = numeroValido(model.stock_info_v2?.summary_info?.total_available_stock);
    // Sem preço OU sem estoque a linha não pode ser afirmada. Ela fica de fora
    // em vez de nascer com zero fabricado — as irmãs que têm dado continuam
    // aparecendo, o que é melhor que derrubar o anúncio inteiro por uma delas.
    if (preco == null || estoque == null) continue;
    linhas.push({
      ...base,
      externalProductId: variantProductId(base.externalProductId, modelId),
      sku: model.model_sku || product.item_sku || null,
      title: tituloDaVariacao(base.title, model.model_name, model.model_sku, lista.length),
      price: preco,
      availableQty: estoque,
      currency: model.price_info?.[0]?.currency ?? base.currency,
    });
  }
  // Nenhuma variação utilizável: cai no comportamento antigo (uma linha do
  // anúncio, com preço "a partir de" e estoque somado), que é o que a tela já
  // sabe mostrar. Sumir o anúncio seria pior.
  return linhas.length ? linhas : [base];
}

export function normalizeShopeeProduct(product: ShopeeProductItem, models?: readonly ShopeeModel[]): CanonicalProduct {
  const externalProductId = requiredIdentity(product.item_id, "item_id", "produto");
  const providerStatus = product.item_status ?? "";
  const status = PRODUCT_STATUS_MAP[providerStatus];
  if (!status) {
    // A Shopee inventa valor de `item_status` sem avisar (ver o mapa acima).
    // Adivinhar o significado seria fabricar fato; derrubar o canal por um item
    // morto seria pior ainda. O item fica de fora, contado e com o valor cru.
    throw new ShopeeItemForaDoSnapshot(
      externalProductId,
      providerStatus || "(ausente)",
      `Status de produto Shopee desconhecido: ${providerStatus || "ausente"}.`
    );
  }
  const resolvido = precoDoProdutoShopee(product, models);
  const currentPrice = exigidoNoItem(resolvido.price, "price_info.current_price", externalProductId);
  const availableQty = exigidoNoItem(
    resolvido.availableQty,
    "stock_info_v2.summary_info.total_available_stock",
    externalProductId
  );
  return {
    externalProductId,
    sku: product.item_sku || null,
    title: product.item_name ?? String(product.item_id),
    status,
    providerStatus,
    price: currentPrice,
    currency: resolvido.currency,
    availableQty,
    fulfillment: null,
    thumbnail: product.image?.image_url_list?.[0] ?? null,
    permalink: null,
    raw: sanitizeShopeeProduct(product),
  };
}
