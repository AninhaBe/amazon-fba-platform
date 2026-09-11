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
  /**
   * ⚠️ ESTA FRASE JA ERROU DE DOIS JEITOS OPOSTOS NO MESMO DIA
   * (10/09/2026), e o registro serve para ninguem tentar um terceiro:
   *
   *   1. `16–22 de 22` — intervalo. Aritmeticamente certo (os itens 16 a 22 sao
   *      sete), mas o primeiro numero de um par le como QUANTIDADE: *"tem 7
   *      aparecendo mas mostra 16, esta errado"*.
   *   2. `7 de 22` — contagem do que esta na tela. Tambem certo, e tambem lido
   *      como defeito: *"eu pedi de 15 em 15, e ta aparecendo 7 ainda"*. O 7 e
   *      o RESTO da ultima pagina, mas ao lado de um pedido de "15 em 15"
   *      qualquer numero diferente de 15 parece falha.
   *
   * A raiz e a mesma nas duas: um numero solto ao lado dos botoes convida a ser
   * lido como "o tamanho da pagina". Dizer PAGINA e TOTAL nao deixa espaco para
   * essa leitura — nem promete um tamanho fixo que a ultima pagina nao cumpre.
   */

  return (
    <nav className="pagination" aria-label="Paginação">
      <span className="pagination-info">Página {page} de {pageCount} · {total} itens</span>
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
