import { getSalesVelocity } from "./orders";
import { getProducts } from "./products";
import type { Period } from "./period";

export interface TopProduct {
  sku: string;
  title?: string;
  asin?: string;
  units: number;
  salePrice: number | null;
  cost: number | null;
  revenue: number;
  marginPct: number | null; // margem de contribuição = (preço − custo) ÷ preço
}

/**
 * Produtos mais vendidos no período, com faturamento e margem.
 * Cruza a velocidade de venda (unidades por SKU) com preço e custo dos produtos.
 */
export async function getTopProducts(period: Period, limit = 10): Promise<TopProduct[]> {
  const [velocity, products] = await Promise.all([getSalesVelocity({ period }), getProducts()]);
  const bySku = new Map(products.map((p) => [p.id, p]));
  const revenueBySku = new Map<string, number>();
  for (const sale of velocity.sales) {
    revenueBySku.set(sale.sku, (revenueBySku.get(sale.sku) ?? 0) + (sale.revenue ?? 0));
  }

  const rows: TopProduct[] = Object.entries(velocity.unitsBySku).map(([sku, units]) => {
    const p = bySku.get(sku);
    const salePrice = p?.salePrice ?? null;
    const cost = p?.cost ?? null;
    const revenue = +(revenueBySku.get(sku) ?? 0).toFixed(2);
    const marginPct =
      salePrice && salePrice > 0 && cost != null ? ((salePrice - cost) / salePrice) * 100 : null;
    return { sku, title: p?.title, asin: p?.asin, units, salePrice, cost, revenue, marginPct };
  });

  rows.sort((a, b) => b.revenue - a.revenue || b.units - a.units);
  return rows.slice(0, limit);
}
