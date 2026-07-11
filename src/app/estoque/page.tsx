"use client";

import { useEffect, useState } from "react";
import { PageHeader, pageIcons } from "../components/PageHeader";

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

  async function load(d: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/radar?days=${d}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao carregar o radar.");
      setRows(data.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const counts = rows.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    },
    {} as Record<StockStatus, number>
  );
  const attention = (counts.critical || 0) + (counts.out || 0);

  return (
    <div className="space-y-8">
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
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200/70 bg-white shadow-sm ring-1 ring-slate-900/[0.02] p-4">
          <span className="text-sm font-medium">
            {attention > 0 ? (
              <span className="text-red-600">⚠ {attention} SKU(s) precisam de atenção</span>
            ) : (
              <span className="text-emerald-600">✓ Nenhum SKU em ruptura iminente</span>
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

      <div className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white shadow-sm ring-1 ring-slate-900/[0.02]">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Produto / SKU</th>
              <th className="px-4 py-3 text-right">Disponível</th>
              <th className="px-4 py-3 text-right">A caminho</th>
              <th className="px-4 py-3 text-right">Vende/dia</th>
              <th className="px-4 py-3 text-right">Acaba em</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  Carregando estoque e velocidade de venda…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  Nenhum produto no estoque FBA. Quando você enviar mercadoria e começar a
                  vender, o radar mostra aqui quantos dias faltam para cada SKU acabar.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const meta = STATUS_META[r.status];
                return (
                  <tr key={r.sellerSku} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="max-w-[280px] truncate font-medium">
                        {r.productName || r.sellerSku}
                      </p>
                      <p className="font-mono text-xs text-slate-400">{r.sellerSku}</p>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">
                      {r.fulfillable}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                      {r.inbound || "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {r.perDay > 0 ? r.perDay.toFixed(1) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">
                      {r.daysRemaining == null ? "—" : `${r.daysRemaining} dias`}
                    </td>
                    <td className="px-4 py-3">
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
