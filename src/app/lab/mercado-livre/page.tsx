"use client";

/**
 * Bancada visual do Dashboard do Mercado Livre — `/lab/mercado-livre`.
 *
 * ⚠️ POR QUE ELA EXISTE. O redesign de 09/09/2026 precisa ser julgado
 * OLHANDO a tela, e a tela de produção exige sessão, conta conectada e banco.
 * Sem uma bancada, "validar visualmente" vira ou pedir a senha de alguém (que
 * eu não posso digitar) ou aprovar o desenho por leitura de CSS — que é
 * exatamente como o design errado passa.
 *
 * ⚠️ E ELA RENDERIZA O COMPONENTE DE VERDADE. `Dashboard` é o mesmo
 * que `/mercado-livre` monta em produção; aqui só os DADOS são fixos. Uma cópia
 * da tela para "testar o visual" diverge no primeiro ajuste e passa a aprovar
 * um desenho que o produto não tem — é o defeito que `docs/landing-nexo.md` já
 * registrou em outra frente.
 *
 * `/lab` é rota pública (`isLab` em `src/lib/supabase/proxy.ts`), então nada
 * aqui toca dado de cliente. Os números são os da janela fechada de 03/09 que a
 * conciliação contra o Mercado Turbo validou, porque desenho se julga com
 * grandeza real: R$ 337 de lucro sobre R$ 2.819 vendidos não é o mesmo problema
 * de composição que R$ 337 mil.
 */

import { Dashboard } from "../../components/MercadoLivreWorkspace";

const HOJE = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/** Sete dias terminando hoje, para o bloco de ritmo desenhar cheio. */
const diaRelativo = (recuo: number) => {
  const d = new Date(`${HOJE}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - recuo);
  return d.toISOString().slice(0, 10);
};

const RITMO = [
  { recuo: 6, revenue: 288.4, orders: 24, units: 27, profit: 31.2 },
  { recuo: 5, revenue: 441.9, orders: 38, units: 44, profit: 52.8 },
  { recuo: 4, revenue: 245.1, orders: 21, units: 23, profit: 24.4 },
  { recuo: 3, revenue: 547.6, orders: 47, units: 52, profit: 66.1 },
  { recuo: 2, revenue: 364.2, orders: 31, units: 35, profit: 38.9 },
  { recuo: 1, revenue: 469.8, orders: 40, units: 46, profit: 55.3 },
  // O dia corrente ainda soma: lucro desconhecido é `null`, nunca zero.
  { recuo: 0, revenue: 462.9, orders: 39, units: 45, profit: null },
].map(({ recuo, ...resto }) => ({ date: diaRelativo(recuo), ...resto }));

const overview = {
  account: { id: "648425194", nickname: "NEXAHUBBRASIL", siteId: "MLB" },
  period: { from: diaRelativo(29), to: HOJE, label: "Últimos 30 dias" },
  metrics: {
    activeListings: 27,
    productsWithoutCost: 3,
    orders30d: 304,
    paidOrders: 276,
    revenue30d: 2819.9,
    approvedRevenue: 2819.9,
    cancelledRevenue: 1017.58,
    cancelledOrders: 28,
    pendingOrders: 6,
    pendingRevenue: 148.3,
    lastSaleAt: `${HOJE}T14:22:00-03:00`,
    currency: "BRL",
    revenueCoverage: {
      capturedOrders: 304,
      totalOrders: 304,
      complete: true,
      sincronizadoAte: `${HOJE}T17:40:00-03:00`,
      historicoDesde: diaRelativo(180),
    },
  },
  profit: {
    fees: 986.4,
    cogs: 1204.32,
    taxes: 112.8,
    taxRate: 4,
    sellerShipping: 179.3,
    buyerShipping: 341.7,
    shippingCostsComplete: true,
    revenueProcessed: 2819.9,
    composicaoDaReceitaPaga: {
      receita: 2819.9,
      fees: 986.4,
      sellerShipping: 179.3,
      cogs: 1204.32,
      taxes: 112.8,
      lucro: 337.08,
      margemPct: 11.95,
    },
    revenueDoLucro: 2819.9,
    pedidosSemApuracao: 0,
    tacos: { pct: 4.7, motivo: null, pedidosSemValor: 0 },
    tacosAteDia: diaRelativo(1),
    coverage: { processedOrders: 276, paidOrders: 276, complete: true },
    estimatedProfit: 337.08,
    marginPct: 11.95,
    unitsWithoutCost: 51,
    skusWithoutCost: 3,
  },
  dailySales: RITMO,
  topProducts: [
    { id: "MLB3921", sku: "MART-BOR-500", title: "Martelo de borracha 500g cabo de madeira", units: 142, revenue: 1204.5, cost: 985.2, contribution: 219.3, complete: true, marginPct: 18.2 },
    { id: "MLB4477", sku: "CLIP-320", title: "Kit clips organizadores 320 peças", units: 88, revenue: 902.1, cost: 817.3, contribution: 84.8, complete: true, marginPct: 9.4 },
    { id: "MLB2210", sku: "PROT-4CM", title: "Protetor de pé para móveis 4 cm — 32 unidades", units: 31, revenue: 713.3, cost: 728.3, contribution: -15.0, complete: true, marginPct: -2.1 },
    { id: "MLB8802", sku: "SUP-BAN-02", title: "Suporte de bancada ajustável", units: 27, revenue: 486.0, cost: 0, contribution: 0, complete: false, marginPct: null },
    { id: "MLB6651", sku: "ESP-FLEX-10", title: "Espátula flexível 10 cm inox", units: 20, revenue: 314.0, cost: 0, contribution: 0, complete: false, marginPct: null },
  ],
  stockRadar: [
    { id: "MLB6651", sku: "ESP-FLEX-10", title: "Espátula flexível 10 cm inox", thumbnail: null, availableQuantity: 0, unitsSold: 20, calculationDays: 30, daysRemaining: 0, status: "out" as const },
    { id: "MLB2210", sku: "PROT-4CM", title: "Protetor de pé para móveis 4 cm", thumbnail: null, availableQuantity: 12, unitsSold: 31, calculationDays: 30, daysRemaining: 11, status: "critical" as const },
    { id: "MLB4477", sku: "CLIP-320", title: "Kit clips organizadores 320 peças", thumbnail: null, availableQuantity: 31, unitsSold: 88, calculationDays: 30, daysRemaining: 10, status: "critical" as const },
    { id: "MLB3921", sku: "MART-BOR-500", title: "Martelo de borracha 500g", thumbnail: null, availableQuantity: 64, unitsSold: 142, calculationDays: 30, daysRemaining: 13, status: "low" as const },
    { id: "MLB8802", sku: "SUP-BAN-02", title: "Suporte de bancada ajustável", thumbnail: null, availableQuantity: 48, unitsSold: 27, calculationDays: 30, daysRemaining: 53, status: "healthy" as const },
  ],
  /**
   * A última linha é DE PROPÓSITO incompleta (`complete: false`, custo `null`):
   * é o estado que o produto precisa saber desenhar — venda conhecida, lucro
   * ainda não — e é justamente o que some quando alguém troca `null` por zero.
   */
  profitabilityLines: [
    { id: "l1", orderId: "2000012847391", product: "Martelo de borracha 500g cabo de madeira", sku: "MART-BOR-500", date: `${HOJE}T14:22:00-03:00`, status: "paid", fulfillment: "full", unitPrice: 31.9, quantity: 2, revenue: 63.8, currency: "BRL", productCost: 24.2, marketplaceFees: 22.3, buyerShipping: 0, sellerShipping: 4.1, tax: 2.55, contribution: 11.6, marginPct: 18.2, complete: true },
    { id: "l2", orderId: "2000012846102", product: "Kit clips organizadores 320 peças", sku: "CLIP-320", date: `${HOJE}T12:07:00-03:00`, status: "paid", fulfillment: "full", unitPrice: 41.9, quantity: 1, revenue: 41.9, currency: "BRL", productCost: 18.0, marketplaceFees: 14.7, buyerShipping: 0, sellerShipping: 3.6, tax: 1.68, contribution: 3.94, marginPct: 9.4, complete: true },
    { id: "l3", orderId: "2000012844778", product: "Protetor de pé para móveis 4 cm", sku: "PROT-4CM", date: `${HOJE}T09:41:00-03:00`, status: "shipped", fulfillment: "flex", unitPrice: 23.0, quantity: 1, revenue: 23.0, currency: "BRL", productCost: 11.6, marketplaceFees: 8.1, buyerShipping: 0, sellerShipping: 2.9, tax: 0.92, contribution: -0.48, marginPct: -2.1, complete: true },
    { id: "l4", orderId: "2000012839044", product: "Martelo de borracha 500g cabo de madeira", sku: "MART-BOR-500", date: `${diaRelativo(1)}T17:52:00-03:00`, status: "delivered", fulfillment: "full", unitPrice: 31.9, quantity: 3, revenue: 95.7, currency: "BRL", productCost: 36.3, marketplaceFees: 33.5, buyerShipping: 0, sellerShipping: 5.2, tax: 3.83, contribution: 17.4, marginPct: 18.2, complete: true },
    { id: "l5", orderId: "2000012840915", product: "Suporte de bancada ajustável", sku: "SUP-BAN-02", date: `${diaRelativo(1)}T21:16:00-03:00`, status: "paid", fulfillment: "full", unitPrice: 18.0, quantity: 1, revenue: 18.0, currency: "BRL", productCost: null, marketplaceFees: 6.3, buyerShipping: 0, sellerShipping: 2.4, tax: 0.72, contribution: null, marginPct: null, complete: false },
  ] as never,
  profitabilityScope: { detailedOrders: 5, completePeriod: true },
  adsPorProduto: [
    { productId: "MLB3921", sku: "MART-BOR-500", title: "Martelo de borracha 500g", impressions: 18420, clicks: 412, cost: 74.2, sales: 402.1, purchases: 31, currency: "BRL", acos: 18.4, roas: 5.42, margemRealPct: 11.6 },
    { productId: "MLB4477", sku: "CLIP-320", title: "Kit clips organizadores 320 peças", impressions: 14110, clicks: 289, cost: 58.1, sales: 214.6, purchases: 18, currency: "BRL", acos: 27.1, roas: 3.69, margemRealPct: -3.2 },
    // Anúncio que gastou e não vendeu: o caso que a tela precisa saber dizer
    // sem inventar ACOS zero. `purchases: 0` é o que o produtor usa para isso.
    { productId: "MLB2210", sku: "PROT-4CM", title: "Protetor de pé 4 cm", impressions: 6240, clicks: 97, cost: 21.4, sales: 0, purchases: 0, currency: "BRL", acos: null, roas: null, margemRealPct: -2.1 },
  ] as never,
  recentOrders: [
    { id: "2000012847391", packId: null, status: "paid", createdAt: `${HOJE}T14:22:00-03:00`, total: 63.8, currency: "BRL", items: 2 },
    { id: "2000012846102", packId: null, status: "paid", createdAt: `${HOJE}T12:07:00-03:00`, total: 41.9, currency: "BRL", items: 1 },
    { id: "2000012844778", packId: null, status: "shipped", createdAt: `${HOJE}T09:41:00-03:00`, total: 23.0, currency: "BRL", items: 1 },
    { id: "2000012840915", packId: null, status: "pending", createdAt: `${diaRelativo(1)}T21:16:00-03:00`, total: 18.0, currency: "BRL", items: 1 },
    { id: "2000012839044", packId: null, status: "delivered", createdAt: `${diaRelativo(1)}T17:52:00-03:00`, total: 95.7, currency: "BRL", items: 3 },
  ],
} as never;

const syncStatus = {
  status: "complete" as const,
  progress: 100,
  processedOrders: 304,
  coveredFrom: diaRelativo(180),
  coveredTo: HOJE,
  lastSuccessAt: `${HOJE}T17:40:00-03:00`,
  error: null,
};

export default function BancadaDoMercadoLivre() {
  return (
    <div className="app-shell" data-channel="mercado_livre">
      <div className="lab-canvas">
        <div className="integration-dashboard ml-dashboard-page">
          <Dashboard
            overview={overview}
            syncStatus={syncStatus}
            periodoQuery="days=30"
            connectionId="mercado-livre-lab"
            serieDeSeteDias={null}
          />
        </div>
      </div>
    </div>
  );
}
