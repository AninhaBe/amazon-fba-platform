import { spapiFetch, defaultMarketplaceId } from "./spapi";
import { swr } from "./swr";
import { collectAllNextTokenPages } from "./nextTokenPagination";

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

/** Tem alguma unidade em qualquer estado (disponível, a caminho, reservada, avariada)? */
export function hasAnyStock(item: StockItem): boolean {
  return !!(item.total || item.fulfillable || item.inbound || item.reserved || item.unfulfillable);
}

/**
 * Tira os SKUs "fantasma": registro que a Amazon mantém no inventário FBA depois que
 * o anúncio é excluído. São zerados em todos os estados e não têm anúncio nenhum —
 * poluem o radar com produtos que a conta não vende mais.
 *
 * `listingSkus` vazio significa "não sei quais anúncios existem" (o relatório é lento
 * e pode estar aquecendo), e aí **nada** é escondido: melhor mostrar um fantasma do que
 * sumir com o catálogo inteiro. Item com qualquer estoque também nunca é escondido.
 */
export function dropGhostSkus(inventory: StockItem[], listingSkus: Set<string>): StockItem[] {
  if (!listingSkus.size) return inventory;
  return inventory.filter((item) => listingSkus.has(item.sellerSku) || hasAnyStock(item));
}

/** Lista o estoque FBA por SKU. Cache em disco (SWR): espera na 1ª vez, instantâneo depois. */
export function getInventory(marketplaceId = defaultMarketplaceId()): Promise<StockItem[]> {
  return swr(`inventory:${marketplaceId}`, 10 * 60_000, () => fetchInventory(marketplaceId), {
    awaitIfEmpty: true,
    fallback: [],
  });
}

async function fetchInventory(marketplaceId: string): Promise<StockItem[]> {
  const items: StockItem[] = [];
  const pages = await collectAllNextTokenPages(
    (nextToken) => spapiFetch<InventoryResponse>("/fba/inventory/v1/summaries", {
      query: {
        granularityType: "Marketplace",
        granularityId: marketplaceId,
        marketplaceIds: marketplaceId,
        details: "true",
        nextToken,
      },
    }),
    (page) => page.pagination?.nextToken || page.payload?.nextToken
  );

  for (const data of pages) {

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
  }

  return items;
}
