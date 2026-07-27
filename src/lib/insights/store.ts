import { dbQuery } from "../db";
import { optionalWorkspaceId } from "../workspaceScope";
import type { Insight, InsightCandidate, InsightStatus } from "./types";

// Persistência dos insights por workspace, com reconciliação por fingerprint:
// um problema em curso é UMA linha atualizada (preserva detected_at e o status),
// nunca um item novo repetido todo dia.

interface Row {
  id: string;
  type: string;
  provider: string;
  entity_ref: string | null;
  severity: number;
  title: string;
  evidence: unknown;
  impact: unknown;
  recommendation: string | null;
  action_href: string | null;
  status: InsightStatus;
  detected_at: string;
  updated_at: string;
  snoozed_until: string | null;
}

function toInsight(r: Row): Insight {
  return {
    id: r.id,
    type: r.type,
    provider: r.provider,
    entityRef: r.entity_ref ?? undefined,
    severity: r.severity,
    title: r.title,
    evidence: (r.evidence ?? {}) as Record<string, unknown>,
    impact: (r.impact ?? {}) as Record<string, unknown>,
    recommendation: r.recommendation ?? undefined,
    actionHref: r.action_href ?? undefined,
    status: r.status,
    detectedAt: r.detected_at,
    updatedAt: r.updated_at,
    snoozedUntil: r.snoozed_until,
  };
}

async function insertNew(ws: string, c: InsightCandidate) {
  await dbQuery(
    `INSERT INTO workspace_insights
       (workspace_id,id,type,provider,entity_ref,severity,title,evidence,impact,recommendation,action_href,status,detected_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,'novo',now(),now())`,
    [ws, c.id, c.type, c.provider, c.entityRef ?? null, c.severity, c.title, JSON.stringify(c.evidence), JSON.stringify(c.impact), c.recommendation ?? null, c.actionHref ?? null]
  );
}

async function updateExisting(ws: string, c: InsightCandidate, status: InsightStatus, resetDetected: boolean) {
  await dbQuery(
    `UPDATE workspace_insights SET
       severity=$3, title=$4, evidence=$5::jsonb, impact=$6::jsonb, recommendation=$7, action_href=$8, status=$9, updated_at=now()${
         resetDetected ? ", detected_at=now(), snoozed_until=NULL" : ""
       }
     WHERE workspace_id=$1 AND id=$2`,
    [ws, c.id, c.severity, c.title, JSON.stringify(c.evidence), JSON.stringify(c.impact), c.recommendation ?? null, c.actionHref ?? null, status]
  );
}

/**
 * Reconcilia os candidatos frescos com o que já está gravado:
 * - novo → insere; ainda válido → atualiza (mantém status/detected_at);
 * - sumiu (dos tipos que rodaram) → auto-resolve;
 * - dispensado/adiado/resolvido só reabrem se piorou de severidade.
 */
export async function reconcile(candidates: InsightCandidate[], ranTypes: string[]): Promise<void> {
  const ws = optionalWorkspaceId();
  if (!ws) return;
  const existing = await dbQuery<Row>(`SELECT * FROM workspace_insights WHERE workspace_id=$1`, [ws]);
  const byId = new Map(existing.map((r) => [r.id, r]));
  const candIds = new Set(candidates.map((c) => c.id));

  for (const c of candidates) {
    const ex = byId.get(c.id);
    if (!ex) {
      await insertNew(ws, c);
      continue;
    }
    const worse = c.severity > ex.severity;
    let status: InsightStatus = ex.status;
    let reset = false;
    if (ex.status === "resolvido") {
      status = "novo";
      reset = true; // voltou a valer depois de resolvido → é um novo episódio
    } else if ((ex.status === "dispensado" || ex.status === "adiado") && worse) {
      status = "novo";
      reset = true; // silenciado, mas piorou de faixa → reabre
    }
    await updateExisting(ws, c, status, reset);
  }

  // Auto-resolve: abertos dos tipos que rodaram e não apareceram mais.
  const gone = existing.filter(
    (r) => ranTypes.includes(r.type) && !candIds.has(r.id) && (r.status === "novo" || r.status === "adiado")
  );
  for (const r of gone) {
    await dbQuery(`UPDATE workspace_insights SET status='resolvido', updated_at=now() WHERE workspace_id=$1 AND id=$2`, [ws, r.id]);
  }
}

// Insights que aparecem no briefing: novos + adiados cujo prazo já passou.
export async function listOpen(): Promise<Insight[]> {
  const ws = optionalWorkspaceId();
  if (!ws) return [];
  const rows = await dbQuery<Row>(
    `SELECT * FROM workspace_insights
      WHERE workspace_id=$1
        AND (status='novo' OR (status='adiado' AND (snoozed_until IS NULL OR snoozed_until <= now())))
      ORDER BY severity DESC, detected_at ASC`,
    [ws]
  );
  return rows.map(toInsight);
}

export async function setStatus(id: string, status: InsightStatus, snoozeDays = 3): Promise<void> {
  const ws = optionalWorkspaceId();
  if (!ws) return;
  if (status === "adiado") {
    await dbQuery(
      `UPDATE workspace_insights SET status='adiado', snoozed_until = now() + ($3 || ' days')::interval, updated_at=now()
        WHERE workspace_id=$1 AND id=$2`,
      [ws, id, String(Math.max(1, Math.min(30, snoozeDays)))]
    );
  } else {
    await dbQuery(
      `UPDATE workspace_insights SET status=$3, snoozed_until=NULL, updated_at=now() WHERE workspace_id=$1 AND id=$2`,
      [ws, id, status]
    );
  }
}
