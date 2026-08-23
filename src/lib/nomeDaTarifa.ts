// Nome legível de cada tarifa, em UM lugar só.
//
// Existiam dois dicionários — `src/app/amazon/page.tsx` e `src/app/monitor/page.tsx` —
// e os dois tinham o mesmo defeito: chaves no formato CRU da SP-API
// (`Commission`, `FBAPerUnitFulfillmentFee`), enquanto o banco canônico grava
// minúsculo (`commission`, `refund`, `fulfillment`, `shipping_seller`). Nenhuma
// chave batia, o fallback devolvia a chave, e a tela exibia inglês cru para a
// vendedora (visto em 23/08/2026).
//
// 📌 "Comissão e tarifas", e não "Comissão": na Amazon, 4.886 das 5.015 linhas de
// `commission` têm `provider_fee_code = transactions_total` — a SOMA de tudo que
// a Amazon cobrou no pedido (comissão + logística FBA + o resto), porque a
// Transactions API devolve um número agregado. Rotular de "Comissão" faz a
// pessoa caçar um erro de comissão que não existe: numa venda de R$ 12,90 esse
// total dá 74% do preço, e quase tudo é frete FBA.

const NOMES: Record<string, string> = {
  // Modelo canônico — o que os syncs realmente gravam.
  commission: "Comissão e tarifas",
  fulfillment: "Logística FBA",
  refund: "Reembolsos",
  shipping_seller: "Frete pago pelo vendedor",
  no_shipment: "Pedido sem envio",
  // Nomes crus da SP-API: `provider_fee_code` ainda os carrega, e linhas
  // antigas podem chegar com eles.
  Commission: "Comissão",
  ReferralFee: "Comissão",
  AdvertisingFee: "Anúncios",
  FBAPerUnitFulfillmentFee: "Logística FBA",
  FBAWeightBasedFee: "Logística FBA — por peso",
  FBAStorageFee: "Armazenagem FBA",
  FBAInventoryFee: "Estoque FBA",
  StorageFee: "Armazenagem",
  SubscriptionFee: "Assinatura",
  RefundCommission: "Comissão de reembolso",
  ShippingChargeback: "Estorno de frete",
  DigitalServicesFee: "Taxa de serviços digitais",
  VariableClosingFee: "Taxa de fechamento",
  FixedClosingFee: "Taxa de fechamento fixa",
  PerItemFee: "Taxa por item",
};

/**
 * Nunca devolve a chave crua: tipo desconhecido vira "Outras tarifas". Devolver
 * a chave é o que vazava inglês para a tela, e um rótulo genérico e honesto é
 * melhor que um identificador de banco no meio do extrato.
 */
export function nomeDaTarifa(tipo: string): string {
  return NOMES[tipo] ?? "Outras tarifas";
}
