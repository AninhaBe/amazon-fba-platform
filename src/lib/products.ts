import { getInventory } from "./inventory";
import { getListings } from "./listings";
import { getCosts } from "./costStore";

export interface Product {
  id: string;
  sku?: string;
  asin?: string;
  title?: string;
  imageUrl?: string;
  salePrice: number | null; // preço de venda anunciado
  fulfillable?: number | null; // estoque FBA disponível
  cost: number | null; // custo (null = não cadastrado)
  source: "listing" | "fba" | "manual";
}

/**
 * Lista os produtos da conta automaticamente:
 *  - Anúncios (relatório GET_MERCHANT_LISTINGS_ALL_DATA) → SKU, título, preço de venda
 *  - Estoque FBA → quantidade disponível
 *  - Custos cadastrados
 *  - Produtos adicionados manualmente por ASIN
 */
export async function getProducts(): Promise<Product[]> {
  const [listings, inventory, costs] = await Promise.all([
    getListings().catch(() => []),
    getInventory().catch(() => []),
    getCosts(),
  ]);

  const invBySku = new Map(inventory.map((i) => [i.sellerSku, i]));
  const map = new Map<string, Product>();

  // 1) Anúncios da conta (fonte principal — traz o preço de venda)
  for (const l of listings) {
    const inv = invBySku.get(l.sku);
    map.set(l.sku, {
      id: l.sku,
      sku: l.sku,
      asin: l.asin || inv?.asin,
      title: l.title || inv?.productName,
      imageUrl: l.imageUrl, // getListings já resolve a capa por ASIN no catálogo
      salePrice: l.price,
      fulfillable: inv?.fulfillable ?? null,
      cost: costs[l.sku]?.cost ?? null,
      source: "listing",
    });
  }

  // 2) Itens de estoque FBA que por acaso não vieram no relatório de anúncios.
  //    Ignora SKUs "fantasma": registro de inventário FBA que sobrou (tem FNSKU
  //    de quando foi configurado) mas está ZERADO em todos os estados e não tem
  //    anúncio ativo. Item com QUALQUER estoque (disponível, a caminho, reservado
  //    ou avariado) continua aparecendo — é produto real.
  for (const inv of inventory) {
    if (map.has(inv.sellerSku)) continue;
    if (!inv.total && !inv.fulfillable && !inv.inbound && !inv.reserved && !inv.unfulfillable) continue;
    map.set(inv.sellerSku, {
      id: inv.sellerSku,
      sku: inv.sellerSku,
      asin: inv.asin,
      title: inv.productName,
      salePrice: null,
      fulfillable: inv.fulfillable,
      cost: costs[inv.sellerSku]?.cost ?? null,
      source: "fba",
    });
  }

  // 3) Produtos cadastrados manualmente (por ASIN) nesta conta Amazon.
  //    A tabela de custos é do workspace inteiro (agnóstica de canal), então um
  //    custo cadastrado para um produto do ML também aparece aqui. Filtramos por
  //    ASIN: produto manual da Amazon sempre tem ASIN (fluxo "Adicionar por ASIN");
  //    custo sem ASIN é de outro canal e não entra nesta lista.
  for (const [id, c] of Object.entries(costs)) {
    if (map.has(id)) continue;
    if (!c.asin) continue;
    map.set(id, {
      id,
      sku: c.sku,
      asin: c.asin,
      title: c.title,
      imageUrl: c.imageUrl,
      salePrice: null,
      fulfillable: null,
      cost: c.cost,
      source: "manual",
    });
  }

  return [...map.values()].sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
}
