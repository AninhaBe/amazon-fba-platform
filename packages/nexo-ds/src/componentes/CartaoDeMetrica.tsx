import type { ReactNode } from "react";

/**
 * CARTAO DE METRICA — a unidade da regua de KPIs.
 *
 * ⚠️ A EXPLICACAO VAI NO `i`, NAO EMBAIXO DO NUMERO. Decisao dela em
 * 24/08/2026, verbatim: *"todos esses textos que estao embaixo... pode colocar
 * no i"*. Texto solto embaixo do numero empilhava tres alturas diferentes na
 * mesma regua e fazia a faixa inteira crescer pelo cartao mais falante.
 *
 * ⚠️ E VALOR DESCONHECIDO CHEGA COMO "—", nunca como 0 formatado. A peca nao
 * decide isso: quem monta a tela e que sabe se o zero e fato ou ausencia.
 */
export type TomDaMetrica = "default" | "positive" | "warn" | "danger";

export interface CartaoDeMetricaProps {
  label: string;
  /** Ja formatado: "R$ 1.284,90", "12,6%", "—". */
  value: ReactNode;
  /** Linha secundaria curta ("53 aprovadas + 2 canceladas"). */
  sub?: ReactNode;
  /** Texto do `i`: a explicacao que nao cabe embaixo do numero. */
  info?: string;
  tone?: TomDaMetrica;
  loading?: boolean;
  /** Indicador de tendencia opcional, montado por quem chama. */
  trend?: ReactNode;
}

function DicaDaMetrica({ texto }: { texto: string }) {
  return (
    <span className="metric-info" tabIndex={0} role="note" aria-label={texto} data-dica={texto}>
      <span aria-hidden="true">i</span>
    </span>
  );
}

export function CartaoDeMetrica({ label, value, sub, info, tone = "default", loading, trend }: CartaoDeMetricaProps) {
  return (
    <div className={`compact-metric compact-metric-${tone}`} aria-busy={loading || undefined}>
      <p>{label}{info ? <DicaDaMetrica texto={info} /> : null}</p>
      <strong>{value}</strong>
      {sub ? <small>{sub}</small> : null}
      {trend}
    </div>
  );
}

/** A regua: os cartoes lado a lado, com a divisao de 1px entre eles. */
export function ReguaDeMetricas({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return <section className="metric-grid" aria-label={rotulo}>{children}</section>;
}
