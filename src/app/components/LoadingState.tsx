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
