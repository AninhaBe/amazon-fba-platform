"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { PanelLoading } from "../../components/LoadingState";
import { PageHeader, pageIcons } from "../../components/PageHeader";
import { SortButton, type SortDir } from "../../components/SortButton";
import { Pagination } from "../../components/Pagination";
import { readJson } from "@/lib/readJson";

const PAGE_SIZE = 30;

interface Listing {
  sku: string;
  asin?: string;
  title?: string;
  price: number | null;
  quantity: number | null;
  status?: string;
  fulfillment?: "fba" | "fbm";
  imageUrl?: string;
  openDate?: string;
}

interface ListingsResponse {
  listings: Listing[];
  total: number;
}

type StatusFilter = "all" | "active" | "inactive" | "incomplete";
type LogisticFilter = "all" | "fba" | "fbm";
type SortCol = "title" | "price" | "stock";

const statusMeta: Record<string, { label: string; cls: string }> = {
  active: { label: "Ativo", cls: "is-active" },
  inactive: { label: "Inativo", cls: "is-inactive" },
  incomplete: { label: "Incompleto", cls: "is-under_review" },
  other: { label: "—", cls: "" },
};

function normStatus(value?: string): "active" | "inactive" | "incomplete" | "other" {
  const v = (value || "").toLowerCase();
  if (v.includes("incomplete")) return "incomplete";
  if (v.includes("inactive")) return "inactive";
  if (v.includes("active")) return "active";
  return "other";
}

function money(value: number | null) {
  return value == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function fmtDate(value?: string): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
}

export default function AmazonCatalogPage() {
  const [data, setData] = useState<ListingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [logistic, setLogistic] = useState<LogisticFilter>("all");
  const [sortCol, setSortCol] = useState<SortCol>("title");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);

  useEffect(() => { setPage(1); }, [query, status, logistic, sortCol, sortDir]);

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir(col === "title" ? "asc" : "desc");
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/amazon/catalog", { cache: "no-store" });
      const body = await readJson(response);
      if (!response.ok) throw new Error(body.error || "Não foi possível carregar os anúncios.");
      setData(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar os anúncios.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const listings = useMemo(() => data?.listings ?? [], [data]);
  const activeCount = listings.filter((l) => normStatus(l.status) === "active").length;
  const fbaCount = listings.filter((l) => l.fulfillment === "fba").length;

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("pt-BR");
    const dir = sortDir === "asc" ? 1 : -1;
    return [...listings]
      .filter((l) => !q || `${l.title || ""} ${l.sku} ${l.asin || ""}`.toLocaleLowerCase("pt-BR").includes(q))
      .filter((l) => status === "all" || normStatus(l.status) === status)
      .filter((l) => logistic === "all" || l.fulfillment === logistic)
      .sort((a, b) => {
        if (sortCol === "price") return ((a.price ?? Number.NEGATIVE_INFINITY) - (b.price ?? Number.NEGATIVE_INFINITY)) * dir;
        if (sortCol === "stock") return ((a.quantity ?? Number.NEGATIVE_INFINITY) - (b.quantity ?? Number.NEGATIVE_INFINITY)) * dir;
        return (a.title || a.sku).localeCompare(b.title || b.sku, "pt-BR") * dir;
      });
  }, [listings, logistic, query, sortCol, sortDir, status]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const paged = visible.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <div className="amazon-listings-page space-y-8">
      <PageHeader
        eyebrow="Catálogo Amazon"
        title="Anúncios"
        subtitle="Seus anúncios publicados na Amazon: preço, estoque, logística (FBA/FBM) e status da conta conectada."
        icon={pageIcons.search}
        action={<button type="button" onClick={() => void load()} disabled={loading} className="listing-refresh">{loading ? "Atualizando…" : "Atualizar anúncios"}</button>}
      />

      {loading && !data ? <PanelLoading label="Carregando anúncios da Amazon" /> : error || !data ? (
        <EmptyState title="Não foi possível carregar os anúncios" description={error || "Conecte sua conta Amazon para visualizar o catálogo publicado."} />
      ) : (
        <>
          <section className="metric-grid grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Resumo dos anúncios">
            <ListingMetric label="Anúncios" value={listings.length} note="no catálogo" />
            <ListingMetric label="Ativos" value={activeCount} note="publicados" />
            <ListingMetric label="FBA" value={fbaCount} note="logística da Amazon" />
            <ListingMetric label="FBM" value={listings.length - fbaCount} note="você envia" />
          </section>

          <section className="listing-controls cols-3" aria-label="Filtros dos anúncios">
            <label className="listing-search"><span className="sr-only">Buscar anúncio</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar título, SKU ou ASIN" /></label>
            <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} aria-label="Filtrar status"><option value="all">Todos os status</option><option value="active">Ativos</option><option value="inactive">Inativos</option><option value="incomplete">Incompletos</option></select>
            <select value={logistic} onChange={(event) => setLogistic(event.target.value as LogisticFilter)} aria-label="Filtrar logística"><option value="all">Toda logística</option><option value="fba">FBA (Amazon envia)</option><option value="fbm">FBM (você envia)</option></select>
          </section>

          <section className="listing-table-shell" aria-labelledby="amz-listing-results">
            <header>
              <div><p className="section-kicker">Catálogo publicado</p><h2 id="amz-listing-results">{visible.length} {visible.length === 1 ? "anúncio encontrado" : "anúncios encontrados"}</h2></div>
              <p>Relatório de anúncios da conta</p>
            </header>
            {visible.length === 0 ? <EmptyState kind="search" title="Nenhum anúncio encontrado" description="Ajuste a busca ou remova algum filtro para ampliar os resultados." /> : (
              <div className="overflow-x-auto">
                <table className="listing-table">
                  <caption className="sr-only">Anúncios publicados na Amazon</caption>
                  <thead><tr><th>Produto</th><th>Status</th><th><SortButton label="Preço" col="price" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} /></th><th><SortButton label="Estoque" col="stock" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} /></th><th>Logística</th><th><span className="sr-only">Ações</span></th></tr></thead>
                  <tbody>{paged.map((l) => {
                    const meta = statusMeta[normStatus(l.status)];
                    return (
                      <tr key={l.sku}>
                        <td><div className="listing-product">
                          {l.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={l.imageUrl} alt="" loading="lazy" />
                          ) : <span className="listing-image-fallback" aria-hidden="true">AMZ</span>}
                          <div><strong title={l.title}>{l.title || l.sku}</strong><small>{`SKU ${l.sku}`}{l.asin ? ` · ${l.asin}` : ""}</small>{fmtDate(l.openDate) && <small>Desde {fmtDate(l.openDate)}</small>}</div>
                        </div></td>
                        <td><span className={`listing-status ${meta.cls}`}>{meta.label}</span></td>
                        <td className="font-semibold tabular-nums">{money(l.price)}</td>
                        <td className="tabular-nums">{l.quantity ?? "—"}</td>
                        <td><span className={`amz-fulfillment is-${l.fulfillment || "na"}`}>{l.fulfillment === "fba" ? "FBA" : l.fulfillment === "fbm" ? "FBM" : "—"}</span></td>
                        <td>{l.asin ? <a href={`https://www.amazon.com.br/dp/${l.asin}`} target="_blank" rel="noreferrer" className="listing-open" aria-label={`Abrir ${l.title || l.sku} na Amazon`} title="Abrir anúncio"><span aria-hidden="true">↗</span></a> : <span className="listing-open is-disabled" aria-hidden="true">—</span>}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
            {pageCount > 1 && <div className="listing-pagination"><Pagination page={current} pageCount={pageCount} total={visible.length} pageSize={PAGE_SIZE} onPage={setPage} /></div>}
          </section>

          <p className="text-xs text-slate-400">O estoque vem do relatório de anúncios; para itens FBA, a quantidade em estoque na Amazon pode aparecer zerada aqui (o estoque FBA é gerenciado pela Amazon) — use o Radar de estoque para a cobertura FBA.</p>
        </>
      )}
    </div>
  );
}

function ListingMetric({ label, value, note }: { label: string; value: number; note: string }) {
  return <article className="metric-cell p-5"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><strong className="mt-3 block text-2xl font-bold tabular-nums text-slate-900">{value.toLocaleString("pt-BR")}</strong><p className="mt-1 text-xs text-slate-500">{note}</p></article>;
}
