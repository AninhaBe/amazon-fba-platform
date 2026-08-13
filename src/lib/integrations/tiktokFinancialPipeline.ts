import crypto from "crypto";
import type { DbQuery } from "../db";
import { advanceCheckpoint, claimCheckpoint, isFinalStatement, normalizeTransaction, TIKTOK_FINANCIAL_PROVIDER, validateFinancialPagination, validatePersistentFinancialPagination, type FinancialPage, type FinancialPaginationSeen, type PaymentRecord, type StatementRecord, type TiktokFinancialAdapters, type TransactionRecord, upsertLedger } from "./tiktokFinancialLedger";

export interface PipelineDb { query:DbQuery; transaction:<T>(work:(query:DbQuery)=>Promise<T>)=>Promise<T>; }
export interface PipelineScope { workspaceId:string; connectionId:string; }
export interface PipelineWindow { from:Date; to:Date; }
export interface FinancialPipelineInput { db:PipelineDb; adapters:TiktokFinancialAdapters; scope:PipelineScope; window:PipelineWindow; ownerToken:string; paginationSeen?:FinancialPaginationSeen; }
export interface FinancialPipelineResult { acquired:boolean; terminal:boolean; seen:number; written:number; }
interface Cursor { cursor_token:string|null; page_number:number; rows_seen:string|number; rows_written:string|number; }
interface LockedCursor extends Cursor { cursor_hash_history:string[]; }

async function cursor(query:DbQuery,scope:PipelineScope,resource:string,window:PipelineWindow):Promise<Cursor>{
  const rows=await query<Cursor>(`SELECT cursor_token,page_number,rows_seen,rows_written FROM workspace_financial_sync_checkpoints WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3 AND resource=$4 AND window_from=$5 AND window_to=$6`,[scope.workspaceId,TIKTOK_FINANCIAL_PROVIDER,scope.connectionId,resource,window.from,window.to]);
  return rows[0]??{cursor_token:null,page_number:0,rows_seen:0,rows_written:0};
}

async function runPage<T>(input:{db:PipelineDb;scope:PipelineScope;window:PipelineWindow;resource:string;ownerToken:string;paginationSeen?:FinancialPaginationSeen;read:(token:string|undefined)=>Promise<FinancialPage<T>>;write:(query:DbQuery,items:T[])=>Promise<number>}){
  const claimed=await claimCheckpoint(input.db.query,input.scope,input.resource as never,input.window,input.ownerToken);
  if(!claimed.acquired)return {acquired:false,terminal:false,seen:0,written:0};
  const state=await cursor(input.db.query,input.scope,input.resource,input.window);
  const page=await input.read(state.cursor_token??undefined);
  if((page.rejected??0)!==0||(page.unknown??0)!==0||(page.diagnostics?.length??0)!==0)throw new Error("FINANCIAL_PAGE_VALIDATION_FAILED");
  validateFinancialPagination(input.resource,state.cursor_token,page.nextPageToken,input.paginationSeen);
  return input.db.transaction(async query=>{
    const locked=await lockedCursor(query,input.scope,input.resource,input.window,input.ownerToken,claimed.fencingToken);
    validatePersistentFinancialPagination(input.resource,locked.cursor_token,page.nextPageToken,locked.cursor_hash_history);
    const written=await input.write(query,page.items); const seen=Number(state.rows_seen)+page.items.length; const totalWritten=Number(state.rows_written)+written;
    const advanced=await advanceCheckpoint(query,input.scope,input.resource as never,input.window,{ownerToken:input.ownerToken,fencingToken:claimed.fencingToken},{nextPageToken:page.nextPageToken,pageNumber:state.page_number+1,rowsSeen:seen,rowsWritten:totalWritten});
    if(!advanced)throw new Error("FINANCIAL_CHECKPOINT_FENCE_LOST");
    return {acquired:true,terminal:page.nextPageToken===null,seen:page.items.length,written,items:page.items};
  });
}

async function lockedCursor(query:DbQuery,scope:PipelineScope,resource:string,window:PipelineWindow,ownerToken:string,fencingToken:number):Promise<LockedCursor>{
  const rows=await query<LockedCursor>(`SELECT cursor_token,page_number,rows_seen,rows_written,cursor_hash_history FROM workspace_financial_sync_checkpoints WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3 AND resource=$4 AND window_from=$5 AND window_to=$6 AND owner_token=$7 AND fencing_token=$8 AND lease_until>clock_timestamp() FOR UPDATE`,[scope.workspaceId,TIKTOK_FINANCIAL_PROVIDER,scope.connectionId,resource,window.from,window.to,ownerToken,fencingToken]);
  if(!rows[0])throw new Error("FINANCIAL_CHECKPOINT_FENCE_LOST");
  return {...rows[0],cursor_hash_history:rows[0].cursor_hash_history??[]};
}

export async function processFinalStatementTransactions(input:{db:PipelineDb;adapters:TiktokFinancialAdapters;scope:PipelineScope;window:PipelineWindow;ownerToken:string;paginationSeen?:FinancialPaginationSeen;statement:StatementRecord}){
  if(!isFinalStatement(input.statement))return {acquired:false,terminal:false,seen:0,written:0};
  const resource=`statement_transactions:${input.statement.id}`;
  const done=await input.db.query<{completed_at:Date|null}>(`SELECT completed_at FROM workspace_financial_sync_checkpoints WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3 AND resource=$4 AND window_from=$5 AND window_to=$6`,[input.scope.workspaceId,TIKTOK_FINANCIAL_PROVIDER,input.scope.connectionId,resource,input.window.from,input.window.to]);
  if(done[0]?.completed_at)return {acquired:true,terminal:true,seen:0,written:0};
  return runPage<TransactionRecord>({...input,resource,read:token=>input.adapters.transactions(input.statement.id,token),write:(query,records)=>upsertLedger(query,input.scope,records.map(record=>normalizeTransaction(record,{final:true,source:"statement_transactions"})))});
}

export async function processStatementsPage(input:FinancialPipelineInput):Promise<FinancialPipelineResult>{
  const claimed=await claimCheckpoint(input.db.query,input.scope,"statements",input.window,input.ownerToken);
  if(!claimed.acquired)return {acquired:false,terminal:false,seen:0,written:0};
  const state=await cursor(input.db.query,input.scope,"statements",input.window);
  const page=await input.adapters.statements({from:Math.floor(input.window.from.getTime()/1000),to:Math.floor(input.window.to.getTime()/1000),pageToken:state.cursor_token??undefined});
  if((page.rejected??0)!==0||(page.unknown??0)!==0||(page.diagnostics?.length??0)!==0)throw new Error(`FINANCIAL_STATEMENT_STATUS_NOT_FINAL_RETRYABLE:${page.diagnostics.join(",")}`);
  validateFinancialPagination("statements",state.cursor_token,page.nextPageToken,input.paginationSeen);
  // Discovery may cause child-ledger writes. Check the durable history first so
  // an A -> B -> A cycle from a prior scheduler invocation writes nothing.
  await input.db.transaction(async query=>{const locked=await lockedCursor(query,input.scope,"statements",input.window,input.ownerToken,claimed.fencingToken);validatePersistentFinancialPagination("statements",locked.cursor_token,page.nextPageToken,locked.cursor_hash_history);});
  // Each statement has its own checkpoint. A crash before advancing discovery
  // safely replays this page; transaction ids and source precedence make it idempotent.
  let written=0; for(const statement of page.items.filter(isFinalStatement)){const result=await processFinalStatementTransactions({...input,statement});written+=result.written;if(!result.terminal)return{acquired:true,terminal:false,seen:page.items.length,written};}
  return input.db.transaction(async query=>{const locked=await lockedCursor(query,input.scope,"statements",input.window,input.ownerToken,claimed.fencingToken);validatePersistentFinancialPagination("statements",locked.cursor_token,page.nextPageToken,locked.cursor_hash_history);const advanced=await advanceCheckpoint(query,input.scope,"statements",input.window,{ownerToken:input.ownerToken,fencingToken:claimed.fencingToken},{nextPageToken:page.nextPageToken,pageNumber:state.page_number+1,rowsSeen:Number(state.rows_seen)+page.items.length,rowsWritten:Number(state.rows_written)+written});if(!advanced)throw new Error("FINANCIAL_CHECKPOINT_FENCE_LOST");return{acquired:true,terminal:page.nextPageToken===null,seen:page.items.length,written};});
}

export async function processUnsettledPage(input:FinancialPipelineInput):Promise<FinancialPipelineResult>{
  return runPage<TransactionRecord>({...input,resource:"unsettled",read:token=>input.adapters.unsettled({from:Math.floor(input.window.from.getTime()/1000),to:Math.floor(input.window.to.getTime()/1000),pageToken:token}),write:(query,records)=>upsertLedger(query,input.scope,records.map(record=>normalizeTransaction(record,{final:false,source:"unsettled"})))});
}

const stable=(value:unknown)=>JSON.stringify(value,Object.keys(value as object).sort());
export async function processPaymentsPage(input:FinancialPipelineInput):Promise<FinancialPipelineResult>{
  return runPage<PaymentRecord>({...input,resource:"payments",read:token=>input.adapters.payments({from:Math.floor(input.window.from.getTime()/1000),to:Math.floor(input.window.to.getTime()/1000),pageToken:token}),write:async(query,payments)=>{let written=0;for(const p of payments){const hash=crypto.createHash("sha256").update(stable(p.raw)).digest();const rows=await query(`INSERT INTO workspace_financial_payments (workspace_id,provider,connection_id,payment_id,statement_id,status,amount,currency,paid_at,expected_at,is_estimated,source_observed_at,raw_sha256) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),$12) ON CONFLICT (workspace_id,provider,connection_id,payment_id) DO UPDATE SET statement_id=EXCLUDED.statement_id,status=EXCLUDED.status,amount=EXCLUDED.amount,currency=EXCLUDED.currency,paid_at=EXCLUDED.paid_at,expected_at=EXCLUDED.expected_at,is_estimated=EXCLUDED.is_estimated,raw_sha256=EXCLUDED.raw_sha256,updated_at=now() WHERE workspace_financial_payments.raw_sha256<>EXCLUDED.raw_sha256 RETURNING 1`,[input.scope.workspaceId,TIKTOK_FINANCIAL_PROVIDER,input.scope.connectionId,p.id,p.statementId,p.status,p.amount,p.currency,p.paidAt?new Date(p.paidAt*1000):null,p.expectedAt?new Date(p.expectedAt*1000):null,p.paidAt===null,hash]);written+=rows.length;}return written;}});
}

/** Retoma sempre a janela incompleta mais antiga; na ausência dela usa dias UTC
 * fechados e determinísticos. O dia corrente possui identidade própria, mas não
 * é marcado completo antes de fechar; o scheduler financeiro ingere somente
 * `closed` e a leitura corrente permanece parcial. */
export async function selectFinancialWindows(query:DbQuery,scope:PipelineScope,now=new Date()):Promise<{closed:PipelineWindow;current:PipelineWindow}> {
  const incomplete=await query<{window_from:Date;window_to:Date}>(`SELECT window_from,window_to FROM workspace_financial_sync_checkpoints WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3 AND completed_at IS NULL ORDER BY window_from ASC,created_at ASC LIMIT 1`,[scope.workspaceId,TIKTOK_FINANCIAL_PROVIDER,scope.connectionId]);
  const currentFrom=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
  const resumed=incomplete[0]?{from:new Date(incomplete[0].window_from),to:new Date(incomplete[0].window_to)}:null;
  return {closed:resumed??{from:new Date(currentFrom.getTime()-86_400_000),to:currentFrom},current:{from:currentFrom,to:new Date(currentFrom.getTime()+86_400_000)}};
}
