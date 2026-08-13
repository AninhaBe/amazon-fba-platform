import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { TiktokFinancialAdapters, isFinalStatement, normalizeTransaction } from "../src/lib/integrations/tiktokFinancialLedger.ts";

const fixture=JSON.parse(await readFile(new URL("./fixtures/tiktok-finance-observed.json",import.meta.url),"utf8"));

test("adapters usam endpoints versionados observados e preservam paginacao",async()=>{
  const calls=[];const adapter=new TiktokFinancialAdapters(async(path,options)=>{calls.push({path,options});return path.endsWith("/statements")?fixture.statements:fixture.statementTransactions;});
  const statements=await adapter.statements({from:1,to:2,pageToken:"p1"});
  assert.equal(statements.items.length,1);assert.equal(isFinalStatement(statements.items[0]),true);
  const transactions=await adapter.transactions("statement-sanitized","cursor");
  assert.match(calls[1].path,/\/finance\/202501\/statements\/.+\/statement_transactions$/);
  assert.equal(calls[1].options.query.page_token,"cursor");assert.equal(transactions.items[0].type,"ORDER");
});

test("custos negativos viram debitos positivos e reconciliam o pai",()=>{
  const adapterRecord={id:"transaction-sanitized",statementId:"statement-sanitized",orderId:"order-sanitized",adjustmentOrderId:null,type:"ORDER",occurredAt:1700000000,currency:"BRL",totals:{revenue:23.90,feeAndTax:-9.13,shippingCost:0,settlement:14.77},raw:fixture.statementTransactions.statement_transactions[0]};
  const row=normalizeTransaction(adapterRecord,{final:true,source:"statement_transactions"});
  assert.equal(row.values.commission,9.13);assert.equal(row.values.seller_shipping,0);
  assert.equal(+(row.values.revenue-row.values.commission-row.values.seller_shipping).toFixed(2),row.values.settlement_amount);
  assert.equal(row.values.ads,undefined);assert.equal(row.values.refunds,undefined);assert.equal(row.values.taxes_withheld,undefined);
});

test("associacoes reais de order e adjustment sao preservadas independentemente",()=>{
  const base={id:"tx",statementId:"s",orderId:"order",adjustmentOrderId:"adjustment-order",type:"LOGISTICS_REIMBURSEMENT",occurredAt:1700000000,currency:"BRL",totals:{revenue:3.25,feeAndTax:null,shippingCost:null,settlement:3.25},raw:{transaction_id:"tx",order_id:"order",adjustment_order_id:"adjustment-order",type:"LOGISTICS_REIMBURSEMENT",order_create_time:1700000000,currency:"BRL"}};
  const final=normalizeTransaction(base,{final:true,source:"statement_transactions"});
  assert.equal(final.orderId,"order");assert.equal(final.adjustmentOrderId,"adjustment-order");
  assert.equal(final.values.revenue,null,"reembolso logistico nao infla revenue oficial");
  assert.equal(final.values.adjustment,3.25,"sinal observado fica exclusivamente em adjustment");
  assert.equal(final.values.adjustment-final.values.commission-final.values.seller_shipping,final.values.settlement_amount,"adjustment - debitos reconcilia settlement sem dupla contagem");
  const orphan=normalizeTransaction({...base,id:"orphan",orderId:null,adjustmentOrderId:null},{final:true,source:"statement_transactions"});
  assert.equal(orphan.orderId,null);assert.equal(orphan.adjustmentOrderId,null);
});

// Este teste exigia o oposto ate 13/08/2026: token vazio lancava
// INVALID_EMPTY_PAGE_TOKEN_RETRYABLE para "falhar fechado na ambiguidade". A premissa
// estava errada — a OAS descreve next_page_token como o valor a usar "se a resposta
// atual nao retornou todos os resultados", entao na ultima pagina ele volta vazio. Nao
// e anomalia, e o fim normal. Com a trava, toda paginacao completa falhava no fim, que
// e sempre. Confirmado em producao: o erro sucedeu o 36009004 assim que os parametros
// foram corrigidos. A protecao contra janela marcada completa por engano continua
// existindo no checkpoint (cursor_hash_history + terminal_cursor).
test("page_token vazio, em branco ou nulo encerra a paginacao nos quatro recursos",async()=>{
  const payloads={statements:{statements:[],next_page_token:" "},transactions:{statement_transactions:[],next_page_token:""},payments:{payments:[],next_page_token:null},unsettled:{orders:[],nextPageToken:""}};
  const adapter=new TiktokFinancialAdapters(async path=>path.endsWith("/statements")?payloads.statements:path.includes("statement_transactions")?payloads.transactions:path.endsWith("/payments")?payloads.payments:payloads.unsettled);
  assert.equal((await adapter.statements({from:1,to:2})).nextPageToken,null);
  assert.equal((await adapter.transactions("s")).nextPageToken,null);
  assert.equal((await adapter.payments({from:1,to:2})).nextPageToken,null);
  assert.equal((await adapter.unsettled({from:1,to:2})).nextPageToken,null);
});

test("statement pending e status desconhecido geram diagnostico fail-closed",async()=>{
  const adapter=new TiktokFinancialAdapters(async()=>({statements:[
    {statement_id:"pending",status:"PENDING",currency:"BRL"},
    {statement_id:"future",status:"NEW_PROVIDER_STATUS",currency:"BRL"},
  ]}));
  const result=await adapter.statements({from:1,to:2});
  assert.equal(result.unknown,1);
  assert.deepEqual(result.diagnostics,["statement:pending:status:PENDING","statement:future:status:NEW_PROVIDER_STATUS"]);
  assert.equal(result.items.some(isFinalStatement),false);
});

test("registro invalido falha a pagina inteira e tipo presumido nao e aceito",async()=>{
  const adapter=new TiktokFinancialAdapters(async()=>({statement_transactions:[{transaction_id:"",type:"ORDER",order_create_time:1700000000,currency:"BRL"}]}));
  await assert.rejects(()=>adapter.transactions("s"),/sem identificador/);
  assert.throws(()=>normalizeTransaction({id:"x",statementId:"s",orderId:null,adjustmentOrderId:null,type:"COMMISSION_FEE",occurredAt:1700000000,currency:"BRL",totals:{revenue:null,feeAndTax:-1,shippingCost:null,settlement:null},raw:{}},{final:true,source:"statement_transactions"}),/sem diagnostico/);
});

test("payment e estimate tem identidades/fontes separadas; estimate nunca vira final",async()=>{
  const adapter=new TiktokFinancialAdapters(async(path)=>path.endsWith("/payments")?fixture.payments:fixture.unsettled);
  const payment=(await adapter.payments({from:1,to:2})).items[0];const estimate=(await adapter.unsettled({from:1,to:2})).items[0];
  assert.notEqual(payment.id,estimate.id);const row=normalizeTransaction(estimate,{final:false,source:"unsettled"});
  assert.equal(row.estimated,true);assert.equal(row.settlementState,"unsettled");assert.equal(row.sourceRank,10);
});
