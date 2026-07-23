"use client";

function pageWindow(page: number, count: number): (number | "…")[] {
  const out: (number | "…")[] = [];
  for (let n = 1; n <= count; n++) {
    if (n === 1 || n === count || (n >= page - 1 && n <= page + 1)) out.push(n);
    else if (out[out.length - 1] !== "…") out.push("…");
  }
  return out;
}

export function Pagination({ page, pageCount, total, pageSize, onPage }: { page: number; pageCount: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  if (pageCount <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav className="pagination" aria-label="Paginação">
      <span className="pagination-info">{from}–{to} de {total}</span>
      <div className="pagination-controls">
        <button type="button" className="pagination-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior">‹</button>
        {pageWindow(page, pageCount).map((p, index) =>
          p === "…" ? (
            <span key={`gap-${index}`} className="pagination-gap" aria-hidden="true">…</span>
          ) : (
            <button key={p} type="button" className={`pagination-btn${p === page ? " is-current" : ""}`} onClick={() => onPage(p)} aria-current={p === page ? "page" : undefined} aria-label={`Página ${p}`}>{p}</button>
          )
        )}
        <button type="button" className="pagination-btn" disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Próxima página">›</button>
      </div>
    </nav>
  );
}
