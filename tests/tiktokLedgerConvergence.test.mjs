import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { blockedTiktokLedgerSnapshot, checkpointsCoverPeriod, readTiktokLedgerSnapshot } from "../src/lib/integrations/tiktokFinancialLedger.ts";

test("janelas terminais contiguas cobrem periodo fechado",()=>{
  const now=new Date("2026-08-11T12:00:00Z");
  const rows=[
    {window_from:"2026-08-09T00:00:00Z",window_to:"2026-08-10T00:00:00Z",completed_at:"2026-08-10T01:00:00Z",terminal_cursor:true},
    {window_from:"2026-08-10T00:00:00Z",window_to:"2026-08-11T00:00:00Z",completed_at:"2026-08-11T01:00:00Z",terminal_cursor:true},
  ];
  assert.equal(checkpointsCoverPeriod(rows,new Date("2026-08-09T00:00:00Z"),new Date("2026-08-11T00:00:00Z"),now),true);
  assert.equal(checkpointsCoverPeriod(rows,new Date("2026-08-09T00:00:00Z"),new Date("2026-08-10T12:00:00Z"),new Date("2026-08-10T13:00:00Z")),false,"periodo que inclui current-day nunca fecha");
});

test("overview e financeiro consomem a mesma autoridade statement-ledger",async()=>{
  const [overview,finance]=await Promise.all([
    readFile(new URL("../src/lib/integrations/tiktokOverviewCanonical.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/lib/integrations/tiktokModules.ts",import.meta.url),"utf8"),
  ]);
  assert.match(overview,/readTiktokLedgerSnapshot/);
  assert.match(finance,/getTiktokOverviewFromCanonical/);
  assert.match(overview,/financialSnapshot=ledgerSnapshot\?\?blockedTiktokLedgerSnapshot/);
  assert.match(finance,/coverage:canonical\.financialCoverage,overview:canonical\.overview/);
});

test("current-day brasileiro e checkpoint com rejeicao permanecem parciais",()=>{
  const row={window_from:"2026-08-10T03:00:00Z",window_to:"2026-08-11T03:00:00Z",completed_at:"2026-08-11T04:00:00Z",terminal_cursor:true,error_count:0};
  assert.equal(checkpointsCoverPeriod([row],new Date(row.window_from),new Date(row.window_to),new Date("2026-08-11T12:00:00Z")),true);
  assert.equal(checkpointsCoverPeriod([{...row,error_count:1}],new Date(row.window_from),new Date(row.window_to),new Date("2026-08-11T12:00:00Z")),false);
  assert.equal(checkpointsCoverPeriod([row],new Date("2026-08-11T03:00:00Z"),new Date("2026-08-11T12:00:00Z"),new Date("2026-08-11T12:00:00Z")),false);
});

test("schema bloqueado preserva receita operacional sem estimar componentes",()=>{
  const snapshot=blockedTiktokLedgerSnapshot({from:new Date("2026-08-01T03:00:00Z"),to:new Date("2026-08-02T02:59:59Z")},{revenue:42.5,currency:"BRL"});
  assert.equal(snapshot.coverage.status,"blocked");
  assert.equal(snapshot.aggregate.revenue,42.5);
  assert.equal(snapshot.aggregate.fees,null);
  assert.equal(snapshot.coverage.estimatesIncluded,false);
});

test("statement final substitui fallback sem somar duas vezes",async()=>{
  const query=async sql=>{
    if(sql.includes("GROUP BY currency"))return[{currency:"BRL",final_count:"2",estimated_count:"1",revenue:"23.90",buyer_shipping:null,seller_shipping:"0",commission:"9.13",payment_fee:null,fulfillment_fee:null,ads:null,taxes_withheld:null,refunds:null,adjustments:null}];
    if(sql.includes("workspace_financial_sync_checkpoints"))return[{window_from:new Date("2026-08-09T00:00:00Z"),window_to:new Date("2026-08-10T00:00:00Z"),completed_at:new Date("2026-08-10T01:00:00Z"),terminal_cursor:true}];
    return[{currency:"BRL",revenue:"999.00",buyer_shipping:"0",fees:"99",seller_shipping:"0"}];
  };
  const snapshot=await readTiktokLedgerSnapshot(query,{workspaceId:"w",connectionId:"c",from:new Date("2026-08-09T00:00:00Z"),to:new Date("2026-08-10T00:00:00Z")},new Date("2026-08-11T00:00:00Z"));
  assert.equal(snapshot.authority,"statement_ledger");assert.equal(snapshot.aggregate.revenue,23.9);assert.equal(snapshot.aggregate.fees,9.13);
});
