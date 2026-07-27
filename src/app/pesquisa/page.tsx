"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader, pageIcons } from "../components/PageHeader";
import { TableLoading } from "../components/LoadingState";
import { EmptyState } from "../components/EmptyState";
import { readJson } from "../../lib/readJson";
import { brDate, brTime } from "../../lib/datetime";

interface ProductResult {
  asin: string;
  title?: string;
  brand?: string;
  imageUrl?: string;
  launchDate?: string;
  isVariation: boolean;
  parentAsin?: string;
  familyLaunchDate?: string;
  salesRank?: number;
  salesRankCategory?: string;
  salesRanks?: { rank: number; category?: string }[];
  price?: number | null;
  currency?: string;
  offerCount?: number | null;
}

type Eligibility = "listable" | "approval" | "blocked";
interface RestrictionInfo {
  eligibility: Eligibility;
  reason?: string;
}

function money(v?: number | null, currency = "BRL") {
  if (v == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);
}

// Data que melhor representa a idade do produto no mercado:
// para variações, a do produto-pai (linha); senão, a do próprio anúncio.
function effectiveDate(p: ProductResult) {
  return p.familyLaunchDate || p.launchDate;
}

function fmtDate(iso?: string) {
  if (!iso) return "—";
  return brDate(iso);
}

function ageMonths(iso?: string): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / (30 * 86400000)));
}

function ageLabel(iso?: string) {
  const months = ageMonths(iso);
  if (months == null) return null;
  if (months < 1) return "novo";
  if (months < 12) return `${months} m`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? `${years}a ${rest}m` : `${years}a`;
}

function median(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (!n) return 0;
  const m = Math.floor(n / 2);
  return n % 2 ? sortedAsc[m] : (sortedAsc[m - 1] + sortedAsc[m]) / 2;
}

// Tercil de um valor dentro de uma distribuição ordenada (0 = primeiro terço).
function tierOf(value: number, sortedAsc: number[]): 0 | 1 | 2 {
  if (sortedAsc.length < 3) return 1;
  const pos = sortedAsc.filter((v) => v < value).length / sortedAsc.length;
  return pos < 1 / 3 ? 0 : pos < 2 / 3 ? 1 : 2;
}

type SignalTone = "hot" | "good" | "ok" | "weak" | "dead" | "muted";
// Sinal de decisão: cruza a idade da linha com o giro relativo (rank entre os
// resultados). Novo + bem ranqueado = subindo; velho sem rank = parado.
function signalOf(p: ProductResult, rankedAsc: number[]): { label: string; tone: SignalTone; hint: string } {
  const months = ageMonths(effectiveDate(p));
  if (p.salesRank == null) {
    if (months != null && months >= 12)
      return { label: "parado", tone: "dead", hint: "Anúncio antigo e sem posição de vendas — sinal de que não vende." };
    return { label: "sem histórico", tone: "muted", hint: "Sem posição de vendas ainda (novo ou sem giro registrado)." };
  }
  const tier = tierOf(p.salesRank, rankedAsc); // 0 = melhor giro entre os resultados
  const novo = months != null && months < 6;
  if (tier === 0)
    return novo
      ? { label: "subindo forte", tone: "hot", hint: "Linha nova (< 6 meses) e no topo de giro entre estes resultados." }
      : { label: "forte", tone: "good", hint: "No topo de giro entre estes resultados." };
  if (tier === 1)
    return novo
      ? { label: "subindo", tone: "ok", hint: "Linha nova, giro intermediário entre os resultados." }
      : { label: "estável", tone: "ok", hint: "Giro intermediário entre os resultados." };
  return { label: "fraco", tone: "weak", hint: "Giro baixo comparado aos outros resultados." };
}

const SIGNAL_CLS: Record<SignalTone, string> = {
  hot: "bg-emerald-100 text-emerald-800",
  good: "bg-emerald-50 text-emerald-700",
  ok: "bg-slate-100 text-slate-600",
  weak: "bg-amber-50 text-amber-700",
  dead: "bg-red-50 text-red-600",
  muted: "bg-slate-50 text-slate-400",
};

const GATING: Record<Eligibility, { label: string; cls: string }> = {
  listable: { label: "pode listar ✓", cls: "bg-emerald-100 text-emerald-700" },
  approval: { label: "requer aprovação", cls: "bg-amber-100 text-amber-700" },
  blocked: { label: "bloqueado ✕", cls: "bg-red-100 text-red-700" },
};

type SortKey = "recentes" | "antigos" | "bsr";
const REFERENCE_NOW = Date.now();

export default function PesquisaPage() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ProductResult[]>([]);
  const [total, setTotal] = useState(0);
  const [nextToken, setNextToken] = useState<string | undefined>();
  const [sort, setSort] = useState<SortKey>("recentes");
  const [searched, setSearched] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [gating, setGating] = useState<Record<string, RestrictionInfo>>({});
  const [gatingLoading, setGatingLoading] = useState(false);

  // Elegibilidade de venda por ASIN (1 chamada por item na SP-API) — buscada depois
  // dos resultados, sem travar a busca principal.
  async function fetchGating(asins: string[]) {
    if (!asins.length) return;
    setGatingLoading(true);
    try {
      const res = await fetch(`/api/search/restrictions?asins=${encodeURIComponent(asins.join(","))}`);
      const data = await readJson(res);
      if (res.ok && data.restrictions) setGating((prev) => ({ ...prev, ...data.restrictions }));
    } catch {
      /* silencioso — o selo apenas não aparece */
    } finally {
      setGatingLoading(false);
    }
  }

  async function search(query: string) {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    setGating({});
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Erro na busca.");
      setItems(data.items);
      setTotal(data.total);
      setNextToken(data.nextToken);
      setSearchedQuery(query.trim());
      setUpdatedAt(new Date());
      void fetchGating((data.items as ProductResult[]).map((i) => i.asin));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  function run(e?: React.FormEvent) {
    e?.preventDefault();
    void search(q);
  }

  async function loadMore() {
    if (!nextToken) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}&pageToken=${encodeURIComponent(nextToken)}`);
      const data = await readJson(res);
      if (res.ok) {
        setItems((prev) => [...prev, ...data.items]);
        setNextToken(data.nextToken);
        void fetchGating((data.items as ProductResult[]).map((i) => i.asin));
      }
    } finally {
      setLoading(false);
    }
  }

  const sorted = [...items].sort((a, b) => {
    if (sort === "bsr") return (a.salesRank ?? Infinity) - (b.salesRank ?? Infinity);
    const da = effectiveDate(a) ? new Date(effectiveDate(a)!).getTime() : 0;
    const db = effectiveDate(b) ? new Date(effectiveDate(b)!).getTime() : 0;
    return sort === "recentes" ? db - da : da - db;
  });

  // Distribuições e resumo do nicho, calculados sobre os resultados carregados.
  const rankedAsc = items.filter((i) => i.salesRank != null).map((i) => i.salesRank!).sort((a, b) => a - b);
  const pricedAsc = items.filter((i) => i.price != null).map((i) => i.price!).sort((a, b) => a - b);
  const agesAsc = items.map((i) => ageMonths(effectiveDate(i))).filter((n): n is number => n != null).sort((a, b) => a - b);
  const summary = items.length
    ? {
        pctWithRank: Math.round((rankedAsc.length / items.length) * 100),
        price: pricedAsc.length ? { min: pricedAsc[0], med: median(pricedAsc), max: pricedAsc[pricedAsc.length - 1] } : null,
        brands: new Set(items.map((i) => i.brand).filter(Boolean)).size,
        medianAge: agesAsc.length ? median(agesAsc) : null,
      }
    : null;
  const currency = items.find((i) => i.currency)?.currency || "BRL";

  return (
    <div className="research-page space-y-6">
      <PageHeader
        eyebrow="Inteligência de mercado"
        title="Pesquisa de produtos"
        icon={pageIcons.search}
        subtitle={
          <>
            Busque qualquer termo como na Amazon e veja, de <strong>todos</strong> os anúncios,
            se você pode vender, o giro, o momento e a concorrência — para decidir se entra ou não no produto.
          </>
        }
      />

      <form onSubmit={run} className="search-deck flex gap-2 border-y border-slate-300 py-5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ex: cadeira gamer, fone bluetooth, tapete de yoga…"
          className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-blue-600 px-6 py-2.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Buscando…" : "Pesquisar"}
        </button>
      </form>

      <details className="group rounded-xl border border-slate-200 bg-slate-50 text-sm">
        <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 font-medium text-slate-700 marker:content-['']">
          <span className="text-blue-600 transition-transform group-open:rotate-90">▶</span>
          Entenda as colunas: giro, sinal, “pode listar” e idade da linha
        </summary>
        <div className="space-y-3 border-t border-slate-200 px-4 py-3 text-slate-600">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="font-semibold text-slate-800">Posição de vendas (giro)</p>
              <p className="mt-1 text-xs">
                Rank da <strong>subcategoria</strong> (nicho), não do grupo amplo — é o que dá
                para comparar entre concorrentes do mesmo nicho. Quanto menor, mais vende. <strong>—</strong> = a
                Amazon não publicou rank (quase sempre porque o item não vendeu o suficiente).
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="font-semibold text-slate-800">Sinal</p>
              <p className="mt-1 text-xs">
                Cruza <strong>idade da linha × giro relativo</strong> entre os resultados:
                <em> subindo forte</em> (novo e no topo), <em>forte</em>, <em>estável</em>, <em>fraco</em> ou
                <em> parado</em> (velho e sem rank). Um atalho de decisão, não um número exato.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="font-semibold text-slate-800">Pode listar (gating)</p>
              <p className="mt-1 text-xs">
                Se a <strong>sua conta</strong> pode vender aquele ASIN: <span className="text-emerald-700">pode listar</span>,
                <span className="text-amber-700"> requer aprovação</span> ou <span className="text-red-700">bloqueado</span>.
                É por conta — o mesmo produto pode estar liberado para um vendedor e travado para outro.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="font-semibold text-slate-800">Idade da linha</p>
              <p className="mt-1 text-xs">
                Quando o <em>produto</em> surgiu no mercado — para <span className="text-violet-600">variações</span>,
                usamos a data do <strong>produto-pai</strong> (a família compartilha as avaliações).
              </p>
            </div>
          </div>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <strong>Honestidade:</strong> o giro (BSR) é ruidoso e só comparável dentro do mesmo nicho;
            rank ≠ lucro (item barato gira mais e pode faturar menos). Use como sinal de demanda, não de
            resultado — o lucro real sai no <strong>calcular</strong>.
          </p>
        </div>
      </details>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>{error}</p>
          <button type="button" onClick={() => void search(searchedQuery || q)} className="mt-3 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white">
            Tentar novamente
          </button>
        </div>
      )}

      {summary && (
        <div className="niche-summary grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard label="Densidade de demanda" value={`${summary.pctWithRank}%`} sub="dos resultados têm posição de vendas" />
          <SummaryCard
            label="Faixa de preço"
            value={summary.price ? money(summary.price.med, currency) : "—"}
            sub={summary.price ? `de ${money(summary.price.min, currency)} a ${money(summary.price.max, currency)}` : "sem preço"}
          />
          <SummaryCard label="Marcas distintas" value={String(summary.brands)} sub={summary.brands <= 2 ? "nicho concentrado" : "nicho pulverizado"} />
          <SummaryCard label="Idade mediana" value={summary.medianAge != null ? `${summary.medianAge} m` : "—"} sub="da linha dos resultados" />
        </div>
      )}

      {items.length > 0 && (
        <div className="filter-toolbar flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">{items.length} de ~{total.toLocaleString("pt-BR")} resultados</p>
            {updatedAt && (
              <p className="mt-0.5 text-xs text-slate-400">
                Consultado às {brTime(updatedAt)}
                {gatingLoading && " · verificando elegibilidade…"}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void search(searchedQuery)}
              disabled={loading}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:border-blue-400 hover:text-blue-600 disabled:opacity-50"
            >
              {loading ? "Atualizando…" : "Atualizar resultados"}
            </button>
            <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 text-xs">
            {([["recentes", "Mais novos"], ["antigos", "Mais antigos"], ["bsr", "Melhor posição"]] as const).map(
              ([k, label]) => (
                <button
                  key={k}
                  onClick={() => setSort(k)}
                  className={`rounded-md px-3 py-1.5 font-medium ${
                    sort === k ? "bg-blue-100 text-blue-700" : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {label}
                </button>
              )
            )}
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white shadow-sm ring-1 ring-slate-900/[0.02]">
        <table className="w-full min-w-[900px] text-sm">
          <caption className="sr-only">Resultados da pesquisa de anúncios da Amazon</caption>
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-3">Produto</th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 text-right">Preço</th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 text-right" title="Quantidade de ofertas ativas concorrendo neste produto">
                Concorrentes
              </th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 text-right">Idade / criação</th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 text-right" title="Rank de vendas na subcategoria (nicho). Quanto menor, melhor.">
                Posição de vendas
              </th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 text-center" title="Sinal de decisão: idade da linha × giro relativo">
                Sinal
              </th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 text-center" title="Sua conta pode vender este ASIN?">
                Pode listar
              </th>
              <th scope="col" className="px-3 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!searched ? (
              <tr>
                <td colSpan={8} className="px-4 py-6"><EmptyState kind="search" title="Pesquise o mercado Amazon" description="Digite um produto, marca ou palavra-chave para ver giro, sinal de decisão, se você pode vender e a concorrência." /></td>
              </tr>
            ) : loading && items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8"><TableLoading label="Buscando anúncios" /></td>
              </tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-6"><EmptyState kind="search" title="Nenhum anúncio encontrado" description="Tente uma palavra mais ampla, outra grafia ou remova detalhes do termo pesquisado." /></td></tr>
            ) : (
              sorted.map((p) => {
                const eff = effectiveDate(p);
                const age = ageLabel(eff);
                const isNew = eff && REFERENCE_NOW - new Date(eff).getTime() < 180 * 86400000;
                const priceTier = p.price != null ? tierOf(p.price, pricedAsc) : null;
                const sig = signalOf(p, rankedAsc);
                const g = gating[p.asin];
                const rankTitle = p.salesRanks?.length
                  ? p.salesRanks.map((r) => `#${r.rank.toLocaleString("pt-BR")}${r.category ? ` em ${r.category}` : ""}`).join("\n")
                  : "Sem posição de vendas publicada pela Amazon";
                return (
                  <tr key={p.asin} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        {p.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded object-contain" />
                        )}
                        <div className="min-w-0">
                          <p className="max-w-[42ch] truncate font-medium">
                            {p.title || p.asin}
                            {p.isVariation && (
                              <span
                                className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-violet-700"
                                title="Variação (cor/tamanho). A idade mostrada é a da linha do produto (produto-pai)."
                              >
                                variação
                              </span>
                            )}
                          </p>
                          <p className="font-mono text-xs text-slate-400">
                            {p.asin}
                            {p.brand ? ` · ${p.brand}` : ""}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-700">
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {priceTier != null && pricedAsc.length >= 3 && (
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${priceTier === 0 ? "bg-emerald-500" : priceTier === 1 ? "bg-slate-300" : "bg-amber-500"}`}
                            title={priceTier === 0 ? "Entre os mais baratos do nicho" : priceTier === 1 ? "Preço mediano no nicho" : "Entre os mais caros do nicho"}
                          />
                        )}
                        {money(p.price, p.currency)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                      {p.offerCount != null ? p.offerCount : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        {age ? (
                          <span
                            className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                              isNew ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                            }`}
                            title={p.isVariation ? `Idade da linha (produto-pai ${p.parentAsin})` : "Idade do anúncio"}
                          >
                            {age}
                            {p.isVariation && <span className="ml-1 opacity-60">·var</span>}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                        <span className="whitespace-nowrap text-[11px] text-slate-400">criado {fmtDate(p.launchDate)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                      {p.salesRank ? (
                        <div className="flex cursor-help flex-col items-end gap-0.5" title={rankTitle}>
                          <strong className="font-semibold text-slate-700">#{p.salesRank.toLocaleString("pt-BR")}</strong>
                          {p.salesRankCategory && (
                            <span className="max-w-[20ch] truncate text-[11px] text-slate-400">em {p.salesRankCategory}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400" title="A Amazon não publicou posição — quase sempre porque o item não vendeu o suficiente.">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${SIGNAL_CLS[sig.tone]}`} title={sig.hint}>
                        {sig.tone === "hot" && "🔥 "}
                        {sig.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {g ? (
                        <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${GATING[g.eligibility].cls}`} title={g.reason || undefined}>
                          {GATING[g.eligibility].label}
                        </span>
                      ) : gatingLoading ? (
                        <span className="text-[11px] text-slate-300">verificando…</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/calculadora?asin=${p.asin}`}
                          className="whitespace-nowrap rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                          calcular
                        </Link>
                        <a
                          href={`https://www.amazon.com.br/dp/${p.asin}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="whitespace-nowrap rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-blue-400 hover:text-blue-600"
                        >
                          abrir ↗
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {nextToken && (
        <div className="text-center">
          <button
            onClick={loadMore}
            disabled={loading}
            className="rounded-lg border border-slate-300 px-6 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
          >
            {loading ? "Carregando…" : "Carregar mais"}
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-1 text-xs text-slate-400">
          <p>
            <strong className="text-slate-500">Sinal</strong> e <strong className="text-slate-500">giro</strong> são
            relativos a estes resultados (mesmo nicho). Para comparação justa, avalie produtos da mesma categoria.
          </p>
          <p>
            <strong className="text-slate-500">Pode listar</strong> é específico da sua conta Amazon ativa. Rank e sinal são
            sinais de <em>demanda</em>, não de <em>lucro</em> — o lucro real sai no <strong>calcular</strong>.
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>
    </div>
  );
}
