import crypto from "crypto";
import type { DbQuery } from "../db";

export const TIKTOK_FINANCIAL_PROVIDER = "tiktok_shop";
export const FINANCIAL_RESOURCES = ["statements", "statement_transactions", "payments", "unsettled"] as const;
export type FinancialResource = typeof FINANCIAL_RESOURCES[number];

export interface FinancialPage<T> { items: T[]; nextPageToken: string | null; rejected: number; unknown: number; diagnostics: string[]; }
export type FinancialPaginationSeen = Map<string,Set<string>>;
export const FINANCIAL_CURSOR_HASH_LIMIT = 256;
export const financialCursorHash = (token:string) => crypto.createHash("sha256").update(token,"utf8").digest();
export function validatePersistentFinancialPagination(resource:string,current:string|null,next:string|null,history:readonly (Buffer|string)[],limit=FINANCIAL_CURSOR_HASH_LIMIT):Buffer[]{
  if(history.length>limit)throw new Error(`TIKTOK_FINANCIAL_CURSOR_HASH_HISTORY_OVERFLOW:${resource}`);
  const result=history.map(hash=>Buffer.isBuffer(hash)?Buffer.from(hash):Buffer.from(hash,"hex"));
  const contains=(hash:Buffer)=>result.some(value=>value.equals(hash));
  if(current){const hash=financialCursorHash(current);if(!contains(hash))result.push(hash);}
  if(next){const hash=financialCursorHash(next);if(contains(hash))throw new Error(`TIKTOK_FINANCIAL_REPEATED_PAGE_TOKEN_RETRYABLE:${resource}`);result.push(hash);}
  if(result.length>limit)throw new Error(`TIKTOK_FINANCIAL_CURSOR_HASH_HISTORY_OVERFLOW:${resource}`);
  return result;
}
export function validateFinancialPagination(resource:string,current:string|null,next:string|null,seen?:FinancialPaginationSeen){
  const tokens=seen?.get(resource)??new Set<string>();
  if(current)tokens.add(current);
  if(next&&(next===current||tokens.has(next)))throw new Error(`TIKTOK_FINANCIAL_REPEATED_PAGE_TOKEN_RETRYABLE:${resource}`);
  if(next)tokens.add(next);
  if(seen)seen.set(resource,tokens);
}
export interface StatementRecord { id: string; status: string; currency: string; startTime?: number; endTime?: number; raw: Record<string, unknown>; }
export interface TransactionRecord { id: string; statementId: string | null; orderId: string | null; adjustmentOrderId: string | null; type: string; occurredAt: number; currency: string; totals: { revenue:number|null; feeAndTax:number|null; shippingCost:number|null; settlement:number|null }; raw: Record<string, unknown>; }
export interface PaymentRecord { id: string; statementId: string | null; status: string; amount: string | null; currency: string; paidAt: number | null; expectedAt: number | null; raw: Record<string, unknown>; }

type Transport = <T>(path: string, options: { query?: Record<string, string | number | undefined>; method?: "GET" | "POST"; body?: unknown }) => Promise<T>;
const text = (value: unknown) => typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
const epoch = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const items = (data: Record<string, unknown>, keys: string[]) => { for (const key of keys) if (Array.isArray(data[key])) return data[key] as unknown[]; return []; };
// Token vazio e ausente significam a mesma coisa: acabou a paginacao. A OAS descreve
// next_page_token como "use este valor se a resposta atual nao retornou todos os
// resultados" — na ultima pagina ele volta vazio. Tratar vazio como erro fazia toda
// paginacao completa falhar no fim, que e sempre.
const token = (data: Record<string, unknown>) => text(data.next_page_token ?? data.nextPageToken) || null;
const ISO_CURRENCY=/^[A-Z]{3}$/;
const money=(value:unknown,field:string):number|null=>{if(value===undefined||value===null||value==="")return null;const parsed=Number(value);if(!Number.isFinite(parsed))throw new TypeError(`TikTok ${field} invalido.`);return parsed;};
function requiredId(value:unknown,kind:string){const id=text(value);if(!id)throw new TypeError(`TikTok ${kind} sem identificador.`);return id;}
function requiredEpoch(value:unknown,kind:string){const parsed=epoch(value);if(!parsed||!Number.isFinite(new Date(parsed*1000).getTime()))throw new TypeError(`TikTok ${kind} sem timestamp valido.`);return parsed;}
function requiredCurrency(value:unknown,kind:string){const currency=text(value).toUpperCase();if(!ISO_CURRENCY.test(currency))throw new TypeError(`TikTok ${kind} sem moeda ISO valida.`);return currency;}
const page=<T>(data:Record<string,unknown>,entries:unknown[],parse:(raw:Record<string,unknown>)=>T):FinancialPage<T>=>({items:entries.map(entry=>parse(object(entry))),nextPageToken:token(data),rejected:0,unknown:0,diagnostics:[]});

export class TiktokFinancialAdapters {
  private readonly call: Transport;
  constructor(call: Transport) { this.call = call; }
  async statements(input: { from: number; to: number; pageToken?: string }): Promise<FinancialPage<StatementRecord>> {
    // OAS 202309: a janela e statement_time_ge/lt (nao start_time/end_time) e sort_field
    // e obrigatorio, aceitando so `statement_time`. Enviar os nomes errados devolve 36009004.
    const data = object(await this.call<unknown>("/finance/202309/statements", { query: { statement_time_ge: input.from, statement_time_lt: input.to, sort_field: "statement_time", page_size: 50, page_token: input.pageToken } }));
    const result=page(data,items(data,["statements"]),raw=>({id:requiredId(raw.id??raw.statement_id,"statement"),status:text(raw.status).toUpperCase(),currency:requiredCurrency(raw.currency,"statement"),startTime:epoch(raw.start_time)||undefined,endTime:epoch(raw.end_time)||undefined,raw}));
    const nonFinal=result.items.filter(statement=>!isFinalStatement(statement));
    result.unknown=nonFinal.filter(statement=>statement.status!=="PENDING").length;
    result.diagnostics=nonFinal.map(statement=>`statement:${statement.id}:status:${statement.status||"UNKNOWN"}`);
    return result;
  }
  async transactions(statementId: string, pageToken?: string): Promise<FinancialPage<TransactionRecord>> {
    const data=object(await this.call<unknown>(`/finance/202501/statements/${encodeURIComponent(statementId)}/statement_transactions`, { query:{page_size:100,page_token:pageToken} }));
    return page(data,items(data,["statement_transactions","transactions"]),raw=>transaction(raw,statementId));
  }
  async payments(input:{from:number;to:number;pageToken?:string}):Promise<FinancialPage<PaymentRecord>> {
    // A versao 202605 nao existe na API; a oficial e 202309, com janela create_time_ge/lt
    // e sort_field obrigatorio aceitando so `create_time`.
    const data=object(await this.call<unknown>("/finance/202309/payments",{query:{create_time_ge:input.from,create_time_lt:input.to,sort_field:"create_time",page_size:100,page_token:input.pageToken}}));
    return page(data,items(data,["payments"]),raw=>({id:requiredId(raw.id??raw.payment_id,"payment"),statementId:text(raw.statement_id)||null,status:text(raw.status),amount:raw.amount==null?null:String(money(raw.amount,"payment amount")),currency:requiredCurrency(raw.currency,"payment"),paidAt:raw.paid_time==null?null:requiredEpoch(raw.paid_time,"payment"),expectedAt:raw.expected_time==null?null:requiredEpoch(raw.expected_time,"payment"),raw}));
  }
  async unsettled(input:{from:number;to:number;pageToken?:string}):Promise<FinancialPage<TransactionRecord>> {
    // Janela search_time_ge/lt e sort_field obrigatorio aceitando so `order_create_time`.
    const data=object(await this.call<unknown>("/finance/202507/orders/unsettled",{query:{search_time_ge:input.from,search_time_lt:input.to,sort_field:"order_create_time",page_size:100,page_token:input.pageToken}}));
    return page(data,items(data,["orders","unsettled_orders","statement_transactions","transactions"]),raw=>transaction(raw,null));
  }
}

function transaction(raw:Record<string,unknown>, statementId:string|null):TransactionRecord { const type=text(raw.type??raw.transaction_type).toUpperCase();if(!type)throw new TypeError("TikTok transaction sem tipo provider.");return {id:requiredId(raw.id??raw.transaction_id,"transaction"),statementId:statementId??(text(raw.statement_id)||null),orderId:text(raw.order_id)||null,adjustmentOrderId:text(raw.adjustment_order_id)||null,type,occurredAt:requiredEpoch(raw.order_create_time??raw.create_time??raw.occurred_at,"transaction"),currency:requiredCurrency(raw.currency,"transaction"),totals:{revenue:money(raw.revenue_amount,"revenue_amount"),feeAndTax:money(raw.fee_and_tax_amount,"fee_and_tax_amount"),shippingCost:money(raw.shipping_cost_amount,"shipping_cost_amount"),settlement:money(raw.settlement_amount,"settlement_amount")},raw}; }
const FINAL_STATUSES = new Set(["PAID", "SETTLED", "COMPLETED", "CLOSED"]);
export function isFinalStatement(statement:StatementRecord) { return FINAL_STATUSES.has(statement.status); }
type MoneyKey="revenue"|"buyer_shipping"|"seller_shipping"|"commission"|"payment_fee"|"fulfillment_fee"|"ads"|"taxes_withheld"|"refunds"|"adjustment"|"settlement_amount";
const OBSERVED_TYPES=new Set(["ORDER","LOGISTICS_REIMBURSEMENT"]);
const ALLOWLIST=["id","transaction_id","statement_id","order_id","adjustment_order_id","type","transaction_type","order_create_time","create_time","occurred_at","currency","revenue_amount","fee_and_tax_amount","shipping_cost_amount","settlement_amount"];
export interface LedgerRow { transactionId:string; statementId:string|null; orderId:string|null; adjustmentOrderId:string|null; transactionType:string; occurredAt:string; currency:string; values:Partial<Record<MoneyKey,number|null>>; settlementState:"settled"|"unsettled"; estimated:boolean; sourceResource:string; sourceRank:number; rawAllowlisted:Record<string,unknown>; rawSha256:Buffer; }
export function normalizeTransaction(record:TransactionRecord,input:{final:boolean;source:"statement_transactions"|"unsettled"}):LedgerRow {
  if(!OBSERVED_TYPES.has(record.type))throw new TypeError(`Tipo financeiro TikTok sem diagnostico: ${record.type}.`);
  const debit=(value:number|null)=>value==null?null:Math.abs(value);
  // Observed LOGISTICS_REIMBURSEMENT uses revenue_amount as the signed credit
  // signal, but it is not sales revenue. Keeping it exclusively in adjustment
  // makes the reconciliation adjustment - debits = settlement without inflating
  // the official order revenue or counting the same provider amount twice.
  const reimbursement=record.type==="LOGISTICS_REIMBURSEMENT";
  const values:Partial<Record<MoneyKey,number|null>>={revenue:reimbursement?null:record.totals.revenue,adjustment:reimbursement?record.totals.revenue:undefined,commission:debit(record.totals.feeAndTax),seller_shipping:debit(record.totals.shippingCost),settlement_amount:record.totals.settlement};
  // Breakdown is evidence metadata only. It is never added beside its parent.
  const allowed=Object.fromEntries(ALLOWLIST.filter(k=>record.raw[k]!==undefined).map(k=>[k,record.raw[k]]));
  return {transactionId:record.id,statementId:record.statementId,orderId:record.orderId,adjustmentOrderId:record.adjustmentOrderId,transactionType:record.type,occurredAt:new Date(record.occurredAt*1000).toISOString(),currency:record.currency,values,settlementState:input.final?"settled":"unsettled",estimated:!input.final,sourceResource:input.source,sourceRank:input.final?100:10,rawAllowlisted:allowed,rawSha256:crypto.createHash("sha256").update(stableJson(record.raw)).digest()};
}
function stableJson(value:unknown):string { if(Array.isArray(value))return`[${value.map(stableJson).join(",")}]`;if(value&&typeof value==="object")return`{${Object.keys(value as object).sort().map(k=>`${JSON.stringify(k)}:${stableJson((value as Record<string,unknown>)[k])}`).join(",")}}`;return JSON.stringify(value)??"null"; }

export async function upsertLedger(query:DbQuery,scope:{workspaceId:string;connectionId:string},rows:LedgerRow[],observedAt=new Date()):Promise<number>{
  let written=0; for(const row of rows){const columns:[MoneyKey,number|null][] = Object.entries(row.values) as [MoneyKey,number|null][]; const values=Object.fromEntries(columns);
    const linkedOrder=row.orderId?(await query<{external_order_id:string}>(`SELECT external_order_id FROM workspace_channel_orders WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3 AND external_order_id=$4`,[scope.workspaceId,TIKTOK_FINANCIAL_PROVIDER,scope.connectionId,row.orderId]))[0]?.external_order_id??null:null;
    if(row.orderId&&!linkedOrder)throw new Error("TIKTOK_FINANCIAL_ORDER_ASSOCIATION_UNRESOLVED");
    const result=await query(`INSERT INTO workspace_financial_transactions (workspace_id,provider,connection_id,transaction_id,statement_id,order_id,adjustment_order_id,transaction_type,occurred_at,currency,revenue,buyer_shipping,seller_shipping,commission,payment_fee,fulfillment_fee,ads,taxes_withheld,refunds,adjustment,settlement_amount,settlement_state,is_estimated,source_resource,source_record_id,source_observed_at,source_rank,raw_allowlisted,raw_sha256) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$4,$25,$26,$27,$28) ON CONFLICT (workspace_id,provider,connection_id,transaction_id) DO UPDATE SET statement_id=EXCLUDED.statement_id,order_id=EXCLUDED.order_id,adjustment_order_id=EXCLUDED.adjustment_order_id,transaction_type=EXCLUDED.transaction_type,occurred_at=EXCLUDED.occurred_at,currency=EXCLUDED.currency,revenue=EXCLUDED.revenue,buyer_shipping=EXCLUDED.buyer_shipping,seller_shipping=EXCLUDED.seller_shipping,commission=EXCLUDED.commission,payment_fee=EXCLUDED.payment_fee,fulfillment_fee=EXCLUDED.fulfillment_fee,ads=EXCLUDED.ads,taxes_withheld=EXCLUDED.taxes_withheld,refunds=EXCLUDED.refunds,adjustment=EXCLUDED.adjustment,settlement_amount=EXCLUDED.settlement_amount,settlement_state=EXCLUDED.settlement_state,is_estimated=EXCLUDED.is_estimated,source_resource=EXCLUDED.source_resource,source_observed_at=EXCLUDED.source_observed_at,source_rank=EXCLUDED.source_rank,raw_allowlisted=EXCLUDED.raw_allowlisted,raw_sha256=EXCLUDED.raw_sha256,updated_at=now() WHERE EXCLUDED.source_rank >= workspace_financial_transactions.source_rank AND (workspace_financial_transactions.raw_sha256<>EXCLUDED.raw_sha256 OR workspace_financial_transactions.source_rank<>EXCLUDED.source_rank) RETURNING 1`,[scope.workspaceId,TIKTOK_FINANCIAL_PROVIDER,scope.connectionId,row.transactionId,row.statementId,linkedOrder,row.adjustmentOrderId,row.transactionType,row.occurredAt,row.currency,values.revenue??null,values.buyer_shipping??null,values.seller_shipping??null,values.commission??null,values.payment_fee??null,values.fulfillment_fee??null,values.ads??null,values.taxes_withheld??null,values.refunds??null,values.adjustment??null,values.settlement_amount??null,row.settlementState,row.estimated,row.sourceResource,observedAt,row.sourceRank,row.rawAllowlisted,row.rawSha256]); written+=result.length; }
  return written;
}

export function isFinancialSchemaMissing(error:unknown){const value=error as {code?:string;message?:string};return value?.code==="42P01"||value?.code==="42703"||value?.code==="42883"||value?.code==="42804"||/^SCHEMA_BLOCKED:/i.test(value?.message??"")||/workspace_financial_|financial_checkpoint_/i.test(value?.message??"")&&/does not exist|não existe|invalid|inválid/i.test(value?.message??"");}

export interface LedgerAggregate { revenue:number|null; buyerShipping:number|null; sellerShipping:number|null; fees:number|null; ads:number|null; taxesWithheld:number|null; refunds:number|null; adjustments:number|null; currency:string|null; finalTransactions:number; estimatedTransactions:number; }
export async function aggregateLedger(query:DbQuery,scope:{workspaceId:string;connectionId:string;from:Date;to:Date}):Promise<LedgerAggregate>{
  const rows=await query<Record<string,string|null>>(`SELECT currency,COUNT(*) FILTER (WHERE NOT is_estimated)::text final_count,COUNT(*) FILTER (WHERE is_estimated)::text estimated_count,SUM(revenue) FILTER (WHERE NOT is_estimated)::text revenue,SUM(buyer_shipping) FILTER (WHERE NOT is_estimated)::text buyer_shipping,SUM(seller_shipping) FILTER (WHERE NOT is_estimated)::text seller_shipping,SUM(commission) FILTER (WHERE NOT is_estimated)::text commission,SUM(payment_fee) FILTER (WHERE NOT is_estimated)::text payment_fee,SUM(fulfillment_fee) FILTER (WHERE NOT is_estimated)::text fulfillment_fee,SUM(ads) FILTER (WHERE NOT is_estimated)::text ads,SUM(taxes_withheld) FILTER (WHERE NOT is_estimated)::text taxes_withheld,SUM(refunds) FILTER (WHERE NOT is_estimated)::text refunds,SUM(adjustment) FILTER (WHERE NOT is_estimated)::text adjustments FROM workspace_financial_transactions WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3 AND occurred_at >= $4 AND occurred_at <= $5 GROUP BY currency`,[scope.workspaceId,TIKTOK_FINANCIAL_PROVIDER,scope.connectionId,scope.from,scope.to]);
  if(!rows.length)return{revenue:null,buyerShipping:null,sellerShipping:null,fees:null,ads:null,taxesWithheld:null,refunds:null,adjustments:null,currency:null,finalTransactions:0,estimatedTransactions:0};
  if(rows.length>1)throw new Error("Período financeiro TikTok contém moedas diferentes."); const r=rows[0]; const money=(key:string)=>r[key]==null?null:Number(r[key]);
  const feeParts=[money("commission"),money("payment_fee"),money("fulfillment_fee")];
  return{currency:r.currency,revenue:money("revenue"),buyerShipping:money("buyer_shipping"),sellerShipping:money("seller_shipping"),fees:feeParts.some(v=>v!==null)?feeParts.reduce<number>((n,v)=>n+(v??0),0):null,ads:money("ads"),taxesWithheld:money("taxes_withheld"),refunds:money("refunds"),adjustments:money("adjustments"),finalTransactions:Number(r.final_count??0),estimatedTransactions:Number(r.estimated_count??0)};
}

export type TiktokFinancialAuthority = "statement_ledger"|"per_order_fallback"|"schema_blocked";
export interface TiktokLedgerCoverage { version:3; status:"complete"|"partial"|"blocked"; terminal:boolean; from:string; to:string; source:TiktokFinancialAuthority; estimatesIncluded:false; rejected:number; }
export interface TiktokLedgerSnapshot { aggregate:LedgerAggregate; covered:boolean; authority:TiktokFinancialAuthority; coverage:TiktokLedgerCoverage; }
const emptyAggregate:LedgerAggregate={revenue:null,buyerShipping:null,sellerShipping:null,fees:null,ads:null,taxesWithheld:null,refunds:null,adjustments:null,currency:null,finalTransactions:0,estimatedTransactions:0};
/** Brazil has had no DST since 2019. Financial requested periods use -03:00. */
export function closedFinancialBoundary(now=new Date()){
  const brazilDate=new Date(now.getTime()-3*60*60_000).toISOString().slice(0,10);
  return new Date(`${brazilDate}T00:00:00-03:00`);
}
export function checkpointsCoverPeriod(rows:Array<{window_from:Date|string;window_to:Date|string;completed_at:Date|string|null;terminal_cursor:boolean;error_count?:number|string}>,from:Date,to:Date,now=new Date()){
  if(to.getTime()>closedFinancialBoundary(now).getTime())return false;
  const completed=rows.filter(row=>row.completed_at&&row.terminal_cursor&&Number(row.error_count??0)===0).map(row=>({from:new Date(row.window_from).getTime(),to:new Date(row.window_to).getTime()})).sort((a,b)=>a.from-b.from||a.to-b.to);
  let cursor=from.getTime();for(const window of completed){if(window.to<=cursor)continue;if(window.from>cursor)return false;cursor=Math.max(cursor,window.to);if(cursor>=to.getTime())return true;}return false;
}
export async function readTiktokLedgerSnapshot(query:DbQuery,scope:{workspaceId:string;connectionId:string;from:Date;to:Date},now=new Date()):Promise<TiktokLedgerSnapshot>{
  const [aggregate,checkpoints,fallbackRows]=await Promise.all([aggregateLedger(query,scope),query<{window_from:Date;window_to:Date;completed_at:Date|null;terminal_cursor:boolean;error_count:number}>(`SELECT window_from,window_to,completed_at,terminal_cursor,error_count FROM workspace_financial_sync_checkpoints WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3 AND resource='statements' AND window_to>$4 AND window_from<$5 ORDER BY window_from`,[scope.workspaceId,TIKTOK_FINANCIAL_PROVIDER,scope.connectionId,scope.from,scope.to]),query<Record<string,string|null>>(`SELECT MIN(o.currency) currency,SUM(o.gross)::text revenue,SUM(o.buyer_shipping)::text buyer_shipping,SUM(f.fees)::text fees,SUM(f.seller_shipping)::text seller_shipping FROM workspace_channel_orders o LEFT JOIN LATERAL (SELECT SUM(amount) FILTER (WHERE fee_type IN ('commission','payment','other')) fees,SUM(amount) FILTER (WHERE fee_type IN ('shipping_seller','fulfillment')) seller_shipping FROM workspace_channel_order_fees x WHERE x.workspace_id=o.workspace_id AND x.provider=o.provider AND x.connection_id=o.connection_id AND x.external_order_id=o.external_order_id) f ON true WHERE o.workspace_id=$1 AND o.provider=$2 AND o.connection_id=$3 AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status=ANY($6::text[])`,[scope.workspaceId,TIKTOK_FINANCIAL_PROVIDER,scope.connectionId,scope.from,scope.to,["paid","shipped","delivered"]])]);
  const covered=checkpointsCoverPeriod(checkpoints,scope.from,scope.to,now);
  const rejected=checkpoints.reduce((sum,row)=>sum+Number(row.error_count??0),0);
  if(covered)return{aggregate,covered:true,authority:"statement_ledger",coverage:{version:3,status:"complete",terminal:true,from:scope.from.toISOString(),to:scope.to.toISOString(),source:"statement_ledger",estimatesIncluded:false,rejected}};
  const fallback=fallbackRows[0]??{};const number=(key:string)=>fallback[key]==null?null:Number(fallback[key]);
  return{covered:false,authority:"per_order_fallback",coverage:{version:3,status:"partial",terminal:false,from:scope.from.toISOString(),to:scope.to.toISOString(),source:"per_order_fallback",estimatesIncluded:false,rejected},aggregate:{currency:fallback.currency??null,revenue:number("revenue"),buyerShipping:number("buyer_shipping"),sellerShipping:number("seller_shipping"),fees:number("fees"),ads:null,taxesWithheld:null,refunds:null,adjustments:null,finalTransactions:0,estimatedTransactions:aggregate.estimatedTransactions}};
}

export function blockedTiktokLedgerSnapshot(scope:{from:Date;to:Date},operational:Partial<LedgerAggregate>={}):TiktokLedgerSnapshot{
  return {aggregate:{...emptyAggregate,...operational,finalTransactions:0,estimatedTransactions:0},covered:false,authority:"schema_blocked",coverage:{version:3,status:"blocked",terminal:false,from:scope.from.toISOString(),to:scope.to.toISOString(),source:"schema_blocked",estimatesIncluded:false,rejected:0}};
}

export async function claimCheckpoint(query:DbQuery,scope:{workspaceId:string;connectionId:string},resource:string,window:{from:Date;to:Date},ownerToken:string,leaseMs=30_000){
  const rows=await query<{acquired:boolean;fencing_token:string;db_now:Date}>("SELECT * FROM financial_checkpoint_claim($1,$2,$3,$4,$5,$6,$7,$8)",[scope.workspaceId,TIKTOK_FINANCIAL_PROVIDER,scope.connectionId,resource,window.from,window.to,ownerToken,leaseMs]);
  return rows[0] ? {acquired:rows[0].acquired,fencingToken:Number(rows[0].fencing_token),dbNow:new Date(rows[0].db_now)} : {acquired:false,fencingToken:0,dbNow:new Date()};
}
export async function advanceCheckpoint(query:DbQuery,scope:{workspaceId:string;connectionId:string},resource:string,window:{from:Date;to:Date},lease:{ownerToken:string;fencingToken:number},page:{nextPageToken:string|null;pageNumber:number;rowsSeen:number;rowsWritten:number}){
  const terminal=page.nextPageToken===null; const cursorHash=page.nextPageToken===null?null:financialCursorHash(page.nextPageToken); const rows=await query<{financial_checkpoint_advance:boolean}>("SELECT financial_checkpoint_advance($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) AS financial_checkpoint_advance",[scope.workspaceId,TIKTOK_FINANCIAL_PROVIDER,scope.connectionId,resource,window.from,window.to,lease.ownerToken,lease.fencingToken,page.nextPageToken,cursorHash,page.pageNumber,terminal,page.rowsSeen,page.rowsWritten]);
  return rows[0]?.financial_checkpoint_advance===true;
}
