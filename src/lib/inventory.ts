import { spapiFetch, defaultMarketplaceId } from "./spapi";
import { cached } from "./cache";

// FBA Inventory API v1 — getInventorySummaries. Estoque em tempo real por SKU.

interface ReservedQuantity {
  totalReservedQuantity?: number;
}
interface InventoryDetails {
  fulfillableQuantity?: number;
  inboundWorkingQuantity?: number;
  inboundShippingQuantity?: number;
  inboundReceivingQuantity?: number;
  reservedQuantity?: ReservedQuantity;
  unfulfillableQuantity?: { totalUnfulfillableQuantity?: number };
}
interface InventorySummary {
  asin?: string;
  fnSku?: string;
  sellerSku?: string;
  productName?: string;
  totalQuantity?: number;
  inventoryDetails?: InventoryDetails;
}
interface InventoryResponse {
  payload?: { inventorySummaries?: InventorySummary[]; nextToken?: string };
  pagination?: { nextToken?: string };
}

export interface StockItem {
  sellerSku: string;
  asin?: string;
  productName?: string;
  fulfillable: number; // disponível para venda
  inbound: number; // a caminho do FC
  reserved: number; // vendido, aguardando envio
  unfulfillable: number;
  total: number;
}

/** Lista o estoque FBA por SKU (paginando tudo). Com cache/dedupe de 2 min. */
export function getInventory(marketplaceId = defaultMarketplaceId()): Promise<StockItem[]> {
  return cached(`inventory:${marketplaceId}`, 120_000, () => fetchInventory(marketplaceId));
}

async function fetchInventory(marketplaceId: string): Promise<StockItem[]> {
  const items: StockItem[] = [];
  let nextToken: string | undefined;
  let guard = 0;

  do {
    const query: Record<string, string | number | undefined> = nextToken
      ? { granularityType: "Marketplace", granularityId: marketplaceId, marketplaceIds: marketplaceId, details: "true", nextToken }
      : { granularityType: "Marketplace", granularityId: marketplaceId, marketplaceIds: marketplaceId, details: "true" };

    const data = await spapiFetch<InventoryResponse>("/fba/inventory/v1/summaries", { query });

    for (const s of data.payload?.inventorySummaries ?? []) {
      const d = s.inventoryDetails ?? {};
      const inbound =
        (d.inboundWorkingQuantity ?? 0) +
        (d.inboundShippingQuantity ?? 0) +
        (d.inboundReceivingQuantity ?? 0);
      items.push({
        sellerSku: s.sellerSku || s.fnSku || s.asin || "—",
        asin: s.asin,
        productName: s.productName,
        fulfillable: d.fulfillableQuantity ?? 0,
        inbound,
        reserved: d.reservedQuantity?.totalReservedQuantity ?? 0,
        unfulfillable: d.unfulfillableQuantity?.totalUnfulfillableQuantity ?? 0,
        total: s.totalQuantity ?? 0,
      });
    }

    nextToken = data.pagination?.nextToken || data.payload?.nextToken;
  } while (nextToken && ++guard < 20);

  return items;
}
