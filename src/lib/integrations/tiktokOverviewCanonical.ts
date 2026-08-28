import { costAt, getCosts, type CostEntry } from "../costStore";
import { dbQuery, hasDb } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { REVENUE_STATUSES } from "./canonical";
import type { IntegrationConnection } from "./types";
import { tiktokCostId } from "./tiktokContract";
import { blockedTiktokLedgerSnapshot, isFinancialSchemaMissing, readTiktokLedgerSnapshot, type TiktokLedgerCoverage } from "./tiktokFinancialLedger";
export {
  calculateTiktokFinancialV2,
  type ComponentCoverage,
  type CoverageStatus,
  type FinancialValueState,
  type TiktokCoverageV2,
  type TiktokFinancialInput,
  type TiktokFinancialOverviewV2,
  type TiktokRevenueCascade,
  type TiktokSettledComponent,
} from "./tiktokFinancialV2";
import {
  applyTiktokLedgerAuthority,
  calculateTiktokFinancialV2,
  type TiktokCoverageV2,
  type TiktokFinancialInput,
  type TiktokFinancialOverviewV2,
} from "./tiktokFinancialV2";

const PROVIDER = "tiktok_shop";

export interface TiktokPeriod { from: Date; to: Date; label: string }
export interface TiktokOverviewV2 {
  period: { from: string; to: string; label: string };
  orders: number;
  units: number;
  ticket: number | null;
  dailySeries: Array<{ date: string; revenue: number; orders: number; units: number }>;
  statusBreakdown: Array<{ status: string; orders: number }>;
  topProducts: Array<{ productId: string; sku: string | null; title: string; revenue: number; units: number }>;
  overview: TiktokFinancialOverviewV2;
  coverage: TiktokCoverageV2;
  financialCoverage: TiktokLedgerCoverage;
  catalog: Array<{ id: string; sku: string | null; title: string; status: string; price: number; currency: string; availableQty: number }>;
  orderProfitability: Array<{ orderId: string; occurredAt: string; revenue: number; profit: number | null; marginPct: number | null; financialStatus: "complete" | "partial" | "pending" }>;
}

interface SyncRow { covered_from: Date | string | null; covered_to: Date | string | null }
interface OrderRow {
  external_order_id: string; status: string; occurred_at: Date | string; gross: string; buyer_shipping: string | null;
  currency: string; statement_settled: boolean; fees: string | null; seller_shipping: string | null;
  ads: string | null; taxes_withheld: string | null; refunds: string | null;
  fees_known: boolean; seller_shipping_known: boolean; ads_known: boolean; taxes_withheld_known: boolean; refunds_known: boolean;
}
interface ItemRow { external_order_id: string; external_product_id: string; sku: string | null; title: string; qty: number; unit_price: string; promotion_discount: string | null }
interface ProductRow { external_product_id: string; sku: string | null; title: string; status: string; price: string; currency: string; available_qty: number }

function findCost(costs: Record<string, CostEntry>, connectionId: string, productId: string, sku: string | null): CostEntry | undefined {
  const exact = costs[tiktokCostId(connectionId, productId, sku)];
  if (exact) return exact;
  return sku ? Object.values(costs).find((entry) => entry.sku === sku && entry.id.startsWith(`tiktok:${connectionId}:`)) : undefined;
}

export async function getTiktokOverviewFromCanonical(connection: IntegrationConnection, period: TiktokPeriod): Promise<TiktokOverviewV2 | null> {
  if (!hasDb()) return null;
  const params = [currentWorkspaceId(), PROVIDER, connection.id, period.from, period.to];
  const [syncRows, orders, items, products, costs, backlogRows, ledgerSnapshot] = await Promise.all([
    dbQuery<SyncRow>(`SELECT covered_from, covered_to FROM workspace_marketplace_syncs WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3`, params.slice(0, 3)),
    dbQuery<OrderRow>(`SELECT o.external_order_id, o.status, o.occurred_at, o.gross, o.buyer_shipping, o.currency,
      (o.financial_settled OR COALESCE((o.raw #>> '{_sellercore,statementSettled}')::boolean, false)) AS statement_settled,
      (SELECT SUM(f.amount) FROM workspace_channel_order_fees f WHERE f.workspace_id=o.workspace_id AND f.provider=o.provider AND f.connection_id=o.connection_id AND f.external_order_id=o.external_order_id AND f.fee_type IN ('commission','payment','other')) AS fees,
      (SELECT SUM(f.amount) FROM workspace_channel_order_fees f WHERE f.workspace_id=o.workspace_id AND f.provider=o.provider AND f.connection_id=o.connection_id AND f.external_order_id=o.external_order_id AND f.fee_type IN ('shipping_seller','fulfillment')) AS seller_shipping,
      (SELECT SUM(f.amount) FROM workspace_channel_order_fees f WHERE f.workspace_id=o.workspace_id AND f.provider=o.provider AND f.connection_id=o.connection_id AND f.external_order_id=o.external_order_id AND f.fee_type='ads') AS ads,
      (SELECT SUM(f.amount) FROM workspace_channel_order_fees f WHERE f.workspace_id=o.workspace_id AND f.provider=o.provider AND f.connection_id=o.connection_id AND f.external_order_id=o.external_order_id AND f.fee_type='taxes_withheld') AS taxes_withheld,
      (SELECT SUM(f.amount) FROM workspace_channel_order_fees f WHERE f.workspace_id=o.workspace_id AND f.provider=o.provider AND f.connection_id=o.connection_id AND f.external_order_id=o.external_order_id AND f.fee_type='refund') AS refunds,
      (o.evidence_fees OR COALESCE((o.raw #>> '{_sellercore,financialEvidence,fees}')::boolean, false)) AS fees_known,
      (o.evidence_seller_shipping OR COALESCE((o.raw #>> '{_sellercore,financialEvidence,sellerShipping}')::boolean, false)) AS seller_shipping_known,
      (o.evidence_ads OR COALESCE((o.raw #>> '{_sellercore,financialEvidence,ads}')::boolean, false)) AS ads_known,
      (o.evidence_taxes_withheld OR COALESCE((o.raw #>> '{_sellercore,financialEvidence,taxesWithheld}')::boolean, false)) AS taxes_withheld_known,
      (o.evidence_refunds OR COALESCE((o.raw #>> '{_sellercore,financialEvidence,refunds}')::boolean, false)) AS refunds_known
      FROM workspace_channel_orders o WHERE o.workspace_id=$1 AND o.provider=$2 AND o.connection_id=$3 AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status=ANY($6::text[]) ORDER BY o.occurred_at DESC,o.external_order_id DESC`, [...params, [...REVENUE_STATUSES]]),
    dbQuery<ItemRow>(`SELECT i.external_order_id, i.external_product_id, i.sku, i.title, i.qty, i.unit_price, i.promotion_discount FROM workspace_channel_order_items i JOIN workspace_channel_orders o ON o.workspace_id=i.workspace_id AND o.provider=i.provider AND o.connection_id=i.connection_id AND o.external_order_id=i.external_order_id WHERE i.workspace_id=$1 AND i.provider=$2 AND i.connection_id=$3 AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status=ANY($6::text[])`, [...params, [...REVENUE_STATUSES]]),
    dbQuery<ProductRow>(`SELECT external_product_id, sku, title, status, price, currency, available_qty
      FROM workspace_channel_products WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3
      ORDER BY status='active' DESC, title, sku`, params.slice(0, 3)),
    getCosts(),
    dbQuery<{ applicable: number; pending: number }>(`SELECT COUNT(*)::int AS applicable,
      COUNT(*) FILTER (WHERE NOT (o.financial_settled OR COALESCE((o.raw #>> '{_sellercore,statementSettled}')::boolean,false)))::int AS pending
      FROM workspace_channel_orders o WHERE o.workspace_id=$1 AND o.provider=$2 AND o.connection_id=$3
        AND o.status=ANY($4::text[]) AND (o.occurred_at < $5 OR o.occurred_at > $6)`,
      [params[0], params[1], params[2], [...REVENUE_STATUSES], period.from, period.to]),
    readTiktokLedgerSnapshot(dbQuery,{workspaceId:String(params[0]),connectionId:connection.id,from:period.from,to:period.to}).catch(error=>{if(isFinancialSchemaMissing(error))return null;throw error;}),
  ]);
  const sync = syncRows[0];
  if (!sync) return null;
  const itemsByOrder = new Map<string, TiktokFinancialInput["orders"][number]["items"]>();
  for (const item of items) {
    const order = orders.find((candidate) => candidate.external_order_id === item.external_order_id);
    const entry = findCost(costs, connection.id, item.external_product_id, item.sku);
    const value = entry && order ? costAt(entry, new Date(order.occurred_at).toISOString()) : null;
    const group = itemsByOrder.get(item.external_order_id) ?? [];
    group.push({
      quantity: item.qty,
      unitCost: value != null && value >= 0 ? value : null,
      // Cupom já abatido do `unit_price` (gravado só quando o payload do TikTok
      // reconciliou); nulo = desconhecido, e a cascata some em vez de chutar.
      unitDiscount: item.promotion_discount == null ? null : Number(item.promotion_discount),
    });
    itemsByOrder.set(item.external_order_id, group);
  }
  const taxRaw = connection.metadata?.taxRate;
  const taxRate = typeof taxRaw === "number" && Number.isFinite(taxRaw) && taxRaw >= 0 ? taxRaw : null;
  const historical = backlogRows[0] ?? { applicable: 0, pending: 0 };
  const operationalRevenue=orders.reduce((sum,order)=>sum+Number(order.gross),0);
  const operationalBuyerShipping=orders.some(order=>order.buyer_shipping!=null)?orders.reduce((sum,order)=>sum+Number(order.buyer_shipping??0),0):null;
  const financialSnapshot=ledgerSnapshot??blockedTiktokLedgerSnapshot(period,{revenue:orders.length?operationalRevenue:null,buyerShipping:operationalBuyerShipping,currency:orders[0]?.currency??null});
  const authoritativeCovered=financialSnapshot.covered;
  const result = calculateTiktokFinancialV2({ periodCovered: authoritativeCovered, taxRate,
    historicalBacklog: { applicable: historical.applicable, known: historical.applicable - historical.pending, pending: historical.pending },
    orders: orders.map((order) => ({
    revenue: Number(order.gross), buyerShipping: order.buyer_shipping == null ? null : Number(order.buyer_shipping),
    statementSettled: order.statement_settled, fees: order.fees_known ? Number(order.fees ?? 0) : null,
    sellerShipping: order.seller_shipping_known ? Number(order.seller_shipping ?? 0) : null,
    ads: order.ads_known ? Number(order.ads ?? 0) : null,
    taxesWithheld: order.taxes_withheld_known ? Number(order.taxes_withheld ?? 0) : null,
    refunds: order.refunds_known ? Number(order.refunds ?? 0) : null,
    items: itemsByOrder.get(order.external_order_id) ?? [],
  })) }, orders[0]?.currency ?? "BRL");
  applyTiktokLedgerAuthority(result, { covered: financialSnapshot.covered, aggregate: financialSnapshot.aggregate });
  const orderProfitability = orders.map((order) => {
    const calculated = calculateTiktokFinancialV2({ periodCovered: true, taxRate, orders: [{
      revenue: Number(order.gross), buyerShipping: order.buyer_shipping == null ? null : Number(order.buyer_shipping),
      statementSettled: order.statement_settled, fees: order.fees_known ? Number(order.fees ?? 0) : null,
      sellerShipping: order.seller_shipping_known ? Number(order.seller_shipping ?? 0) : null,
      ads: order.ads_known ? Number(order.ads ?? 0) : null,
      taxesWithheld: order.taxes_withheld_known ? Number(order.taxes_withheld ?? 0) : null,
      refunds: order.refunds_known ? Number(order.refunds ?? 0) : null,
      items: itemsByOrder.get(order.external_order_id) ?? [],
    }] }, order.currency);
    return {
      orderId: order.external_order_id, occurredAt: new Date(order.occurred_at).toISOString(),
      revenue: Number(order.gross), profit: calculated.overview.profit, marginPct: calculated.overview.marginPct,
      financialStatus: (!order.statement_settled ? "pending" : calculated.coverage.financials.status === "complete" ? "complete" : "partial") as "complete" | "partial" | "pending",
    };
  });
  const daily = new Map<string, { revenue: number; orders: number; units: number }>();
  for (const order of orders) { const date = new Date(order.occurred_at).toISOString().slice(0,10); const value=daily.get(date)??{revenue:0,orders:0,units:0}; value.revenue+=Number(order.gross); value.orders++; value.units+=(itemsByOrder.get(order.external_order_id)??[]).reduce((n,i)=>n+i.quantity,0); daily.set(date,value); }
  const statusMap = new Map<string,number>(); for(const order of orders) statusMap.set(order.status,(statusMap.get(order.status)??0)+1);
  const productMap=new Map<string,{productId:string;sku:string|null;title:string;revenue:number;units:number}>(); for(const item of items){const key=`${item.external_product_id}\0${item.sku??""}`;const value=productMap.get(key)??{productId:item.external_product_id,sku:item.sku,title:item.title,revenue:0,units:0};value.revenue+=Number(item.unit_price)*item.qty;value.units+=item.qty;productMap.set(key,value);}
  const units=items.reduce((n,item)=>n+item.qty,0); const revenue=orders.reduce((n,order)=>n+Number(order.gross),0);
  return {
    period: { from: period.from.toISOString(), to: period.to.toISOString(), label: period.label },
    orders: orders.length, units, ticket: orders.length ? +(revenue/orders.length).toFixed(2) : null,
    dailySeries:[...daily].sort(([a],[b])=>a.localeCompare(b)).map(([date,v])=>({date,revenue:+v.revenue.toFixed(2),orders:v.orders,units:v.units})),
    statusBreakdown:[...statusMap].sort(([a],[b])=>a.localeCompare(b)).map(([status,count])=>({status,orders:count})),
    topProducts:[...productMap.values()].sort((a,b)=>b.revenue-a.revenue||a.productId.localeCompare(b.productId)).slice(0,10).map(p=>({...p,revenue:+p.revenue.toFixed(2)})), ...result, financialCoverage:financialSnapshot.coverage,
    catalog: products.map((product) => ({ id: product.external_product_id, sku: product.sku, title: product.title,
      status: product.status, price: Number(product.price), currency: product.currency, availableQty: product.available_qty })),
    orderProfitability,
  };
}
