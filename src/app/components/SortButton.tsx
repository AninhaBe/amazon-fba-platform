"use client";

export type SortDir = "asc" | "desc";

// Cabeçalho de coluna clicável com setinhas ↑↓ (ordena crescente/decrescente).
export function SortButton<T extends string>({ label, col, sortCol, sortDir, onSort }: { label: string; col: T; sortCol: T; sortDir: SortDir; onSort: (col: T) => void }) {
  const active = sortCol === col;
  return (
    <button
      type="button"
      className={`th-sort${active ? " is-active" : ""}`}
      onClick={() => onSort(col)}
      aria-label={`Ordenar por ${label}${active ? (sortDir === "asc" ? " (crescente)" : " (decrescente)") : ""}`}
    >
      {label}
      <span className="sort-arrows" aria-hidden="true">
        <i className={active && sortDir === "asc" ? "is-on" : ""}>▲</i>
        <i className={active && sortDir === "desc" ? "is-on" : ""}>▼</i>
      </span>
    </button>
  );
}
