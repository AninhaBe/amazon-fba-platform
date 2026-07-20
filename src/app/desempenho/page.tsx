"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader, pageIcons } from "../components/PageHeader";
import { TableLoading } from "../components/LoadingState";
import { EmptyState } from "../components/EmptyState";

interface TrafficRow {
  sku: string;
  asin?: string;
  parentAsin?: string;
  title?: string;
  sessions: number;
  pageViews: number;
  orders: number;
  units: number;
  revenue: number;
  currency: string;
  conversion: number;
  buyBoxPercentage: number | null;
}

interface TrafficSummary {
  rows: TrafficRow[];
  totals: Omit<TrafficRow, "sku" | "asin" | "parentAsin" | "title">;
  startDate: string;
  endDate: string;
}

type SortKey = "sessions" | "conversion" | "revenue" | "buybox";

const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("pt-BR");

function money(value: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

function percent(value: number | null) {
  return value == null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="metric-cell p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</p>
      <strong className="mt-3 block text-2xl font-bold tracking-[-0.035em] text-slate-900 tabular-nums">{value}</strong>
      <p className="mt-1 text-xs text-slate-500">{note}</p>
    </div>
  );
}

export default function DesempenhoPage() {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<TrafficSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionMissing, setPermissionMissing] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("sessions");
  const retryTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async function loadTraffic(periodDays: number) {
    retryTimer.current = undefined;
    setLoading(true);
    setError(null);
    setPermissionMissing(false);
    try {
      const response = await fetch(`/api/traffic?days=${periodDays}`);
      const data = await response.json();
      if (response.status === 202) {
        retryTimer.current = window.setTimeout(() => void loadTraffic(periodDays), 5_000);
        return;
      }
      if (!response.ok) {
        setPermissionMissing(data.errorInfo?.code === "AMAZON_FORBIDDEN");
        throw new Error(data.error || "Não foi possível carregar visitas e conversão.");
      }
      setSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      if (retryTimer.current === undefined) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(days), 0);
    return () => {
      window.clearTimeout(timer);
      if (retryTimer.current !== undefined) window.clearTimeout(retryTimer.current);
      retryTimer.current = undefined;
    };
  }, [days, load]);

  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return [...(summary?.rows ?? [])]
      .filter((row) => `${row.title || ""} ${row.sku} ${row.asin || ""}`.toLowerCase().includes(normalized))
      .sort((a, b) => {
        if (sort === "conversion") return b.conversion - a.conversion;
        if (sort === "revenue") return b.revenue - a.revenue;
        if (sort === "buybox") return (b.buyBoxPercentage ?? -1) - (a.buyBoxPercentage ?? -1);
        return b.sessions - a.sessions;
      });
  }, [query, sort, summary]);

  const totals = summary?.totals;

  return (
    <div className="performance-page space-y-8">
      <PageHeader
        eyebrow="Amazon Sales & Traffic"
        title="Visitas e conversão"
        subtitle="Entenda quais anúncios atraem tráfego, quais convertem e onde a Buy Box está limitando suas vendas."
        icon={pageIcons.performance}
        action={
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm"
            aria-label="Período do desempenho"
          >
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>
        }
      />

      {error && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
          <p className="font-semibold">{permissionMissing ? "Permissão Brand Analytics necessária" : "Não foi possível carregar o desempenho"}</p>
          <p className="mt-1 leading-relaxed">
            {permissionMissing
              ? "Ative o acesso a Brand Analytics nas permissões da integração Amazon. Depois, reconecte a conta para conceder o novo acesso."
              : error}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void load(days)} className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white">
              Tentar novamente
            </button>
            {permissionMissing && (
              <a href="/api/auth/login" className="inline-flex min-h-10 items-center rounded-lg border border-amber-300 bg-white px-3.5 py-2 text-xs font-semibold text-amber-800">
                Reconectar conta
              </a>
            )}
          </div>
        </div>
      )}

      <div className="metric-grid grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric label="Sessões" value={loading ? "…" : compact.format(totals?.sessions ?? 0)} note="Visitas únicas aproximadas" />
        <Metric label="Visualizações" value={loading ? "…" : compact.format(totals?.pageViews ?? 0)} note="Páginas vistas" />
        <Metric label="Pedidos" value={loading ? "…" : integer.format(totals?.orders ?? 0)} note={`${integer.format(totals?.units ?? 0)} unidades`} />
        <Metric label="Conversão" value={loading ? "…" : percent(totals?.conversion ?? 0)} note="Unidades ÷ sessões" />
        <Metric label="Receita" value={loading ? "…" : money(totals?.revenue ?? 0, totals?.currency)} note={`Buy Box média ${percent(totals?.buyBoxPercentage ?? null)}`} />
      </div>

      {!error && summary && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Dados consolidados de {new Date(`${summary.startDate}T12:00:00`).toLocaleDateString("pt-BR")} a {new Date(`${summary.endDate}T12:00:00`).toLocaleDateString("pt-BR")}
          </p>
          <button type="button" onClick={() => void load(days)} disabled={loading} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-50">
            {loading ? "Atualizando…" : "Atualizar dados"}
          </button>
        </div>
      )}

      <div className="filter-toolbar flex flex-wrap gap-2" role="search" aria-label="Filtros de desempenho">
        <label className="min-w-52 flex-1">
          <span className="sr-only">Buscar produto</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar SKU, ASIN ou produto" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" aria-label="Ordenar produtos">
          <option value="sessions">Mais visitados</option>
          <option value="conversion">Maior conversão</option>
          <option value="revenue">Maior receita</option>
          <option value="buybox">Maior Buy Box</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white shadow-sm">
        <table className="w-full min-w-[850px] text-sm">
          <caption className="sr-only">Desempenho de tráfego e conversão por produto</caption>
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-3">Produto / SKU</th>
              <th scope="col" className="px-4 py-3 text-right">Sessões</th>
              <th scope="col" className="px-4 py-3 text-right">Visualizações</th>
              <th scope="col" className="px-4 py-3 text-right">Pedidos</th>
              <th scope="col" className="px-4 py-3 text-right">Conversão</th>
              <th scope="col" className="px-4 py-3 text-right">Buy Box</th>
              <th scope="col" className="px-4 py-3 text-right">Receita</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8"><TableLoading label="A Amazon está consolidando as métricas de tráfego" /></td></tr>
            ) : error ? (
              <tr><td colSpan={7} className="px-4 py-6"><EmptyState kind="permission" title="Dados de desempenho indisponíveis" description="Libere a permissão Brand Analytics e reconecte a conta para visualizar visitas e conversão." /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6"><EmptyState title="Nenhum tráfego neste período" description="Experimente ampliar o intervalo ou aguarde a consolidação diária da Amazon." /></td></tr>
            ) : rows.map((row) => (
              <tr key={`${row.sku}-${row.asin || ""}`}>
                <td className="px-4 py-3">
                  <p className="max-w-[300px] truncate font-medium text-slate-800">{row.title || row.asin || row.sku}</p>
                  <p className="mt-0.5 font-mono text-xs text-slate-400">{row.sku}{row.asin ? ` · ${row.asin}` : ""}</p>
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">{integer.format(row.sessions)}</td>
                <td className="px-4 py-3 text-right text-slate-500 tabular-nums">{integer.format(row.pageViews)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{integer.format(row.orders)}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{percent(row.conversion)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{percent(row.buyBoxPercentage)}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(row.revenue, row.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs leading-relaxed text-slate-400">
        Conversão = unidades pedidas ÷ sessões. A Amazon consolida esses dados diariamente; por isso, o período termina no último dia completo.
      </p>
    </div>
  );
}
