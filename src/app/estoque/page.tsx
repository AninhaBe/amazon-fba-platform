"use client";

import { useEffect, useState } from "react";
import { PageHeader, pageIcons } from "../components/PageHeader";
import { TableLoading } from "../components/LoadingState";
import { EmptyState } from "../components/EmptyState";
import { readJson } from "../../lib/readJson";
import { Pagination } from "../components/Pagination";

const PAGE_SIZE = 30;

type StockStatus = "out" | "critical" | "low" | "ok" | "overstock" | "idle";

interface RadarRow {
  sellerSku: string;
  asin?: string;
  productName?: string;
  fulfillable: number;
  inbound: number;
  reserved: number;
  unitsSold: number;
  perDay: number;
  daysRemaining: number | null;
  status: StockStatus;
}

const STATUS_META: Record<StockStatus, { label: string; dot: string; chip: string }> = {
  out: { label: "Esgotado", dot: "bg-[var(--ink)]", chip: "bg-[var(--ink-08)] text-[var(--ink)]" },
  critical: { label: "Repor já", dot: "bg-red-500", chip: "bg-red-100 text-red-700" },
  low: { label: "Repor em breve", dot: "bg-amber-500", chip: "bg-amber-100 text-amber-700" },
  ok: { label: "Ok", dot: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-700" },
  overstock: { label: "Excesso", dot: "bg-sky-500", chip: "bg-sky-100 text-sky-700" },
  idle: { label: "Sem venda", dot: "bg-[var(--ink-32)]", chip: "bg-[var(--ink-05)] text-[var(--ink-muted)]" },
};

export default function EstoquePage() {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RadarRow[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StockStatus | "all">("all");
  const [sort, setSort] = useState<"urgency" | "stock" | "sales">("urgency");
  const [page, setPage] = useState(1);

  async function load(d: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/radar?days=${d}`);
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Erro ao carregar o radar.");
      setRows(data.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(days), 0);
    return () => window.clearTimeout(timer);
  }, [days]);

  const counts = rows.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    },
    {} as Record<StockStatus, number>
  );
  const attention = (counts.critical || 0) + (counts.out || 0);
  const unidadesVendidas = rows.reduce((total, r) => total + r.unitsSold, 0);
  const periodoLabel = `Últimos ${days} dias`;
  const urgency: Record<StockStatus, number> = { out: 0, critical: 1, low: 2, ok: 3, overstock: 4, idle: 5 };
  const visibleRows = rows
    .filter((row) => `${row.productName || ""} ${row.sellerSku} ${row.asin || ""}`.toLowerCase().includes(query.toLowerCase()) && (statusFilter === "all" || row.status === statusFilter))
    .sort((a, b) => sort === "stock" ? b.fulfillable - a.fulfillable : sort === "sales" ? b.perDay - a.perDay : urgency[a.status] - urgency[b.status]);
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const pagedRows = visibleRows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <div className="inventory-page listing-page">
      <PageHeader
        eyebrow="FBA Inventory · Orders"
        title="Radar de estoque"
        subtitle="Estoque FBA cruzado com a velocidade de venda — quantos dias até acabar."
        icon={pageIcons.radar}
        action={
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="listing-period-select"
          >
            <option value={7}>Ritmo dos últimos 7 dias</option>
            <option value={30}>Ritmo dos últimos 30 dias</option>
            <option value={90}>Ritmo dos últimos 90 dias</option>
          </select>
        }
      />

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>{error}</p>
          <button type="button" onClick={() => void load(days)} className="mt-3 rounded-lg bg-[var(--acao)] px-3.5 py-2 text-xs font-semibold text-white">
            Tentar novamente
          </button>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <section className="listing-summary-band is-5" aria-label="Resumo do risco de estoque">
          <div><span>SKUs monitorados</span><strong>{rows.length.toLocaleString("pt-BR")}</strong><small>com estoque FBA</small></div>
          <div className={attention > 0 ? "is-danger" : "is-positive"}><span>Ação imediata</span><strong>{attention.toLocaleString("pt-BR")}</strong><small>esgotados ou críticos</small></div>
          <div className={(counts.low || 0) > 0 ? "is-warning" : undefined}><span>Repor em breve</span><strong>{(counts.low || 0).toLocaleString("pt-BR")}</strong><small>abaixo da cobertura ideal</small></div>
          <div className="is-positive"><span>Saudáveis</span><strong>{(counts.ok || 0).toLocaleString("pt-BR")}</strong><small>cobertura dentro do esperado</small></div>
          {/* O radar do Mercado Livre já mostrava isto e o da Amazon não: sem o
              volume do período, "vende/dia" fica sem escala e não dá para julgar
              se o ritmo é pouco ou é o normal do SKU. */}
          <div><span>Unidades vendidas</span><strong>{unidadesVendidas.toLocaleString("pt-BR")}</strong><small>{periodoLabel}</small></div>
        </section>
      )}

      {!loading && rows.length > 0 && (
        <div className="listing-controls cols-3" role="search" aria-label="Filtros de estoque">
          <label className="listing-search">
            <span className="sr-only">Buscar no estoque</span>
            <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Buscar SKU, ASIN ou produto" />
          </label>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as StockStatus | "all"); setPage(1); }} aria-label="Filtrar status do estoque">
            <option value="all">Todos os status</option>
            {(Object.keys(STATUS_META) as StockStatus[]).map((status) => <option key={status} value={status}>{STATUS_META[status].label}</option>)}
          </select>
          <select value={sort} onChange={(e) => { setSort(e.target.value as typeof sort); setPage(1); }} aria-label="Ordenar estoque">
            <option value="urgency">Maior urgência</option>
            <option value="stock">Maior estoque</option>
            <option value="sales">Maior venda/dia</option>
          </select>
        </div>
      )}

      <section className="listing-table-shell inventory-table-shell" aria-labelledby="inventory-results-title">
        <header><div><p className="section-kicker">Cobertura operacional</p><h2 id="inventory-results-title">{loading ? "Carregando estoque" : `${visibleRows.length} ${visibleRows.length === 1 ? "SKU encontrado" : "SKUs encontrados"}`}</h2></div><p>Ritmo dos últimos {days} dias</p></header>
        <div className="overflow-x-auto">
        <table className="inventory-table listing-table">
          <caption className="sr-only">Estoque disponível, velocidade de venda e risco de ruptura por SKU</caption>
          <thead className="bg-[var(--ink-03)] text-left text-xs uppercase tracking-wide text-[var(--ink-muted)]">
            <tr>
              <th scope="col" className="px-4 py-3">Produto / SKU</th>
              <th scope="col" className="px-4 py-3 text-center">Disponível</th>
              <th scope="col" className="px-4 py-3 text-center">A caminho</th>
              <th scope="col" className="px-4 py-3 text-center">Vendidos</th>
              <th scope="col" className="px-4 py-3 text-center">Vende/dia</th>
              <th scope="col" className="px-4 py-3 text-center">Acaba em</th>
              <th scope="col" className="px-4 py-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8"><TableLoading label="Carregando estoque e velocidade de venda" /></td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6"><EmptyState title="Seu estoque FBA aparecerá aqui" description="Quando houver mercadoria e vendas, o radar calcula automaticamente quantos dias restam para cada SKU." /></td>
              </tr>
            ) : visibleRows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6"><EmptyState kind="search" title="Nenhum SKU encontrado" description="Limpe a busca ou selecione outro status para ampliar os resultados." /></td></tr>
            ) : (
              pagedRows.map((r) => {
                const meta = STATUS_META[r.status];
                return (
                  <tr key={r.sellerSku} className="hover:bg-[var(--ink-03)]">
                    <td className="px-4 py-3">
                      <p className="max-w-[280px] truncate font-medium">
                        {r.productName || r.sellerSku}
                      </p>
                      <p className="font-mono text-xs text-[var(--ink-muted)]">{r.sellerSku}</p>
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums font-medium">
                      {r.fulfillable}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums text-[var(--ink-muted)]">
                      {r.inbound || "—"}
                    </td>
                    {/* Quantidade vendida no período, como no radar do Mercado
                        Livre. "Vende/dia" sozinho responde o ritmo mas não o
                        volume: 0,2/dia pode ser 6 unidades em 30 dias ou 1 em 5,
                        e a decisão de repor depende de saber qual. */}
                    <td className="px-4 py-3 text-center tabular-nums font-medium">
                      {r.unitsSold > 0 ? r.unitsSold.toLocaleString("pt-BR") : "—"}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums text-[var(--ink-soft)]">
                      {r.perDay > 0 ? r.perDay.toFixed(1) : "—"}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums font-semibold">
                      {r.daysRemaining == null ? "—" : `${r.daysRemaining} dias`}
                    </td>
                    <td className="inventory-status-cell px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${meta.chip}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                        {meta.label}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
        {!loading && pageCount > 1 && <div className="listing-pagination"><Pagination page={current} pageCount={pageCount} total={visibleRows.length} pageSize={PAGE_SIZE} onPage={setPage} /></div>}
      </section>

      <p className="listing-method-note">
        &quot;Acaba em&quot; = estoque disponível ÷ velocidade de venda no período escolhido.
        SKUs sem venda no período aparecem como &quot;Sem venda&quot; (não dá para prever ruptura).
      </p>
    </div>
  );
}
