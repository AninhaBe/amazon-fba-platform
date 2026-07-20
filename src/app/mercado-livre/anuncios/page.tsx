"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { PanelLoading } from "../../components/LoadingState";
import { PageHeader, pageIcons } from "../../components/PageHeader";

interface Listing {
  id: string;
  sku: string | null;
  title: string;
  price: number;
  currency: string;
  availableQuantity: number;
  soldQuantity: number;
  status: string;
  activeSince: string | null;
  lastUpdated: string | null;
  thumbnail: string | null;
  permalink: string | null;
  userProductId: string | null;
  listingTypeId: string | null;
  logisticType: string | null;
  shippingMode: string | null;
  freeShipping: boolean;
  catalogListing: boolean;
  catalogProductId: string | null;
}

interface ListingsResponse {
  products: Listing[];
  total: number;
  activeTotal: number;
  complete: boolean;
}

type StatusFilter = "all" | "active" | "paused" | "closed" | "out";
type ListingFilter = "all" | "classic" | "premium" | "catalog";
type SortKey = "updated" | "sold" | "stock" | "price";

const statusLabels: Record<string, string> = {
  active: "Ativo",
  paused: "Pausado",
  closed: "Encerrado",
  inactive: "Inativo",
  under_review: "Em revisão",
};

const logisticLabels: Record<string, string> = {
  fulfillment: "Full",
  self_service: "Flex",
  cross_docking: "Coleta",
  xd_drop_off: "Agência",
  drop_off: "Agência",
  custom: "Envio próprio",
  not_specified: "A combinar",
};

function money(value: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

function listingType(value: string | null) {
  if (value === "gold_pro" || value === "gold_premium") return "Premium";
  if (value === "gold_special") return "Clássico";
  return value ? value.replaceAll("_", " ") : "Não informado";
}

function logistics(listing: Listing) {
  return logisticLabels[listing.logisticType || ""] || listing.logisticType?.replaceAll("_", " ") || (listing.shippingMode === "me2" ? "Mercado Envios" : "Não informado");
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("pt-BR") : "—";
}

export default function MercadoLivreListingsPage() {
  const [data, setData] = useState<ListingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<ListingFilter>("all");
  const [sort, setSort] = useState<SortKey>("updated");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations/mercado-livre/products", { cache: "no-store" });
      const body = await response.json();
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

  const products = useMemo(() => data?.products ?? [], [data]);
  const paused = products.filter((product) => product.status === "paused").length;
  const withoutStock = products.filter((product) => product.status === "active" && product.availableQuantity <= 0).length;
  const catalog = products.filter((product) => product.catalogListing).length;

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return [...products]
      .filter((product) => !normalized || `${product.title} ${product.id} ${product.sku || ""} ${product.userProductId || ""}`.toLocaleLowerCase("pt-BR").includes(normalized))
      .filter((product) => status === "all" || (status === "out" ? product.status === "active" && product.availableQuantity <= 0 : product.status === status))
      .filter((product) => kind === "all" || (kind === "catalog" ? product.catalogListing : kind === "premium" ? listingType(product.listingTypeId) === "Premium" : listingType(product.listingTypeId) === "Clássico"))
      .sort((a, b) => {
        if (sort === "sold") return b.soldQuantity - a.soldQuantity;
        if (sort === "stock") return a.availableQuantity - b.availableQuantity;
        if (sort === "price") return b.price - a.price;
        return new Date(b.lastUpdated || b.activeSince || 0).getTime() - new Date(a.lastUpdated || a.activeSince || 0).getTime();
      });
  }, [kind, products, query, sort, status]);

  return (
    <div className="meli-listings-page space-y-8">
      <PageHeader
        eyebrow="Catálogo Mercado Livre"
        title="Anúncios"
        subtitle="Acompanhe publicação, preço, estoque, modalidade e logística de cada anúncio da conta conectada."
        icon={pageIcons.search}
        action={<button type="button" onClick={() => void load()} disabled={loading} className="listing-refresh">{loading ? "Atualizando…" : "Atualizar anúncios"}</button>}
      />

      {loading && !data ? <PanelLoading label="Carregando anúncios do Mercado Livre" /> : error || !data ? (
        <EmptyState title="Não foi possível carregar os anúncios" description={error || "Conecte sua conta para visualizar o catálogo publicado."} action={<Link href="/integracoes" className="meli-primary-action">Gerenciar integração <span aria-hidden="true">→</span></Link>} />
      ) : (
        <>
          <section className="metric-grid grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Resumo dos anúncios">
            <ListingMetric label="Anúncios carregados" value={products.length} note={data.complete ? "catálogo sincronizado" : `de ${data.total} encontrados`} />
            <ListingMetric label="Ativos" value={data.activeTotal} note="publicados no marketplace" />
            <ListingMetric label="Pausados" value={paused} note="fora da exposição" />
            <ListingMetric label="Sem estoque" value={withoutStock} note={`${catalog} anúncio(s) de catálogo`} danger={withoutStock > 0} />
          </section>

          {!data.complete && <div className="listing-coverage-note"><span aria-hidden="true">!</span><p>Esta visão carregou {products.length} de {data.total} anúncios. Os filtros abaixo consideram somente o lote sincronizado.</p></div>}

          <section className="listing-controls" aria-label="Filtros dos anúncios">
            <label className="listing-search"><span className="sr-only">Buscar anúncio</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar título, SKU, MLB ou MLBU" /></label>
            <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} aria-label="Filtrar status"><option value="all">Todos os status</option><option value="active">Ativos</option><option value="paused">Pausados</option><option value="closed">Encerrados</option><option value="out">Sem estoque</option></select>
            <select value={kind} onChange={(event) => setKind(event.target.value as ListingFilter)} aria-label="Filtrar modalidade"><option value="all">Todas as modalidades</option><option value="classic">Clássico</option><option value="premium">Premium</option><option value="catalog">Catálogo</option></select>
            <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="Ordenar anúncios"><option value="updated">Atualizados recentemente</option><option value="sold">Mais vendidos</option><option value="stock">Menor estoque</option><option value="price">Maior preço</option></select>
          </section>

          <section className="listing-table-shell" aria-labelledby="listing-results-title">
            <header>
              <div><p className="section-kicker">Catálogo publicado</p><h2 id="listing-results-title">{visible.length} {visible.length === 1 ? "anúncio encontrado" : "anúncios encontrados"}</h2></div>
              <p>Dados da última sincronização da conta</p>
            </header>
            {visible.length === 0 ? <EmptyState kind="search" title="Nenhum anúncio encontrado" description="Ajuste a busca ou remova algum filtro para ampliar os resultados." /> : (
              <div className="overflow-x-auto">
                <table className="listing-table">
                  <caption className="sr-only">Anúncios publicados no Mercado Livre</caption>
                  <thead><tr><th>Produto</th><th>Status</th><th>Modalidade</th><th className="text-right">Preço</th><th className="text-right">Estoque</th><th className="text-right">Vendidos</th><th>Logística</th><th><span className="sr-only">Ações</span></th></tr></thead>
                  <tbody>{visible.map((product) => (
                    <tr key={product.id}>
                      <td><div className="listing-product">
                        {product.thumbnail ? (
                          // A miniatura já chega reduzida pelo catálogo do canal.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={product.thumbnail} alt="" />
                        ) : <span className="listing-image-fallback" aria-hidden="true">ML</span>}
                        <div><strong title={product.title}>{product.title}</strong><small>{product.sku ? `SKU ${product.sku} · ` : ""}{product.id}</small><small>Atualizado em {formatDate(product.lastUpdated)}</small></div>
                      </div></td>
                      <td><span className={`listing-status is-${product.status}`}>{statusLabels[product.status] || product.status.replaceAll("_", " ")}</span></td>
                      <td><div className="listing-kind"><strong>{listingType(product.listingTypeId)}</strong><small>{product.catalogListing ? "Catálogo" : "Tradicional"}</small></div></td>
                      <td className="text-right font-semibold tabular-nums">{money(product.price, product.currency)}</td>
                      <td className={`text-right font-semibold tabular-nums ${product.availableQuantity <= 0 ? "text-red-600" : ""}`}>{product.availableQuantity}</td>
                      <td className="text-right tabular-nums">{product.soldQuantity}</td>
                      <td><div className="listing-logistics"><strong>{logistics(product)}</strong>{product.freeShipping && <small>Frete grátis</small>}</div></td>
                      <td>{product.permalink ? <a href={product.permalink} target="_blank" rel="noreferrer" className="listing-open" aria-label={`Abrir ${product.title} no Mercado Livre`} title="Abrir anúncio"><span aria-hidden="true">↗</span></a> : <span className="listing-open is-disabled" aria-hidden="true">—</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function ListingMetric({ label, value, note, danger = false }: { label: string; value: number; note: string; danger?: boolean }) {
  return <article className="metric-cell p-5"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><strong className={`mt-3 block text-2xl font-bold tabular-nums ${danger ? "text-red-600" : "text-slate-900"}`}>{value.toLocaleString("pt-BR")}</strong><p className="mt-1 text-xs text-slate-500">{note}</p></article>;
}
