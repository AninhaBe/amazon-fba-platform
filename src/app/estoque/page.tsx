"use client";

import { useEffect, useState } from "react";
import { PageHeader, pageIcons } from "../components/PageHeader";
import { TableLoading } from "../components/LoadingState";
import { EmptyState } from "../components/EmptyState";
import { readJson } from "../../lib/readJson";

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
  out: { label: "Esgotado", dot: "bg-slate-800", chip: "bg-slate-200 text-slate-800" },
  critical: { label: "Repor já", dot: "bg-red-500", chip: "bg-red-100 text-red-700" },
  low: { label: "Repor em breve", dot: "bg-amber-500", chip: "bg-amber-100 text-amber-700" },
  ok: { label: "Ok", dot: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-700" },
  overstock: { label: "Excesso", dot: "bg-sky-500", chip: "bg-sky-100 text-sky-700" },
  idle: { label: "Sem venda", dot: "bg-slate-400", chip: "bg-slate-100 text-slate-500" },
};

export default function EstoquePage() {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RadarRow[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StockStatus | "all">("all");
  const [sort, setSort] = useState<"urgency" | "stock" | "sales">("urgency");

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
  const urgency: Record<StockStatus, number> = { out: 0, critical: 1, low: 2, ok: 3, overstock: 4, idle: 5 };
  const visibleRows = rows
    .filter((row) => `${row.productName || ""} ${row.sellerSku} ${row.asin || ""}`.toLowerCase().includes(query.toLowerCase()) && (statusFilter === "all" || row.status === statusFilter))
    .sort((a, b) => sort === "stock" ? b.fulfillable - a.fulfillable : sort === "sales" ? b.perDay - a.perDay : urgency[a.status] - urgency[b.status]);

  return (
    <div className="inventory-page space-y-8">
      <PageHeader
        eyebrow="FBA Inventory · Orders"
        title="Radar de estoque"
        subtitle="Estoque FBA cruzado com a velocidade de venda — quantos dias até acabar."
        icon={pageIcons.radar}
        action={
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-900/[0.02] hover:border-slate-300"
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
          <button type="button" onClick={() => void load(days)} className="mt-3 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white">
            Tentar novamente
          </button>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200/70 bg-white shadow-sm ring-1 ring-slate-900/[0.02] p-4">
          <span className="text-sm font-medium">
            {attention > 0 ? (
              <span className="inline-flex items-center gap-2 text-red-600"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true"><path d="M10 3 18 17H2L10 3Z" strokeLinejoin="round"/><path d="M10 8v4m0 2.5v.1" strokeLinecap="round"/></svg>{attention} SKU(s) precisam de atenção</span>
            ) : (
              <span className="inline-flex items-center gap-2 text-emerald-600"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="m7 10 2 2 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg>Nenhum SKU em ruptura iminente</span>
            )}
          </span>
          <div className="flex flex-wrap gap-3 text-xs text-slate-500">
            {(Object.keys(STATUS_META) as StockStatus[]).map((s) =>
              counts[s] ? (
                <span key={s} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${STATUS_META[s].dot}`} />
                  {STATUS_META[s].label}: {counts[s]}
                </span>
              ) : null
            )}
          </div>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="filter-toolbar flex flex-wrap gap-2" role="search" aria-label="Filtros de estoque">
          <label className="min-w-52 flex-1">
            <span className="sr-only">Buscar no estoque</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar SKU, ASIN ou produto" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          </label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StockStatus | "all")} aria-label="Filtrar status do estoque" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="all">Todos os status</option>
            {(Object.keys(STATUS_META) as StockStatus[]).map((status) => <option key={status} value={status}>{STATUS_META[status].label}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Ordenar estoque" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="urgency">Maior urgência</option>
            <option value="stock">Maior estoque</option>
            <option value="sales">Maior venda/dia</option>
          </select>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white shadow-sm ring-1 ring-slate-900/[0.02]">
        <table className="inventory-table w-full min-w-[720px] text-sm">
          <caption className="sr-only">Estoque disponível, velocidade de venda e risco de ruptura por SKU</caption>
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-3">Produto / SKU</th>
              <th scope="col" className="px-4 py-3 text-center">Disponível</th>
              <th scope="col" className="px-4 py-3 text-center">A caminho</th>
              <th scope="col" className="px-4 py-3 text-center">Vende/dia</th>
              <th scope="col" className="px-4 py-3 text-center">Acaba em</th>
              <th scope="col" className="px-4 py-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8"><TableLoading label="Carregando estoque e velocidade de venda" /></td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6"><EmptyState title="Seu estoque FBA aparecerá aqui" description="Quando houver mercadoria e vendas, o radar calcula automaticamente quantos dias restam para cada SKU." /></td>
              </tr>
            ) : visibleRows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6"><EmptyState kind="search" title="Nenhum SKU encontrado" description="Limpe a busca ou selecione outro status para ampliar os resultados." /></td></tr>
            ) : (
              visibleRows.map((r) => {
                const meta = STATUS_META[r.status];
                return (
                  <tr key={r.sellerSku} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="max-w-[280px] truncate font-medium">
                        {r.productName || r.sellerSku}
                      </p>
                      <p className="font-mono text-xs text-slate-400">{r.sellerSku}</p>
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums font-medium">
                      {r.fulfillable}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums text-slate-500">
                      {r.inbound || "—"}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums text-slate-600">
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

      <p className="text-xs text-slate-400">
        &quot;Acaba em&quot; = estoque disponível ÷ velocidade de venda no período escolhido.
        SKUs sem venda no período aparecem como &quot;Sem venda&quot; (não dá para prever ruptura).
      </p>
    </div>
  );
}
