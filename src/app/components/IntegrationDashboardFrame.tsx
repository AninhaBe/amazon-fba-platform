import type { ReactNode } from "react";
import styles from "./IntegrationDashboardFrame.module.css";

type IntegrationDashboardFrameProps = {
  className?: string;
  period?: ReactNode;
  header: ReactNode;
  children: ReactNode;
};

/**
 * Anatomia compartilhada dos dashboards de canal.
 *
 * O período sempre pertence ao nível global da página, antes do contexto da
 * conta. O conteúdo de cada marketplace continua livre para expressar suas
 * regras, mas não pode mudar a ordem estrutural entre integrações.
 */
export function IntegrationDashboardFrame({
  className = "",
  period,
  header,
  children,
}: IntegrationDashboardFrameProps) {
  return (
    <div className={`${styles.root} integration-dashboard ${className}`.trim()}>
      {period}
      {header}
      {children}
    </div>
  );
}
