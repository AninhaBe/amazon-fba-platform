"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader, pageIcons } from "../components/PageHeader";

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
  price?: number | null;
  currency?: string;
  offerCount?: number | null;
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
  return new Date(iso).toLocaleDateString("pt-BR");
}

function ageLabel(iso?: string) {
  if (!iso) return null;
  const months = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / (30 * 86400000)));
  if (months < 1) return "novo";
  if (months < 12) return `${months} m`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? `${years}a ${rest}m` : `${years}a`;
}

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

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro na busca.");
      setItems(data.items);
      setTotal(data.total);
      setNextToken(data.nextToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextToken) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}&pageToken=${encodeURIComponent(nextToken)}`);
      const data = await res.json();
      if (res.ok) {
        setItems((prev) => [...prev, ...data.items]);
        setNextToken(data.nextToken);
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Catalog Items · pesquisa de mercado"
        title="Pesquisa de produtos"
        icon={pageIcons.search}
        subtitle={
          <>
            Busque qualquer termo como na Amazon e veja, de <strong>todos</strong> os anúncios,
            quando cada um foi criado e sua posição de vendas (BSR). Dados oficiais da SP-API.
          </>
        }
      />

      <form onSubmit={run} className="flex gap-2">
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
          Entenda as colunas: por que “Anúncio criado” e “Idade da linha” diferem?
        </summary>
        <div className="space-y-3 border-t border-slate-200 px-4 py-3 text-slate-600">
          <p>
            Muitos produtos são vendidos em várias <strong>cores/tamanhos</strong>. Cada cor ou
            tamanho é um <strong>anúncio (ASIN) separado</strong>, com sua própria data — mas
            todos ficam agrupados sob um <strong>produto-pai</strong>, e{" "}
            <strong>compartilham as avaliações</strong>.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="font-semibold text-slate-800">Anúncio criado</p>
              <p className="mt-1 text-xs">
                Data de disponibilização <em>daquela variação específica</em> (aquela cor/tamanho).
                Se o vendedor adicionou uma cor nova hoje a um produto antigo, essa data é recente.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="font-semibold text-slate-800">Idade da linha</p>
              <p className="mt-1 text-xs">
                Quando o <em>produto</em> surgiu no mercado — usamos a data do{" "}
                <strong>produto-pai</strong>. É a idade real, que bate com as avaliações antigas.
              </p>
            </div>
          </div>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <strong>Exemplo:</strong> uma cor de cadeira criada em 18/05/2026, cujo produto-pai
            existe desde 12/04/2025 → “Anúncio criado” recente, “Idade da linha” de +1 ano. Uma
            avaliação de 2025 aparece porque a família compartilha reviews.
          </p>
          <p className="text-xs text-slate-400">
            Ressalva honesta: se o vendedor <em>relistou</em> o produto do zero (ASIN novo, sem
            variação), a data reseta e a SP-API não tem como saber a idade real — só a avaliação
            mais antiga revelaria, e reviews não vêm pela API oficial.
          </p>
        </div>
      </details>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500">
            {items.length} de ~{total.toLocaleString("pt-BR")} resultados
          </p>
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 text-xs">
            {([["recentes", "Mais novos"], ["antigos", "Mais antigos"], ["bsr", "Melhor BSR"]] as const).map(
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
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white shadow-sm ring-1 ring-slate-900/[0.02]">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-3">Produto</th>
              <th className="whitespace-nowrap px-3 py-3 text-right">Preço</th>
              <th className="whitespace-nowrap px-3 py-3 text-right">Vend.</th>
              <th className="whitespace-nowrap px-3 py-3 text-right">Idade / criação</th>
              <th className="whitespace-nowrap px-3 py-3 text-right">BSR</th>
              <th className="px-3 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!searched ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">
                  Digite um termo e pesquise para ver os anúncios.
                </td>
              </tr>
            ) : loading && items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-400">Buscando…</td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-400">Nada encontrado.</td>
              </tr>
            ) : (
              sorted.map((p) => {
                const eff = effectiveDate(p);
                const age = ageLabel(eff);
                const isNew = eff && REFERENCE_NOW - new Date(eff).getTime() < 180 * 86400000;
                return (
                  <tr key={p.asin} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        {p.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded object-contain" />
                        )}
                        <div className="min-w-0">
                          <p className="max-w-[46ch] truncate font-medium">
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
                      {money(p.price, p.currency)}
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
                            title={
                              p.isVariation
                                ? `Idade da linha (produto-pai ${p.parentAsin})`
                                : "Idade do anúncio"
                            }
                          >
                            {age}
                            {p.isVariation && <span className="ml-1 opacity-60">·var</span>}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                        <span className="whitespace-nowrap text-[11px] text-slate-400">
                          criado {fmtDate(p.launchDate)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                      {p.salesRank ? `#${p.salesRank.toLocaleString("pt-BR")}` : "—"}
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
            <strong className="text-slate-500">Anúncio criado</strong> = data deste ASIN
            específico (cor/tamanho). <strong className="text-slate-500">Idade da linha</strong> =
            idade do produto no mercado; para <span className="text-violet-600">variações</span>,
            usa a data do produto-pai (a família compartilha as avaliações, por isso a data do
            anúncio pode ser mais recente que reviews antigas).
          </p>
          <p>Badge verde = linha com menos de 6 meses. BSR menor = vende mais na categoria.</p>
        </div>
      )}
    </div>
  );
}
