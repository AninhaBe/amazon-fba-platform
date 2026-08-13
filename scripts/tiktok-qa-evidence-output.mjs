export function publicOverview(overview) {
  return {
    orders: overview?.orders ?? 0,
    revenue: overview?.overview?.revenue ?? null,
    fees: overview?.overview?.fees ?? null,
    profit: overview?.overview?.profit ?? null,
    marginPct: overview?.overview?.marginPct ?? null,
    roiPct: overview?.overview?.roiPct ?? null,
    coverage: overview?.coverage ? {
      revenue: overview.coverage.revenue.status,
      fees: overview.coverage.fees.status,
      financials: overview.coverage.financials.status,
    } : null,
  };
}

export function publicCurrentWindow(overview) {
  const sanitized = publicOverview(overview);
  return {
    orders: sanitized.orders,
    revenue: sanitized.revenue,
    coverage: sanitized.coverage ? { revenue: sanitized.coverage.revenue } : null,
  };
}

export function publicConnectionEvidence({ database, overview, dashboardCurrent }) {
  return {
    database,
    historicalCheckpoint: overview,
    currentWindow: publicCurrentWindow(dashboardCurrent),
  };
}

/**
 * O harness valida uma unica conexao exclusivamente owned. Copias da mesma
 * identidade externa em workspaces diferentes sao conflito, nao replicas de QA.
 */
export function selectExclusiveEvidenceCandidate(candidates) {
  if (!candidates.length) throw new Error("EVIDENCE_CONNECTION_NOT_FOUND");
  if (candidates.some((candidate) => Number(candidate.ownership_count) !== 1)) {
    throw new Error("OWNERSHIP_CONFLICT: evidencia bloqueada ate a remediacao do vinculo entre workspaces");
  }
  if (candidates.length !== 1) throw new Error("EVIDENCE_TARGET_AMBIGUOUS");
  return candidates[0];
}
