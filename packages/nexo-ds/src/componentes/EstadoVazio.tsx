import type { ReactNode } from "react";

/**
 * ESTADO VAZIO — a tela sem dado mostra o ESTADO REAL, nunca zeros.
 *
 * ⚠️ E a regra mais dura do produto aplicada a um componente: "conecte uma
 * loja" e "sincronizacao pendente" sao coisas diferentes de "voce nao vendeu
 * nada", e cards zerados dizem a terceira quando a verdade e uma das duas.
 *
 * ⚠️ E O TEXTO APONTA O QUE FAZER. Nada de "parcial", "incompleto" ou adjetivo
 * que se desculpa: o titulo diz o estado, a descricao diz o que falta, e a acao
 * leva ao lugar de resolver.
 */
export type TipoDeVazio = "sem-conexao" | "sem-dado" | "sem-resultado" | "erro";

export interface EstadoVazioProps {
  kind?: TipoDeVazio;
  title: string;
  description?: ReactNode;
  /** A frase de ganho — o que a pessoa passa a ver depois de resolver. */
  payoff?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

const ICONES: Record<TipoDeVazio, string> = {
  "sem-conexao": "⚯",
  "sem-dado": "○",
  "sem-resultado": "⌕",
  erro: "!",
};

export function EstadoVazio({ kind = "sem-dado", title, description, payoff, action, compact }: EstadoVazioProps) {
  return (
    <div className={`empty-state empty-state-${kind}${compact ? " is-compact" : ""}`}>
      <span className="empty-state-icon">{ICONES[kind]}</span>
      <div className="empty-state-copy">
        <p className="empty-state-title">{title}</p>
        {description && <p className="empty-state-description">{description}</p>}
        {payoff && <p className="empty-state-payoff">{payoff}</p>}
      </div>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
