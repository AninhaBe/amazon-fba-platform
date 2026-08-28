import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// R2 da frente L (ADR-026, regra 2): liquidação e evidência financeira saem de
// raw._sellercore e viram colunas de workspace_channel_orders. Nesta fase os
// ESCRITORES só escrevem colunas e os LEITORES leem coluna COM fallback ao raw
// (linhas antigas, até o backfill) — a mesma ordem anti-corrida do A5.

test("a migration 0014 cria as oito colunas de liquidação", async () => {
  const sql = await readFile(new URL("../migrations/0014_liquidacao_em_colunas.sql", import.meta.url), "utf8");
  for (const coluna of [
    "financial_settled", "settlement_attempt_at", "settlement_outcome",
    "evidence_fees", "evidence_seller_shipping", "evidence_ads",
    "evidence_taxes_withheld", "evidence_refunds",
  ]) {
    assert.match(sql, new RegExp(coluna), `migration sem a coluna ${coluna}`);
  }
  assert.match(sql, /ADD COLUMN IF NOT EXISTS/);
});

test("escritores gravam colunas: escrow da Shopee, statement e backoff do TikTok, seed da demo", async () => {
  const shopee = await readFile(new URL("../src/lib/integrations/shopeeSync.ts", import.meta.url), "utf8");
  assert.match(shopee, /SET financial_settled = true,\s*\n\s*evidence_fees = \$5/);
  const tiktok = await readFile(new URL("../src/lib/integrations/tiktokSync.ts", import.meta.url), "utf8");
  assert.match(tiktok, /SET financial_settled = true,\s*\n\s*evidence_fees = \$5/);
  assert.match(tiktok, /SET settlement_attempt_at = clock_timestamp\(\), settlement_outcome = \$5/);
  const seed = await readFile(new URL("../scripts/_demo-seed.mjs", import.meta.url), "utf8");
  assert.match(seed, /SET financial_settled = true/);
  assert.doesNotMatch(seed, /jsonb_build_object\('_sellercore'/, "o seed voltou a escrever estado no raw");
});

test("leitores usam coluna com fallback ao raw durante a transição", async () => {
  const leitores = [
    ["../src/lib/integrations/shopeeOverviewCanonical.ts", /financial_settled\s*\n?\s*OR COALESCE\(.*shopeeEscrowSettled/s],
    ["../src/lib/integrations/tiktokOverviewCanonical.ts", /o\.financial_settled OR COALESCE\(\(o\.raw #>> '\{_sellercore,statementSettled\}'/],
    ["../src/lib/integrations/tiktokModules.ts", /s\.financial_settled OR COALESCE\(\(s\.raw/],
    ["../src/app/api/integrations/tiktok/auditoria/route.ts", /o\.financial_settled OR COALESCE\(\(o\.raw/],
    ["../src/lib/integrations/shopeeSync.ts", /o\.financial_settled\s*\n?\s*OR COALESCE\(\(o\.raw #>> '\{_sellercore,shopeeEscrowSettled\}'/s],
    ["../src/lib/integrations/tiktokSync.ts", /o\.financial_settled\s*\n?\s*OR COALESCE\(\(o\.raw #>> '\{_sellercore,statementSettled\}'/s],
  ];
  for (const [arquivo, padrao] of leitores) {
    const fonte = await readFile(new URL(arquivo, import.meta.url), "utf8");
    assert.match(fonte, padrao, `${arquivo} perdeu a leitura coluna-primeiro com fallback`);
  }
});

test("o backoff de statement do TikTok lê a coluna com fallback e não escreve mais no raw", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/tiktokSync.ts", import.meta.url), "utf8");
  assert.match(fonte, /COALESCE\(o\.settlement_attempt_at,\s*\n?\s*NULLIF\(o\.raw #>> '\{_sellercore,statementLastAttemptAt\}'/);
  assert.doesNotMatch(fonte, /statementLastAttemptAt', clock_timestamp\(\)/);
});
