import type { ReactNode } from "react";

type EmptyStateKind = "data" | "search" | "permission" | "success";

const icons: Record<EmptyStateKind, ReactNode> = {
  data: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M4 18V9m5 9V5m5 13v-6m5 6V8" strokeLinecap="round" />
      <path d="M3 21h18" strokeLinecap="round" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" strokeLinecap="round" />
      <path d="M8 10.5h5" strokeLinecap="round" />
    </svg>
  ),
  permission: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  success: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16.5 8.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

/**
 * Estado vazio.
 *
 * `description` diz o que **está faltando**. `payoff` diz o que a pessoa
 * **ganha** ao resolver — e é essa segunda metade que decide se ela resolve
 * ou fecha a aba.
 *
 * A separação existe porque, sem ela, quase toda chamada escrevia só a
 * primeira: "nenhum produto com custo cadastrado". Verdadeiro e inútil. O que
 * move é "cadastre o custo e o lucro por SKU aparece aqui e na curva ABC" — a
 * pessoa passa a saber o que está comprando com aquele trabalho.
 *
 * É a segunda metade da regra que o produto já tem: "tela sem dado mostra o
 * estado real". Mostrar o estado real é o mínimo; dizer o que muda quando ele
 * deixar de ser esse é o que faltava.
 */
export function EmptyState({
  title,
  description,
  payoff,
  action,
  kind = "data",
  compact = false,
}: {
  title: string;
  /** O que está faltando hoje. */
  description?: ReactNode;
  /** O que aparece aqui depois que a pendência for resolvida. */
  payoff?: ReactNode;
  action?: ReactNode;
  kind?: EmptyStateKind;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state empty-state-${kind}${compact ? " is-compact" : ""}`}>
      <span className="empty-state-icon">{icons[kind]}</span>
      <div className="empty-state-copy">
        <p className="empty-state-title">{title}</p>
        {description && <p className="empty-state-description">{description}</p>}
        {payoff && <p className="empty-state-payoff">{payoff}</p>}
      </div>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
