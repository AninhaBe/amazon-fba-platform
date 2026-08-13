import test from "node:test";
import assert from "node:assert/strict";
import {
  publicConnectionEvidence,
  publicCurrentWindow,
  publicOverview,
  selectExclusiveEvidenceCandidate,
} from "../scripts/tiktok-qa-evidence-output.mjs";

test("evidencia distingue checkpoint historico da janela corrente", () => {
  const historicalCheckpoint = publicOverview({
    orders: 12,
    overview: { revenue: 345.67 },
    coverage: {
      revenue: { status: "complete" },
      fees: { status: "pending" },
      financials: { status: "pending" },
    },
  });
  const dashboardCurrent = {
    orders: 13,
    overview: { revenue: 400.01, secret: "nao pode sair" },
    coverage: {
      revenue: { status: "partial", details: { shopId: "sensitive" } },
      fees: { status: "pending" },
      financials: { status: "pending" },
    },
    ordersPayload: [{ buyer: "PII" }],
  };

  assert.deepEqual(publicConnectionEvidence({ database: { allOrders: 13 }, overview: historicalCheckpoint, dashboardCurrent }), {
    database: { allOrders: 13 },
    historicalCheckpoint,
    currentWindow: { orders: 13, revenue: 400.01, coverage: { revenue: "partial" } },
  });
});

test("evidencia bloqueia ownership duplicado sem expor identificadores", () => {
  assert.throws(
    () => selectExclusiveEvidenceCandidate([
      { workspace_id: "workspace-sensitive-a", shop_id: "shop-sensitive", ownership_count: 2 },
      { workspace_id: "workspace-sensitive-b", shop_id: "shop-sensitive", ownership_count: 2 },
    ]),
    (error) => error.message.startsWith("OWNERSHIP_CONFLICT:")
      && !error.message.includes("workspace-sensitive")
      && !error.message.includes("shop-sensitive"),
  );
});

test("evidencia aceita somente uma conexao com owner exclusivo", () => {
  const candidate = { workspace_id: "workspace", shop_id: "shop", ownership_count: 1 };
  assert.equal(selectExclusiveEvidenceCandidate([candidate]), candidate);
  assert.throws(
    () => selectExclusiveEvidenceCandidate([candidate, { ...candidate, shop_id: "other" }]),
    /EVIDENCE_TARGET_AMBIGUOUS/,
  );
});

test("valores financeiros ausentes permanecem null, nunca zero", () => {
  assert.deepEqual(publicOverview({ orders: 0 }), {
    orders: 0,
    revenue: null,
    fees: null,
    profit: null,
    marginPct: null,
    roiPct: null,
    coverage: null,
  });
  assert.deepEqual(publicCurrentWindow({ orders: 0 }), {
    orders: 0,
    revenue: null,
    coverage: null,
  });
});
