"use client";

import type { ReactNode } from "react";
import { CompositionDonut, type CompositionSlice } from "./CompositionDonut";
import styles from "./FinancialSummaryPanel.module.css";

interface KnownCost {
  id: string;
  label: string;
  value: number | null | undefined;
}

/**
 * Monta a mesma leitura de composição em todos os canais sem transformar
 * lacuna contábil em zero. Quando o resultado ainda não fechou, o saldo entre
 * receita e custos conhecidos vira "Composição pendente", nunca lucro.
 */
export function buildFinancialComposition({
  total,
  costs,
  result,
  resultLabel = "Lucro estimado",
}: {
  total: number;
  costs: KnownCost[];
  result: number | null | undefined;
  resultLabel?: string;
}): CompositionSlice[] {
  const known = costs
    .filter((cost): cost is KnownCost & { value: number } => cost.value != null && Math.abs(cost.value) > 0)
    .map((cost) => ({ id: cost.id, label: cost.label, value: Math.abs(cost.value) }));

  if (result != null) {
    return [
      ...known,
      {
        id: "result",
        label: result < 0 ? "Prejuízo" : resultLabel,
        value: Math.abs(result),
        isRemainder: true,
        isLoss: result < 0,
      },
    ];
  }

  const knownTotal = known.reduce((sum, cost) => sum + cost.value, 0);
  const pending = Math.max(total - knownTotal, 0);
  return pending > 0
    ? [...known, { id: "pending", label: "Composição pendente", value: pending, isPending: true }]
    : known;
}

/** A anatomia financeira canônica dos dashboards de integração. */
export function FinancialSummaryPanel({
  complete,
  description,
  total,
  totalLabel,
  format,
  slices,
  children,
  footer,
  empty,
  labelledBy,
}: {
  complete: boolean;
  description: ReactNode;
  total: number;
  totalLabel: string;
  format: (value: number) => string;
  slices: CompositionSlice[];
  children?: ReactNode;
  footer?: ReactNode;
  empty?: ReactNode;
  labelledBy?: string;
}) {
  const titleId = labelledBy ?? "financial-summary-title";
  return (
    <aside className={`financial-composition ${complete ? "is-complete" : "is-partial"}`} aria-labelledby={titleId}>
      <div>
        <div className={styles.meta}>
          <p className={`${styles.kicker} section-kicker`}>Resumo financeiro</p>
          <span className={`${styles.status} ${complete ? styles.complete : styles.partial}`}>
            <span className={styles.statusDot} aria-hidden="true" />
            {complete ? "Composição completa" : "Composição parcial"}
          </span>
        </div>
        <h2 id={titleId} className="mt-1 text-lg font-semibold text-[var(--ink)]">
          Repasses, taxas e {complete ? "lucro" : "resultado"}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-[var(--ink-muted)]">{description}</p>
      </div>
      {empty ?? (
        <div className="financial-lines">
          {total > 0 && slices.length > 0 ? (
            <CompositionDonut total={total} totalLabel={totalLabel} format={format} slices={slices} />
          ) : null}
          {children}
        </div>
      )}
      {footer}
    </aside>
  );
}
