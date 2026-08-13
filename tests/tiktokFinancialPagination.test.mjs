import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FINANCIAL_CURSOR_HASH_LIMIT, financialCursorHash, validateFinancialPagination, validatePersistentFinancialPagination } from "../src/lib/integrations/tiktokFinancialLedger.ts";

test("cursor next igual ao atual e rejeitado antes de escrita/checkpoint",async()=>{
  assert.throws(()=>validateFinancialPagination("payments","cursor","cursor",new Map()),/REPEATED_PAGE_TOKEN_RETRYABLE/);
});

test("historico persistente detecta A -> B -> A entre execucoes sem guardar tokens",()=>{
  const afterA=validatePersistentFinancialPagination("payments",null,"A",[]);
  const afterB=validatePersistentFinancialPagination("payments","A","B",afterA);
  assert.throws(()=>validatePersistentFinancialPagination("payments","B","A",afterB),/REPEATED_PAGE_TOKEN_RETRYABLE/);
  assert.equal(afterB.length,2);
  assert.ok(afterB.every(value=>value.length===32));
  assert.ok(afterB.some(value=>value.equals(financialCursorHash("A"))));
  assert.ok(afterB.every(value=>value.toString("utf8")!=="A"&&value.toString("utf8")!=="B"));
});

test("limite bounded falha fechado antes de aceitar cursor adicional",()=>{
  const full=Array.from({length:FINANCIAL_CURSOR_HASH_LIMIT},(_,index)=>financialCursorHash(`token-${index}`));
  assert.throws(()=>validatePersistentFinancialPagination("unsettled",null,"overflow",full),/CURSOR_HASH_HISTORY_OVERFLOW/);
  assert.throws(()=>validatePersistentFinancialPagination("statements",null,null,[...full,financialCursorHash("extra")]),/CURSOR_HASH_HISTORY_OVERFLOW/);
});

test("checkpoint faz guarda de repeticao, overflow e fence na mesma atualizacao",async()=>{
  const migration=await readFile(new URL("../migrations/0005_workspace_financial_ledger.sql",import.meta.url),"utf8");
  const fn=migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION financial_checkpoint_advance"),migration.indexOf("REVOKE ALL ON TABLE"));
  assert.match(fn,/owner_token=p_owner_token[\s\S]*fencing_token=p_fencing_token[\s\S]*lease_until > clock_timestamp\(\)/);
  assert.match(fn,/jsonb_array_length\(cursor_hash_history\) < 256/);
  assert.match(fn,/NOT cursor_hash_history @> jsonb_build_array\(encode\(p_cursor_sha256, 'hex'\)\)/);
  assert.match(fn,/cursor_hash_history\s*=.*encode\(p_cursor_sha256, 'hex'\)/s);
});

test("store falha fechado quando o fence e perdido e nao envia historico ao SQL",async()=>{
  const ledger=await readFile(new URL("../src/lib/integrations/tiktokFinancialLedger.ts",import.meta.url),"utf8");
  const pipeline=await readFile(new URL("../src/lib/integrations/tiktokFinancialPipeline.ts",import.meta.url),"utf8");
  assert.match(pipeline,/if\(!advanced\)throw new Error\("FINANCIAL_CHECKPOINT_FENCE_LOST"\)/);
  assert.match(pipeline,/owner_token=\$7 AND fencing_token=\$8 AND lease_until>clock_timestamp\(\) FOR UPDATE/);
  assert.doesNotMatch(ledger,/seenCursorHashes/);
  assert.match(ledger,/cursorHash=page\.nextPageToken===null\?null:financialCursorHash\(page\.nextPageToken\)/);
});

test("cursor ja visto na execucao e rejeitado e statements nao finais nao avancam",async()=>{
  const seen=new Map([["payments",new Set(["old"])]]);
  assert.throws(()=>validateFinancialPagination("payments","current","old",seen),/REPEATED_PAGE_TOKEN_RETRYABLE/);
  const source=await readFile(new URL("../src/lib/integrations/tiktokFinancialPipeline.ts",import.meta.url),"utf8");
  assert.match(source,/FINANCIAL_STATEMENT_STATUS_NOT_FINAL_RETRYABLE/);
  assert.ok(source.indexOf("STATUS_NOT_FINAL_RETRYABLE")<source.indexOf('validateFinancialPagination("statements"'),"status e validado antes de cursor/escrita/checkpoint");
});
