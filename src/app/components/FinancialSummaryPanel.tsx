"use client";

import type { ReactNode } from "react";
import { CompositionDonut, type CompositionSlice } from "./CompositionDonut";
// A montagem das fatias mora em `.ts` para poder ser testada chamando —
// ver a nota de cabecalho de `composicaoFinanceira.ts`.
export { buildFinancialComposition } from "./composicaoFinanceira";
import styles from "./FinancialSummaryPanel.module.css";

/** A anatomia financeira canônica dos dashboards de integração. */
export function FinancialSummaryPanel({
  complete,
  semDonut = false,
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
  /**
   * ⚠️ `true` tira a rosquinha DESTE painel porque ela foi montada em
   * outro lugar da tela — nao porque ela deixou de existir. Quem passa isto
   * precisa exibi-la; do contrario, o painel perde a leitura visual sem que
   * ninguem tenha decidido isso.
   */
  semDonut?: boolean;
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
    <aside className={`financial-composition ${complete ? "is-complete" : "is-partial"}`} data-onboarding="financial-summary" aria-labelledby={titleId}>
      <div>
        <div className={styles.meta}>
          <p className={`${styles.kicker} section-kicker`}>Resumo financeiro</p>
          <span className={`${styles.status} ${complete ? styles.complete : styles.partial}`}>
            <span className={styles.statusDot} aria-hidden="true" />
            {complete ? "Composição completa" : "Faltam custos ou repasses"}
          </span>
        </div>
        <h2 id={titleId} className="mt-1 text-lg font-semibold text-[var(--ink)]">
          Repasses, taxas e {complete ? "lucro" : "resultado"}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-[var(--ink-muted)]">{description}</p>
      </div>
      {empty ?? (
        <div className="financial-lines">
          {/* ⚠️ A ROSQUINHA PODE SUBIR PARA A FAIXA DO TOPO — variante
              OPT-IN, criada em 03/09/2026 para o redesenho do dashboard do ML.

              O DEFAULT E O COMPORTAMENTO DE HOJE: sem a prop, a rosquinha fica
              aqui, e Amazon, Shopee e TikTok renderizam exatamente como sempre.
              So o ML passa `semDonut`, e ha guarda provando que os outros tres
              nao passam.

              A alternativa era o ML montar a rosquinha por fora e este painel
              perder a dele — mas isso duplicaria o ponto de montagem e ainda
              mexeria no que os outros veem se alguem errasse a condicao. Uma
              prop com default e a mudanca que NAO alcanca quem nao pediu. */}
          {!semDonut && total > 0 && slices.length > 0 ? (
            <CompositionDonut total={total} totalLabel={totalLabel} format={format} slices={slices} />
          ) : null}
          {children}
        </div>
      )}
      {footer}
    </aside>
  );
}
