"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, Eye, EyeOff } from "lucide-react";
import { PageHeader, pageIcons } from "../components/PageHeader";
import { TableLoading } from "../components/LoadingState";
import { EmptyState } from "../components/EmptyState";
import { readJson } from "../../lib/readJson";
import { brDate } from "../../lib/datetime";
import styles from "./PesquisaPage.module.css";

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
  subRank?: number;
  subRankCategory?: string;
  rankDelta?: number; // positivo = subiu de posição desde a última foto
  rankPrevDate?: string;
  monitorado?: boolean;
  price?: number | null;
  currency?: string;
  offerCount?: number | null;
  fbaChecked?: boolean; // false = não deu para consultar a logística (≠ "sem FBA")
  fbaPrice?: number | null; // menor preço entre ofertas FBA; null = ninguém no FBA
  lowestPrice?: number | null;
  featured?: "fba" | "seller" | null;
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

function ageLabel(iso?: string) {
  if (!iso) return null;
  const months = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / (30 * 86400000)));
  if (months < 1) return "novo";
  if (months < 12) return `${months} m`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? `${years}a ${rest}m` : `${years}a`;
}

type SortKey = "recentes" | "antigos" | "bsr" | "fba";
const REFERENCE_NOW = Date.now();

export default function PesquisaPage() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ProductResult[]>([]);
  const [total, setTotal] = useState(0);
  const [nextToken, setNextToken] = useState<string | undefined>();
  const [sort, setSort] = useState<SortKey>("recentes");
  // Só anúncios com oferta FBA: é com esses que se disputa de fato, e é o
  // preço deles que define o piso para entrar no nicho.
  const [somenteFba, setSomenteFba] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [salvando, setSalvando] = useState<string | null>(null);

  // Monitorar é opt-in: a busca não adiciona nada sozinha (20 resultados por página
  // virariam milhares de itens acompanhados em poucos dias). Aqui a pessoa escolhe.
  async function alternarMonitor(p: ProductResult) {
    setSalvando(p.asin);
    const alvo = !p.monitorado;
    try {
      const res = await fetch("/api/watchlist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asin: p.asin,
          action: alvo ? "monitorar" : "remover",
          title: p.title,
          brand: p.brand,
          imageUrl: p.imageUrl,
          searchTerm: searchedQuery,
        }),
      });
      if (!res.ok) throw new Error((await readJson(res)).error || "Não consegui salvar.");
      setItems((prev) => prev.map((i) => (i.asin === p.asin ? { ...i, monitorado: alvo } : i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setSalvando(null);
    }
  }

  async function search(query: string) {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Erro na busca.");
      setItems(data.items);
      setTotal(data.total);
      setNextToken(data.nextToken);
      setSearchedQuery(query.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  // ?q= vindo dos chips do histórico: preenche o campo e já busca, uma vez só.
  // Lemos de window.location em vez de useSearchParams para não exigir Suspense.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    const initial = new URLSearchParams(window.location.search).get("q")?.trim();
    if (!initial) return;
    // Não dá para semear o estado inicial direto: no SSR não existe window, e o valor
    // divergente entre servidor e cliente quebraria a hidratação. Roda uma vez só.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQ(initial);
    void search(initial);
  }, []);

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
      }
    } finally {
      setLoading(false);
    }
  }

  // Sem conseguir consultar a logística, o filtro não pode esconder nada: o que
  // não foi verificado não é "sem FBA".
  const fbaIndisponivel = items.length > 0 && items.every((i) => !i.fbaChecked);
  const filtrados = somenteFba && !fbaIndisponivel ? items.filter((i) => i.fbaPrice != null) : items;
  const sorted = [...filtrados].sort((a, b) => {
    if (sort === "bsr") return (a.salesRank ?? Infinity) - (b.salesRank ?? Infinity);
    if (sort === "fba") return (a.fbaPrice ?? Infinity) - (b.fbaPrice ?? Infinity);
    const da = effectiveDate(a) ? new Date(effectiveDate(a)!).getTime() : 0;
    const db = effectiveDate(b) ? new Date(effectiveDate(b)!).getTime() : 0;
    return sort === "recentes" ? db - da : da - db;
  });

  // Piso do nicho: menor preço entre quem vende por FBA nos resultados carregados.
  const comFba = items.filter((i) => i.fbaPrice != null);
  const pisoFba = comFba.length ? Math.min(...comFba.map((i) => i.fbaPrice!)) : null;

  return (
    <div className="research-page analysis-page research-workspace">
      <PageHeader
        eyebrow="Inteligência de mercado"
        title="Pesquisa de produtos"
        icon={pageIcons.search}
        subtitle={
          <>
            Busque qualquer termo como na Amazon e veja, de <strong>todos</strong> os anúncios,
            quando cada um foi criado e sua posição de vendas atual. Marque <strong>monitorar</strong>
            nos que interessam e eles passam a ser fotografados todo dia no{" "}
            <Link href="/amazon/pesquisa/historico" className="font-medium text-blue-600 hover:underline">histórico</Link>.
          </>
        }
        action={
          <Link
            href="/amazon/pesquisa/historico"
            className={`${styles.headerAction} listing-refresh`}
          >
            Ver histórico
          </Link>
        }
      />

      <form onSubmit={run} className="search-deck research-searchbar">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ex: cadeira gamer, fone bluetooth, tapete de yoga…"
          className="flex-1 rounded-lg border border-[var(--line-strong)] px-4 py-2.5 focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-blue-600 px-6 py-2.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Buscando…" : "Pesquisar"}
        </button>
      </form>

      <details className="group research-explainer">
        <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 font-medium text-[var(--ink-soft)] marker:content-['']">
          <span className="text-blue-600 transition-transform group-open:rotate-90">▶</span>
          Entenda as colunas: por que “Anúncio criado” e “Idade da linha” diferem?
        </summary>
        <div className="space-y-3 border-t border-[var(--line-strong)] px-4 py-3 text-[var(--ink-soft)]">
          <p>
            Muitos produtos são vendidos em várias <strong>cores/tamanhos</strong>. Cada cor ou
            tamanho é um <strong>anúncio (ASIN) separado</strong>, com sua própria data — mas
            todos ficam agrupados sob um <strong>produto-pai</strong>, e{" "}
            <strong>compartilham as avaliações</strong>.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--line-strong)] bg-white p-3">
              <p className="font-semibold text-[var(--ink)]">Anúncio criado</p>
              <p className="mt-1 text-xs">
                Data de disponibilização <em>daquela variação específica</em> (aquela cor/tamanho).
                Se o vendedor adicionou uma cor nova hoje a um produto antigo, essa data é recente.
              </p>
            </div>
            <div className="rounded-lg border border-[var(--line-strong)] bg-white p-3">
              <p className="font-semibold text-[var(--ink)]">Idade da linha</p>
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
          <p className="text-xs text-[var(--ink-muted)]">
            Ressalva honesta: se o vendedor <em>relistou</em> o produto do zero (ASIN novo, sem
            variação), a data reseta e a fonte não informa a idade real — somente a avaliação
            mais antiga poderia indicar isso, mas o histórico de reviews não está disponível.
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

      {items.length > 0 && (
        <div className="filter-toolbar research-controls">
          <div>
            <p className="text-sm text-[var(--ink-muted)]">{items.length} de ~{total.toLocaleString("pt-BR")} resultados</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void search(searchedQuery)}
              disabled={loading}
              className="rounded-lg border border-[var(--line-strong)] bg-white px-3 py-2 text-xs font-medium text-[var(--ink-soft)] hover:border-blue-400 hover:text-blue-600 disabled:opacity-50"
            >
              {loading ? "Atualizando…" : "Atualizar resultados"}
            </button>
            <button
              type="button"
              onClick={() => setSomenteFba((v) => !v)}
              aria-pressed={somenteFba}
              title="Mostra apenas anúncios que têm oferta com logística da Amazon — são esses que definem o piso de preço do nicho"
              className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                somenteFba
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-[var(--line-strong)] bg-white text-[var(--ink-soft)] hover:border-blue-400 hover:text-blue-600"
              }`}
            >
              {somenteFba ? "✓ " : ""}Somente FBA
              {comFba.length > 0 && (
                <span className="ml-1.5 font-normal opacity-70">({comFba.length})</span>
              )}
            </button>
            {fbaIndisponivel && (
              <span
                role="status"
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700"
              >
                Logística não consultada — o filtro fica inativo em vez de esconder o que não foi verificado
              </span>
            )}
            <div className="flex gap-1 rounded-lg border border-[var(--line-strong)] bg-white p-1 text-xs">
            {([["recentes", "Mais novos"], ["antigos", "Mais antigos"], ["bsr", "Melhor posição"], ["fba", "Menor preço FBA"]] as const).map(
              ([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSort(k)}
                  aria-pressed={sort === k}
                  className={`rounded-md px-3 py-1.5 font-medium ${
                    sort === k ? "bg-blue-100 text-blue-700" : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
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

      <section className={`${styles.resultsShell} listing-table-shell research-results-shell`} aria-labelledby="research-results-title">
        <header className={styles.resultsHeader}>
          <div>
            <p className="section-kicker">Mercado Amazon</p>
            <h2 id="research-results-title">
              {searched ? `${sorted.length} ${sorted.length === 1 ? "produto encontrado" : "produtos encontrados"}` : "Encontre e compare produtos"}
            </h2>
          </div>
          <p aria-live="polite">
            {searched ? (
              <><span>Busca</span><strong title={searchedQuery}>{searchedQuery}</strong><span>· {items.length} de ~{total.toLocaleString("pt-BR")}</span></>
            ) : "Preço, concorrência, idade e posição"}
          </p>
        </header>
        <div className={styles.tableViewport}><table className={`${styles.table} listing-table research-table`}>
          <caption className="sr-only">Resultados da pesquisa de anúncios da Amazon</caption>
          <thead>
            <tr>
              <th scope="col">Produto</th>
              <th
                scope="col"
                className="text-right"
                title={
                  somenteFba
                    ? "Menor preço entre as ofertas com logística da Amazon (FBA)"
                    : "Preço competitivo (buy box)"
                }
              >
                {somenteFba ? "Preço FBA" : "Preço"}
              </th>
              <th
                scope="col"
                className="text-right"
                title="Quantidade de ofertas ativas concorrendo neste produto"
              >
                Concorrentes
              </th>
              <th scope="col" className="text-right">Idade / criação</th>
              <th
                scope="col"
                className="text-right"
                title="Posição atual de vendas na categoria. Quanto menor, melhor."
              >
                Posição de vendas
              </th>
              <th scope="col" className="text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {!searched ? (
              <tr>
                <td colSpan={6} className="px-4 py-6"><EmptyState kind="search" title="Pesquise o mercado Amazon" description="Digite um produto, marca ou palavra-chave para comparar anúncios, preços e concorrência." /></td>
              </tr>
            ) : loading && items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8"><TableLoading label="Buscando anúncios" /></td>
              </tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6"><EmptyState kind="search" title="Nenhum anúncio encontrado" description="Tente uma palavra mais ampla, outra grafia ou remova detalhes do termo pesquisado." /></td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6"><EmptyState kind="search" title="Nenhum anúncio com logística da Amazon" description="Dos resultados carregados, nenhum tem oferta FBA. Clique em “Carregar mais” para buscar outras páginas ou desligue o filtro." /></td></tr>
            ) : (
              sorted.map((p) => {
                const eff = effectiveDate(p);
                const age = ageLabel(eff);
                const isNew = eff && REFERENCE_NOW - new Date(eff).getTime() < 180 * 86400000;
                return (
                  <tr key={p.asin} className={styles.resultRow}>
                    <td className={styles.productCell}>
                      <div className={styles.productIdentity}>
                        {p.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imageUrl} alt="" className={styles.productImage} />
                        )}
                        <div className={styles.productCopy}>
                          <p className={styles.productTitle}>
                            {p.title || p.asin}
                            {p.isVariation && (
                              <span
                                className={styles.variationBadge}
                                title="Variação (cor/tamanho). A idade mostrada é a da linha do produto (produto-pai)."
                              >
                                variação
                              </span>
                            )}
                          </p>
                          <p className={styles.productMeta}>
                            <code>{p.asin}</code>
                            {p.brand ? <span>{p.brand}</span> : null}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className={styles.metricCell} data-label={somenteFba ? "Preço FBA" : "Preço"}>
                      {somenteFba ? (
                        <span className={styles.inlineMetric}>
                          <strong className={styles.metricValue}>{money(p.fbaPrice, p.currency)}</strong>
                          {p.fbaPrice != null && p.fbaPrice === pisoFba && (
                            <span
                              className={styles.floorBadge}
                              title="Menor preço FBA entre os resultados carregados"
                            >
                              piso
                            </span>
                          )}
                        </span>
                      ) : (
                        <strong className={styles.metricValue}>{money(p.price, p.currency)}</strong>
                      )}
                    </td>
                    <td className={styles.metricCell} data-label="Concorrentes">
                      <strong className={styles.metricValue}>{p.offerCount != null ? p.offerCount : "—"}</strong>
                      {p.offerCount != null ? <span className={styles.metricCaption}>{p.offerCount === 1 ? "oferta ativa" : "ofertas ativas"}</span> : null}
                    </td>
                    <td className={styles.metricCell} data-label="Idade / criação">
                      <div className={styles.metricStack}>
                        {age ? (
                          <strong
                            className={`${styles.metricValue} ${isNew ? styles.positiveValue : ""}`}
                            title={
                              p.isVariation
                                ? `Idade da linha (produto-pai ${p.parentAsin})`
                                : "Idade do anúncio"
                            }
                          >
                            {age}
                            {p.isVariation && <small>· variação</small>}
                          </strong>
                        ) : (
                          <strong className={styles.metricValue}>—</strong>
                        )}
                        <span className={styles.metricCaption}>
                          criado em {fmtDate(p.launchDate)}
                        </span>
                      </div>
                    </td>
                    <td className={styles.metricCell} data-label="Posição de vendas">
                      {p.salesRank ? (
                        <div className={styles.metricStack}>
                          <span className={styles.rankLine}>
                            {/* O RANK vem primeiro: é o dado. O delta é contexto,
                                e vinha antes — o olho lia a variação como se fosse
                                a posição (23/08/2026). */}
                            <strong className={styles.metricValue}>#{p.salesRank.toLocaleString("pt-BR")}</strong>
                            {p.rankDelta != null && (
                              <span
                                className={`${styles.rankDelta} ${
                                  p.rankDelta > 0 ? styles.positiveValue : p.rankDelta < 0 ? styles.negativeValue : styles.neutralValue
                                }`}
                                title={
                                  p.rankDelta === 0
                                    ? `Manteve a mesma posição desde ${p.rankPrevDate ? fmtDate(p.rankPrevDate) : "a última foto"}`
                                    : `${p.rankDelta > 0 ? "Melhorou" : "Piorou"} ${Math.abs(p.rankDelta).toLocaleString("pt-BR")} posições desde ${p.rankPrevDate ? fmtDate(p.rankPrevDate) : "a última foto"} — o número ${p.rankDelta > 0 ? "caiu" : "subiu"}`
                                }
                              >
                                {/* A seta segue o número (coluna Posição); a cor segue a qualidade. */}
                                {p.rankDelta > 0 ? (
                                  <ArrowDown className="h-3.5 w-3.5 shrink-0" strokeWidth={3} aria-hidden />
                                ) : p.rankDelta < 0 ? (
                                  <ArrowUp className="h-3.5 w-3.5 shrink-0" strokeWidth={3} aria-hidden />
                                ) : (
                                  <ArrowRight className="h-3.5 w-3.5 shrink-0" strokeWidth={3} aria-hidden />
                                )}
                                {Math.abs(p.rankDelta).toLocaleString("pt-BR")}
                              </span>
                            )}
                          </span>
                          {p.salesRankCategory && (
                            <span className={`${styles.metricCaption} ${styles.rankCaption}`} title={p.salesRankCategory}>
                              em {p.salesRankCategory}
                            </span>
                          )}
                          {p.subRank && p.subRankCategory !== p.salesRankCategory && (
                            <span className={`${styles.metricCaption} ${styles.rankCaption} ${styles.positiveValue}`} title={`Subcategoria: ${p.subRankCategory}`}>
                              #{p.subRank.toLocaleString("pt-BR")} em {p.subRankCategory}
                            </span>
                          )}
                        </div>
                      ) : "—"}
                    </td>
                    <td className={styles.actionsCell} data-label="Ações">
                      <div className={styles.actions}>
                        <button
                          type="button"
                          onClick={() => void alternarMonitor(p)}
                          disabled={salvando === p.asin}
                          aria-pressed={!!p.monitorado}
                          title={
                            p.monitorado
                              ? "Parar de acompanhar — o histórico já coletado é preservado"
                              : "Acompanhar este anúncio: a posição passa a ser fotografada todo dia"
                          }
                          className={`${styles.actionButton} ${p.monitorado ? styles.monitoringAction : ""}`}
                        >
                          {p.monitorado ? (
                            <>
                              <Eye className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
                              Monitorando
                            </>
                          ) : (
                            <>
                              <EyeOff className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
                              Monitorar
                            </>
                          )}
                        </button>
                        <Link
                          href={`/calculadora?asin=${p.asin}`}
                          className={`${styles.actionButton} ${styles.primaryAction}`}
                        >
                          Calcular
                        </Link>
                        <a
                          href={`https://www.amazon.com.br/dp/${p.asin}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.actionButton}
                        >
                          Abrir ↗
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table></div>

      {nextToken && (
        <div className="research-load-more">
          <button
            onClick={loadMore}
            disabled={loading}
            className="rounded-lg border border-[var(--line-strong)] px-6 py-2 text-sm font-medium hover:bg-[var(--ink-05)] disabled:opacity-50"
          >
            {loading ? "Carregando…" : "Carregar mais"}
          </button>
        </div>
      )}
      </section>

      {items.length > 0 && (
        <div className="space-y-1 text-xs text-[var(--ink-muted)]">
          <p>
            <strong className="text-[var(--ink-muted)]">Anúncio criado</strong> = data deste ASIN
            específico (cor/tamanho). <strong className="text-[var(--ink-muted)]">Idade da linha</strong> =
            idade do produto no mercado; para <span className="text-violet-600">variações</span>,
            usa a data do produto-pai (a família compartilha as avaliações, por isso a data do
            anúncio pode ser mais recente que reviews antigas).
          </p>
          <p>Badge verde = linha com menos de 6 meses. Quanto menor a posição, maior a força de vendas dentro daquela categoria.</p>
          <p>Para uma comparação justa, avalie posições de produtos pertencentes à mesma categoria.</p>
        </div>
      )}
    </div>
  );
}
