export function TableLoading({ label = "Carregando dados" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="table-loading">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((row) => (
        <span key={row} aria-hidden="true" className="table-loading-row">
          <i />
          <i />
          <i />
        </span>
      ))}
    </div>
  );
}

export function PanelLoading({ label = "Carregando dados" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="panel-loading">
      <span className="sr-only">{label}</span>
      <i aria-hidden="true" />
      <i aria-hidden="true" />
      <i aria-hidden="true" />
    </div>
  );
}

// Esqueleto com a estrutura real do dashboard (KPIs, gráfico, tabela): a
// página aparece "montada" desde o primeiro paint e os dados só preenchem —
// sem salto de layout quando chegam.
export function DashboardSkeleton({ label = "Carregando dados", chart = true, rows = 4 }: { label?: string; chart?: boolean; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="dashboard-skeleton">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="skeleton-kpis">
        {[0, 1, 2, 3].map((cell) => (
          <span key={cell} className="skeleton-cell"><i style={{ width: "56%" }} /><i className="is-strong" style={{ width: "72%" }} /><i style={{ width: "44%" }} /></span>
        ))}
      </div>
      {chart && (
        <div aria-hidden="true" className="skeleton-panel">
          <i style={{ width: "34%" }} />
          <span className="skeleton-chart" />
        </div>
      )}
      <div aria-hidden="true" className="skeleton-table">
        {Array.from({ length: rows }, (_, row) => (
          <span key={row} className="table-loading-row"><i /><i /><i /></span>
        ))}
      </div>
    </div>
  );
}

export function InlineLoading({ label = "Carregando dados" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="inline-loading">
      <span className="sr-only">{label}</span>
      <i aria-hidden="true" />
      <i aria-hidden="true" />
      <i aria-hidden="true" />
    </div>
  );
}
