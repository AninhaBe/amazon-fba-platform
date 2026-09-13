/**
 * Rótulos de status em português — CAMADA DE EXIBIÇÃO, só isso.
 *
 * O dado canônico não passa por aqui: `MAPA_STATUS` (TikTok) e `STATUS_MAP`
 * (Shopee) continuam intocados na ingestão, com o mesmo fail-closed de sempre.
 * Isto traduz na hora de desenhar, e nada mais.
 *
 * ⚠️ **O fallback é proposital.** Status que este arquivo não conhece volta
 * CRU e legível (`under_review` → "under review"). Não é descuido: valor cru na
 * tela é o sinal de que a API mandou algo novo e o mapa da ingestão precisa de
 * uma linha. Trocar isso por "Desconhecido" ou "—" apagaria o único aviso que
 * chega até quem olha a tela.
 *
 * A nomenclatura é a que a casa já usa; nada foi inventado aqui:
 *   - pedido:  `TikTokWorkspaceModel.tiktokOrderStatusLabel`
 *   - produto: `mercado-livre/anuncios` e `amazon/anuncios`
 *   - Shopee:  o mapa que vivia dentro de `ShopeeWorkspace`
 *   - conciliação: a frase de `TikTokWorkspace` na lista de pedidos
 */

/** Fallback comum: legível, mas ainda reconhecível como valor cru da API. */
const cru = (status: string) => status.replaceAll("_", " ");

/** Status canônico de pedido — o mesmo vocabulário nos quatro canais. */
const PEDIDO: Record<string, string> = {
  pending: "Pendente",
  paid: "Pago",
  shipped: "Enviado",
  delivered: "Entregue",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
};

export function rotuloStatusPedido(status: string): string {
  return PEDIDO[status] ?? cru(status);
}

/** Status canônico de anúncio/produto. Mesmas palavras de ML e Amazon. */
const PRODUTO: Record<string, string> = {
  active: "Ativo",
  paused: "Pausado",
  closed: "Encerrado",
};

export function rotuloStatusProduto(status: string): string {
  return PRODUTO[status] ?? cru(status);
}

/**
 * Estado da conciliação de uma venda. Mesma leitura da lista de pedidos do
 * dashboard do TikTok, encurtada para caber em célula de tabela.
 */
const CONCILIACAO: Record<string, string> = {
  complete: "Conciliado",
  partial: "Falta custo cadastrado",
  pending: "Aguardando extrato",
};

export function rotuloConciliacao(status: string): string {
  return CONCILIACAO[status] ?? cru(status);
}

/**
 * Status v2 da Shopee. O monitor da Shopee mostra o status DO PROVEDOR (é o que
 * `provider_status` guarda), não o canônico — por isso o vocabulário aqui é
 * outro. `INVOICE_PENDING` é peculiaridade do Brasil: já pago, só falta a NF-e.
 */
const SHOPEE: Record<string, string> = {
  UNPAID: "Aguardando pagamento",
  READY_TO_SHIP: "Pronto para envio",
  PROCESSED: "Em processamento",
  RETRY_SHIP: "Reenvio pendente",
  SHIPPED: "Enviado",
  TO_CONFIRM_RECEIVE: "Aguardando confirmação",
  COMPLETED: "Concluído",
  IN_CANCEL: "Cancelamento em análise",
  CANCELLED: "Cancelado",
  TO_RETURN: "Em devolução",
  INVOICE_PENDING: "Aguardando NF-e",
};

export function rotuloStatusShopee(status: string): string {
  // Cai no canônico antes do cru: algumas telas da Shopee já recebem `paid`
  // e `cancelled` normalizados, e elas devem ler igual ao resto da casa.
  return SHOPEE[status] ?? PEDIDO[status] ?? cru(status).toLowerCase();
}
