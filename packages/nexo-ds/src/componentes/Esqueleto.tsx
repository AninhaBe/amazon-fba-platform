/**
 * ESQUELETO — o carregamento com a FORMA do que vem, nao um spinner.
 *
 * ⚠️ A DIFERENCA NAO E ESTETICA. Um spinner diz "espere"; o esqueleto diz "vem
 * uma regua de quatro KPIs, um grafico e uma tabela". A tela para de saltar
 * quando o dado chega, porque o espaco ja estava reservado — e a pessoa comeca
 * a ler a estrutura antes do numero existir.
 *
 * O rotulo vai para o leitor de tela; as barras sao `aria-hidden`, senao ele
 * anunciaria uma dezena de elementos vazios.
 */
export interface EsqueletoProps {
  label?: string;
  /** Reserva o espaco do grafico. Telas sem grafico passam `false`. */
  chart?: boolean;
  /** Quantas linhas de tabela reservar. */
  rows?: number;
}

export function Esqueleto({ label = "Carregando dados", chart = true, rows = 4 }: EsqueletoProps) {
  return (
    <div role="status" aria-live="polite" className="dashboard-skeleton">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="skeleton-kpis">
        {[0, 1, 2, 3].map((celula) => (
          <span key={celula} className="skeleton-cell">
            <i style={{ width: "56%" }} />
            <i className="is-strong" style={{ width: "72%" }} />
            <i style={{ width: "44%" }} />
          </span>
        ))}
      </div>
      {chart && (
        <div aria-hidden="true" className="skeleton-panel">
          <i style={{ width: "34%" }} />
          <span className="skeleton-chart" />
        </div>
      )}
      <div aria-hidden="true" className="skeleton-table">
        {Array.from({ length: rows }, (_, linha) => (
          <span key={linha} className="table-loading-row"><i /><i /><i /></span>
        ))}
      </div>
    </div>
  );
}
