"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader, pageIcons } from "../../components/PageHeader";
import { TableLoading } from "../../components/LoadingState";
import { EmptyState } from "../../components/EmptyState";
import { Pagination } from "../../components/Pagination";

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
type RankMetric = "sessions" | "conversion" | "revenue" | "buybox";
const PAGE_SIZE = 30;

const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("pt-BR");

function money(value: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

function percent(value: number | null) {
  return value == null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

export default function DesempenhoPage() {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<TrafficSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionMissing, setPermissionMissing] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("sessions");
  const [rankMetric, setRankMetric] = useState<RankMetric>("sessions");
  const [page, setPage] = useState(1);
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
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const pagedRows = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const rankedRows = [...(summary?.rows ?? [])]
    .sort((a, b) => rankMetric === "conversion" ? b.conversion - a.conversion : rankMetric === "revenue" ? b.revenue - a.revenue : rankMetric === "buybox" ? (b.buyBoxPercentage ?? -1) - (a.buyBoxPercentage ?? -1) : b.sessions - a.sessions)
    .slice(0, 8);
  const rankValue = (row: TrafficRow) => rankMetric === "conversion" ? row.conversion : rankMetric === "revenue" ? row.revenue : rankMetric === "buybox" ? row.buyBoxPercentage ?? 0 : row.sessions;
  const rankMax = Math.max(1, ...rankedRows.map(rankValue));

  return (
    <div className="performance-page analysis-page">
      <PageHeader
        eyebrow="Amazon Sales & Traffic"
        title="Visitas e conversão"
        subtitle="Entenda quais anúncios atraem tráfego, quais convertem e onde a Buy Box está limitando suas vendas."
        icon={pageIcons.performance}
        action={
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="listing-period-select"
            aria-label="Período do desempenho"
          >
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>
        }
      />

      {error && (
        <div role="alert" className="performance-error">
          <p><strong>{permissionMissing ? "Permissão Brand Analytics necessária" : "Não foi possível carregar o desempenho"}</strong></p>
          <p>
            {permissionMissing
              ? "Ative o acesso a Brand Analytics nas permissões da integração Amazon. Depois, reconecte a conta para conceder o novo acesso."
              : error}
          </p>
          <div>
            <button type="button" onClick={() => void load(days)}>
              Tentar novamente
            </button>
            {permissionMissing && (
              <a href="/api/auth/login">
                Reconectar conta
              </a>
            )}
          </div>
        </div>
      )}

      <section className="performance-summary-band" aria-label="Resumo de desempenho">
        <Metric label="Sessões" value={loading ? "…" : totals ? compact.format(totals.sessions) : "—"} note={totals ? "Visitas únicas aproximadas" : "dado indisponível"} />
        <Metric label="Visualizações" value={loading ? "…" : totals ? compact.format(totals.pageViews) : "—"} note={totals ? "Páginas vistas" : "dado indisponível"} />
        <Metric label="Pedidos" value={loading ? "…" : totals ? integer.format(totals.orders) : "—"} note={totals ? `${integer.format(totals.units)} unidades` : "dado indisponível"} />
        <Metric label="Conversão" value={loading ? "…" : totals ? percent(totals.conversion) : "—"} note={totals ? "Unidades ÷ sessões" : "dado indisponível"} />
        <Metric label="Receita" value={loading ? "…" : totals ? money(totals.revenue, totals.currency) : "—"} note={totals ? `Buy Box média ${percent(totals.buyBoxPercentage)}` : "dado indisponível"} />
      </section>

      {!loading && !error && rankedRows.length > 0 && (
        <section className="performance-ranking" aria-labelledby="performance-ranking-title">
          <header><div><p>Comparação visual</p><h2 id="performance-ranking-title">Produtos que lideram o período</h2></div><span>{summary ? `${new Date(`${summary.startDate}T12:00:00`).toLocaleDateString("pt-BR")} — ${new Date(`${summary.endDate}T12:00:00`).toLocaleDateString("pt-BR")}` : ""}</span></header>
          <div className="performance-ranking-tabs" role="tablist" aria-label="Métrica do ranking">{([['sessions', 'Sessões'], ['conversion', 'Conversão'], ['revenue', 'Receita'], ['buybox', 'Buy Box']] as Array<[RankMetric, string]>).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={rankMetric === key} onClick={() => setRankMetric(key)}>{label}</button>)}</div>
          <ol>{rankedRows.map((row, index) => { const value = rankValue(row); return <li key={`${row.sku}-${row.asin || ""}`} style={{ "--performance-bar": `${Math.max(2, (value / rankMax) * 100)}%` } as React.CSSProperties}><span className="performance-rank-bar" aria-hidden="true" /><i>{index + 1}</i><div><strong title={row.title}>{row.title || row.asin || row.sku}</strong><small>{row.sku}{row.asin ? ` · ${row.asin}` : ""}</small></div><b>{rankMetric === "revenue" ? money(value, row.currency) : rankMetric === "conversion" || rankMetric === "buybox" ? percent(value) : integer.format(value)}</b></li>; })}</ol>
        </section>
      )}

      {!error && summary && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[var(--ink-muted)]">
            Dados consolidados de {new Date(`${summary.startDate}T12:00:00`).toLocaleDateString("pt-BR")} a {new Date(`${summary.endDate}T12:00:00`).toLocaleDateString("pt-BR")}
          </p>
          <button type="button" onClick={() => void load(days)} disabled={loading} className="rounded-lg border border-[var(--line-strong)] bg-white px-3 py-2 text-xs font-semibold text-[var(--ink-soft)] disabled:opacity-50">
            {loading ? "Atualizando…" : "Atualizar dados"}
          </button>
        </div>
      )}

      {!error && summary && <div className="listing-controls cols-3 performance-controls" role="search" aria-label="Filtros de desempenho">
        <label className="listing-search">
          <span className="sr-only">Buscar produto</span>
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Buscar SKU, ASIN ou produto" />
        </label>
        <select value={sort} onChange={(event) => { setSort(event.target.value as SortKey); setPage(1); }} aria-label="Ordenar produtos">
          <option value="sessions">Mais visitados</option>
          <option value="conversion">Maior conversão</option>
          <option value="revenue">Maior receita</option>
          <option value="buybox">Maior Buy Box</option>
        </select><span className="listing-filter-context">{rows.length} no recorte</span>
      </div>}

      <section className="listing-table-shell performance-table-shell" aria-labelledby="performance-results-title">
        <header><div><p className="section-kicker">Detalhamento</p><h2 id="performance-results-title">{loading ? "Carregando desempenho" : error ? "Dados indisponíveis" : `${rows.length} ${rows.length === 1 ? "produto encontrado" : "produtos encontrados"}`}</h2></div><p>Sales & Traffic por produto</p></header>
        <div className="overflow-x-auto"><table className="listing-table performance-table">
          <caption className="sr-only">Desempenho de tráfego e conversão por produto</caption>
          <thead className="bg-[var(--ink-03)] text-left text-xs uppercase tracking-wide text-[var(--ink-muted)]">
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
          <tbody className="divide-y divide-[var(--line)]">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8"><TableLoading label="A Amazon está consolidando as métricas de tráfego" /></td></tr>
            ) : error ? (
              <tr><td colSpan={7} className="px-4 py-6"><EmptyState kind="permission" title="Dados de desempenho indisponíveis" description="Libere a permissão Brand Analytics e reconecte a conta para visualizar visitas e conversão." /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6"><EmptyState title="Nenhum tráfego neste período" description="Experimente ampliar o intervalo ou aguarde a consolidação diária da Amazon." /></td></tr>
            ) : pagedRows.map((row) => (
              <tr key={`${row.sku}-${row.asin || ""}`}>
                <td className="px-4 py-3">
                  <p className="max-w-[300px] truncate font-medium text-[var(--ink)]">{row.title || row.asin || row.sku}</p>
                  <p className="mt-0.5 font-mono text-xs text-[var(--ink-muted)]">{row.sku}{row.asin ? ` · ${row.asin}` : ""}</p>
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">{integer.format(row.sessions)}</td>
                <td className="px-4 py-3 text-right text-[var(--ink-muted)] tabular-nums">{integer.format(row.pageViews)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{integer.format(row.orders)}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{percent(row.conversion)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{percent(row.buyBoxPercentage)}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(row.revenue, row.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {!loading && pageCount > 1 && <div className="listing-pagination"><Pagination page={current} pageCount={pageCount} total={rows.length} pageSize={PAGE_SIZE} onPage={setPage} /></div>}
      </section>

      <p className="listing-method-note">
        Conversão = unidades pedidas ÷ sessões. A Amazon consolida esses dados diariamente; por isso, o período termina no último dia completo.
      </p>
    </div>
  );
}
