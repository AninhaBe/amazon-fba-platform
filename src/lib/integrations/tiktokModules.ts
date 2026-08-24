import { dbQuery, ensureFinancialLedgerSchema, hasDb } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { getTiktokShops } from "../tiktokStore";
import { getTiktokOverviewFromCanonical } from "./tiktokOverviewCanonical";
import { classificarCobertura, LOW_DAYS } from "../coberturaDeEstoque";
import { parseTiktokConnectionId, tiktokConnectionId } from "./tiktokContract";
import type { IntegrationConnection } from "./types";
import { pageMetadata, pageRequest, periodRequest, TIKTOK_CATALOG_STATUSES, TiktokModuleError } from "./tiktokModuleContract";
import { isFinancialSchemaMissing } from "./tiktokFinancialLedger";
export { pageRequest, periodRequest, TiktokModuleError, type PageRequest } from "./tiktokModuleContract";
/* Database rows are converted at the boundary below; pg returns runtime-shaped records. */
/* eslint-disable @typescript-eslint/no-explicit-any */

const PROVIDER = "tiktok_shop";
export async function requireTiktokConnection(params: URLSearchParams): Promise<IntegrationConnection> {
  const id = params.get("connection_id");
  if (!id) throw new TiktokModuleError(400, "CONNECTION_ID_REQUIRED", "Informe connection_id.");
  const parsed = parseTiktokConnectionId(id);
  if (!parsed) throw new TiktokModuleError(400, "INVALID_CONNECTION_ID", "connection_id TikTok inválido.");
  const matches = (await getTiktokShops()).filter((shop) => shop.shopId === parsed.shopId);
  if (!matches.length) throw new TiktokModuleError(404, "CONNECTION_NOT_FOUND", "Conexão TikTok Shop não encontrada.");
  if (matches.length !== 1) throw new TiktokModuleError(409, "OWNERSHIP_CONFLICT", "Conflito de propriedade da conexão.");
  const shop = matches[0];
  return { id: tiktokConnectionId(shop.shopId), provider: PROVIDER, externalAccountId: shop.shopId,
    displayName: shop.shopName, mode: "local", region: shop.region, scopes: [], metadata: { taxRate: shop.taxRate ?? null },
    status: "connected", connectedAt: shop.connectedAt, updatedAt: shop.connectedAt };
}

function queryText(params: URLSearchParams) { const q = params.get("q")?.trim() ?? ""; if (q.length > 120) throw new TiktokModuleError(400,"INVALID_SEARCH","Busca muito longa."); return q; }
function statuses(params: URLSearchParams, allowed: Set<string>) { const values = params.getAll("status").flatMap(v => v.split(",")).filter(Boolean); if (values.some(v => !allowed.has(v))) throw new TiktokModuleError(400,"INVALID_STATUS","Status inválido."); return values; }

export async function readMonitor(connection: IntegrationConnection, params: URLSearchParams) {
  if (!hasDb()) return { items: [], page: { ...pageRequest(params), total: 0, hasMore: false }, availability: "NOT_AVAILABLE" as const };
  const period = periodRequest(params), page = pageRequest(params), q = queryText(params);
  const orderId=params.get("order_id")?.trim()??"", sku=params.get("sku")?.trim()??"";
  if(orderId.length>160||sku.length>160) throw new TiktokModuleError(400,"INVALID_FILTER","Filtro muito longo.");
  const state = statuses(params, new Set(["pending","paid","shipped","delivered","cancelled"]));
  const args: unknown[] = [currentWorkspaceId(), PROVIDER, connection.id, period.from, period.to, q, state, page.limit, page.offset, orderId, sku];
  const rows = await dbQuery<any>(`WITH filtered AS (SELECT o.* FROM workspace_channel_orders o WHERE o.workspace_id=$1 AND o.provider=$2 AND o.connection_id=$3 AND o.occurred_at BETWEEN $4 AND $5 AND ($6='' OR o.external_order_id ILIKE '%'||$6||'%' OR EXISTS (SELECT 1 FROM workspace_channel_order_items si WHERE si.workspace_id=o.workspace_id AND si.provider=o.provider AND si.connection_id=o.connection_id AND si.external_order_id=o.external_order_id AND si.sku ILIKE '%'||$6||'%')) AND (cardinality($7::text[])=0 OR o.status=ANY($7::text[])) AND ($10='' OR o.external_order_id=$10) AND ($11='' OR EXISTS (SELECT 1 FROM workspace_channel_order_items fi WHERE fi.workspace_id=o.workspace_id AND fi.provider=o.provider AND fi.connection_id=o.connection_id AND fi.external_order_id=o.external_order_id AND fi.sku=$11))), counted AS (SELECT filtered.*,COUNT(*) OVER()::int total FROM filtered), selected AS (SELECT * FROM counted ORDER BY occurred_at DESC, external_order_id DESC LIMIT $8 OFFSET $9) SELECT s.*, COALESCE((s.raw #>> '{_sellercore,statementSettled}')::boolean,false) statement_settled, COALESCE(json_agg(json_build_object('productId',i.external_product_id,'sku',i.sku,'title',i.title,'qty',i.qty,'unitPrice',i.unit_price) ORDER BY i.line_no) FILTER (WHERE i.line_no IS NOT NULL),'[]') items FROM selected s LEFT JOIN workspace_channel_order_items i ON i.workspace_id=s.workspace_id AND i.provider=s.provider AND i.connection_id=s.connection_id AND i.external_order_id=s.external_order_id GROUP BY s.workspace_id,s.provider,s.connection_id,s.external_order_id,s.status,s.provider_status,s.occurred_at,s.closed_at,s.currency,s.gross,s.buyer_shipping,s.fulfillment,s.pack_id,s.raw,s.synced_at,s.total ORDER BY s.occurred_at DESC,s.external_order_id DESC`, args);
  const items = rows.map((r:any) => { const evidence=r.raw?._sellercore?.financialEvidence; const complete=!!evidence&&["fees","sellerShipping","ads","taxesWithheld","refunds"].every(k=>evidence[k]===true); return { orderId:r.external_order_id,status:r.status,providerStatus:r.provider_status,occurredAt:new Date(r.occurred_at).toISOString(),closedAt:r.closed_at?new Date(r.closed_at).toISOString():null,currency:r.currency,gross:Number(r.gross),buyerShipping:r.buyer_shipping==null?null:Number(r.buyer_shipping),fulfillment:r.fulfillment,packageId:r.pack_id,financialStatus:!r.statement_settled?"pending":complete?"complete":"partial",items:r.items }; });
  const total = rows[0]?.total ?? 0; return { items, detail:orderId?(items[0]??null):undefined, page:pageMetadata(page,total,items.length), availability:"AVAILABLE" as const };
}

export async function readCatalog(connection: IntegrationConnection, params: URLSearchParams) {
  const page=pageRequest(params), q=queryText(params), state=statuses(params,new Set(TIKTOK_CATALOG_STATUSES));
  if (!hasDb()) return {items:[],page:{...page,total:0,hasMore:false},availability:"NOT_AVAILABLE" as const};
  const rows=await dbQuery<any>(`SELECT external_product_id,sku,title,status,provider_status,price,currency,available_qty,synced_at,COUNT(*) OVER()::int total FROM workspace_channel_products WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3 AND ($4='' OR title ILIKE '%'||$4||'%' OR sku ILIKE '%'||$4||'%' OR external_product_id ILIKE '%'||$4||'%') AND (cardinality($5::text[])=0 OR status=ANY($5::text[])) ORDER BY title,COALESCE(sku,''),external_product_id LIMIT $6 OFFSET $7`,[currentWorkspaceId(),PROVIDER,connection.id,q,state,page.limit,page.offset]);
  const items=rows.map((r:any)=>({productId:r.external_product_id,variationId:r.external_product_id,sku:r.sku,title:r.title,status:r.status,providerStatus:r.provider_status,price:r.price==null?null:Number(r.price),currency:r.currency,availableQty:r.available_qty==null?null:Number(r.available_qty),updatedAt:new Date(r.synced_at).toISOString()})); const total=rows[0]?.total??0;
  return {items,page:{...page,total,hasMore:page.offset+items.length<total},availability:"AVAILABLE" as const};
}

export async function readFinance(connection: IntegrationConnection, params: URLSearchParams) {
  const period=periodRequest(params),page=pageRequest(params),workspaceId=currentWorkspaceId();
  if(!hasDb())return{items:[],coverage:null,overview:null,availability:"BLOCKED" as const,code:"FINANCIAL_SCHEMA_UNAVAILABLE"};
  try { await ensureFinancialLedgerSchema(); }
  catch (error) { if (isFinancialSchemaMissing(error)) return {items:[],coverage:null,overview:null,availability:"BLOCKED" as const,code:"FINANCIAL_SCHEMA_UNAVAILABLE",message:"O ledger financeiro ainda não está disponível neste ambiente."}; throw error; }
  const canonical=await getTiktokOverviewFromCanonical(connection,period);
  if(!canonical)return{items:[],coverage:null,overview:null,availability:"NOT_AVAILABLE" as const};
  try{
    const rows=await dbQuery<any>(`SELECT * FROM workspace_financial_transactions WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3 AND occurred_at BETWEEN $4 AND $5 AND NOT is_estimated ORDER BY occurred_at DESC,transaction_id DESC LIMIT $6 OFFSET $7`,[workspaceId,PROVIDER,connection.id,period.from,period.to,page.limit,page.offset]);
    return{items:rows.map((r:any)=>({transactionId:r.transaction_id,statementId:r.statement_id,orderId:r.order_id,adjustmentOrderId:r.adjustment_order_id,type:r.transaction_type,occurredAt:new Date(r.occurred_at).toISOString(),currency:r.currency,revenue:r.revenue==null?null:Number(r.revenue),adjustment:r.adjustment==null?null:Number(r.adjustment)})),page:{...page,total:null,hasMore:rows.length===page.limit},coverage:canonical.financialCoverage,overview:canonical.overview,availability:"AVAILABLE" as const};
  }catch(error){if(isFinancialSchemaMissing(error))return{items:[],page:{...page,total:0,hasMore:false},coverage:canonical.financialCoverage,overview:canonical.overview,availability:"BLOCKED" as const,code:"FINANCIAL_SCHEMA_UNAVAILABLE",message:"O ledger financeiro ainda não está disponível neste ambiente."};throw error;}
}

export async function readInventory(connection: IntegrationConnection, params: URLSearchParams) {
  const period=periodRequest(params), page=pageRequest(params), q=queryText(params);
  const filter=params.get("filter");
  if(filter&&!new Set(["out","low","no_sales"]).has(filter)) throw new TiktokModuleError(400,"INVALID_FILTER","Filtro de estoque inválido.");
  if(!hasDb()) return {items:[],page:{...page,total:0,hasMore:false},availability:"NOT_AVAILABLE" as const,period:{from:period.from.toISOString(),to:period.to.toISOString()}};
  const days=Math.max(1,(period.to.getTime()-period.from.getTime())/86_400_000);
  const rows=await dbQuery<any>(`WITH sold AS (
    SELECT i.external_product_id,i.sku,SUM(i.qty)::int units
      FROM workspace_channel_order_items i
      JOIN workspace_channel_orders o USING(workspace_id,provider,connection_id,external_order_id)
     WHERE i.workspace_id=$1 AND i.provider=$2 AND i.connection_id=$3
       AND o.occurred_at BETWEEN $4 AND $5 AND o.status=ANY($6::text[])
     GROUP BY i.external_product_id,i.sku
  ), inventory AS (
    SELECT p.external_product_id,p.sku,p.title,p.status,p.provider_status,p.price,p.currency,p.available_qty,p.synced_at,
           COALESCE(s.units,0)::int units_sold,
           CASE WHEN COALESCE(s.units,0)>0 THEN COALESCE(s.units,0)::numeric/$9 ELSE 0 END average_per_day,
           CASE WHEN p.available_qty IS NOT NULL AND COALESCE(s.units,0)>0
             THEN p.available_qty/(COALESCE(s.units,0)::numeric/$9) ELSE NULL END days_remaining
      FROM workspace_channel_products p
      LEFT JOIN sold s ON s.external_product_id=p.external_product_id AND s.sku IS NOT DISTINCT FROM p.sku
     WHERE p.workspace_id=$1 AND p.provider=$2 AND p.connection_id=$3
       AND ($7='' OR p.title ILIKE '%'||$7||'%' OR p.sku ILIKE '%'||$7||'%' OR p.external_product_id ILIKE '%'||$7||'%')
  ), filtered AS (
    SELECT * FROM inventory
     WHERE $8='' OR ($8='out' AND available_qty=0)
       OR ($8='low' AND available_qty>0 AND days_remaining IS NOT NULL AND days_remaining<=$12)
       OR ($8='no_sales' AND units_sold=0)
  )
  SELECT *,COUNT(*) OVER()::int total FROM filtered
   ORDER BY title,COALESCE(sku,''),external_product_id LIMIT $10 OFFSET $11`,[
    currentWorkspaceId(),PROVIDER,connection.id,period.from,period.to,["paid","shipped","delivered"],q,filter??"",days,page.limit,page.offset,LOW_DAYS,
  ]);
  const items=rows.map((r:any)=>({productId:r.external_product_id,variationId:r.external_product_id,sku:r.sku,title:r.title,status:r.status,providerStatus:r.provider_status,price:r.price==null?null:Number(r.price),currency:r.currency,availableQty:r.available_qty==null?null:Number(r.available_qty),updatedAt:new Date(r.synced_at).toISOString(),unitsSold:Number(r.units_sold),averagePerDay:+Number(r.average_per_day).toFixed(4),daysRemaining:r.days_remaining==null?null:+Number(r.days_remaining).toFixed(1),
    // MESMA classificação dos outros três canais. Antes o TikTok não devolvia
    // status nenhum e a tela não sabia dizer se um SKU estava saudável, parado
    // ou perto de romper — ver `classificarCobertura`.
    cobertura:classificarCobertura({disponivel:Number(r.available_qty??0),porDia:Number(r.average_per_day??0),diasRestantes:r.days_remaining==null?null:Number(r.days_remaining)})}));
  const total=rows[0]?.total??0;
  return {items,page:{...page,total,hasMore:page.offset+items.length<total},availability:"AVAILABLE" as const,period:{from:period.from.toISOString(),to:period.to.toISOString()}};
}

export async function readAbc(connection: IntegrationConnection, params: URLSearchParams) {
  const period=periodRequest(params), overview=await getTiktokOverviewFromCanonical(connection,period); if(!overview) return {items:[],coverage:null,availability:"NOT_AVAILABLE" as const};
  const rows=await dbQuery<any>(`SELECT i.external_product_id,i.sku,MAX(i.title) title,SUM(i.qty*i.unit_price)::numeric revenue,SUM(i.qty)::int units FROM workspace_channel_order_items i JOIN workspace_channel_orders o USING(workspace_id,provider,connection_id,external_order_id) WHERE i.workspace_id=$1 AND i.provider=$2 AND i.connection_id=$3 AND o.occurred_at BETWEEN $4 AND $5 AND o.status=ANY($6::text[]) GROUP BY i.external_product_id,i.sku ORDER BY revenue DESC,i.external_product_id,i.sku`,[currentWorkspaceId(),PROVIDER,connection.id,period.from,period.to,["paid","shipped","delivered"]]);
  const total=rows.reduce((s:number,r:any)=>s+Number(r.revenue),0);let cumulative=0;const completeOrders=new Set(overview.orderProfitability.filter(o=>o.financialStatus==="complete").map(o=>o.orderId));
  return {items:rows.map((r:any)=>{cumulative+=Number(r.revenue);const share=total>0?Number(r.revenue)/total:0;const pct=total>0?cumulative/total:0;return {productId:r.external_product_id,sku:r.sku,title:r.title,revenue:Number(r.revenue),units:Number(r.units),revenueShare:+(share*100).toFixed(2),class:pct<=.8?"A":pct<=.95?"B":"C",profit:null,profitAvailable:false};}),coverage:overview.coverage.requestedPeriod.revenue,profitSubset:{completeOrders:completeOrders.size,totalOrders:overview.orderProfitability.length,profitAvailable:false,reason:"Lucro por SKU não é derivável com segurança do contrato atual; somente lucro por pedido completo está disponível."},availability:"AVAILABLE" as const};
}
