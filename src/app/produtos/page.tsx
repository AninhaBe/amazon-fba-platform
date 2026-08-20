"use client";

import { useEffect, useState } from "react";
import { PageHeader, pageIcons } from "../components/PageHeader";
import { TableLoading } from "../components/LoadingState";
import { EmptyState } from "../components/EmptyState";
import { readJson } from "../../lib/readJson";
import { Pagination } from "../components/Pagination";

interface Product {
  id: string;
  sku?: string;
  asin?: string;
  title?: string;
  imageUrl?: string;
  salePrice: number | null;
  fulfillable?: number | null;
  cost: number | null;
  source: "listing" | "fba" | "manual" | "tiktok";
}

function money(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

const PAGE_SIZE = 30;

export default function ProdutosPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [costFilter, setCostFilter] = useState<"all" | "missing" | "complete">("all");
  const [sort, setSort] = useState<"title" | "stock" | "cost">("title");
  const [draftCosts, setDraftCosts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [page, setPage] = useState(1);

  // adicionar por ASIN
  const [newAsin, setNewAsin] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/products");
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Erro ao carregar produtos.");
      setProducts(data.products);
      setDraftCosts(Object.fromEntries(data.products.map((p: Product) => [p.id, p.cost == null ? "" : String(p.cost)])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function saveCost(p: Product, cost: number) {
    const previous = p.cost;
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, cost } : x)));
    setSaveState((prev) => ({ ...prev, [p.id]: "saving" }));
    try {
      const res = await fetch("/api/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, sku: p.sku, asin: p.asin, title: p.title, imageUrl: p.imageUrl, cost }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Erro ao salvar custo.");
      setSaveState((prev) => ({ ...prev, [p.id]: "saved" }));
    } catch {
      setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, cost: previous } : x)));
      setDraftCosts((prev) => ({ ...prev, [p.id]: previous == null ? "" : String(previous) }));
      setSaveState((prev) => ({ ...prev, [p.id]: "error" }));
    }
  }

  // Ponto único de confirmação do custo: usado pelo Enter, pelo botão "Cadastrar" e
  // pelo blur. Ignora valor vazio/inválido e evita salvar quando nada mudou.
  function commitCost(p: Product, raw: string) {
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value) || value < 0) return;
    if (value === (p.cost ?? 0)) return;
    void saveCost(p, value);
  }

  // Só habilita o botão quando há um valor novo e válido para gravar.
  function canCommit(p: Product): boolean {
    const raw = draftCosts[p.id] ?? "";
    const value = Number(raw);
    return raw.trim() !== "" && Number.isFinite(value) && value >= 0 && value !== (p.cost ?? 0);
  }

  async function addByAsin(e: React.FormEvent) {
    e.preventDefault();
    const asin = newAsin.trim();
    if (!asin) return;
    setAdding(true);
    setAddError(null);
    try {
      // Busca título/imagem no catálogo (reusa /api/price)
      const infoRes = await fetch(`/api/price?asin=${encodeURIComponent(asin)}`);
      const info = await readJson(infoRes);
      if (!infoRes.ok) throw new Error(info.error || "ASIN não encontrado.");
      const title = info?.info?.title;
      const imageUrl = info?.info?.imageUrl;
      const saveRes = await fetch("/api/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: asin, asin, title, imageUrl, cost: 0 }),
      });
      const saved = await readJson(saveRes);
      if (!saveRes.ok) throw new Error(saved.error || "Erro ao adicionar produto.");
      setNewAsin("");
      setAddOpen(false);
      await load();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Não foi possível adicionar esse ASIN.");
    } finally {
      setAdding(false);
    }
  }

  async function remove(p: Product) {
    if (!window.confirm(`Remover ${p.title || p.asin || p.id} da lista manual?`)) return;
    const previous = products;
    setProducts((prev) => prev.filter((x) => x.id !== p.id));
    try {
      const res = await fetch(`/api/costs?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Erro ao remover produto.");
    } catch (err) {
      setProducts(previous);
      setError(err instanceof Error ? err.message : "Erro ao remover produto.");
    }
  }

  // Esta página é da Amazon. O TikTok tem superfície própria e isolada
  // (/tiktok/produtos → /api/integrations/tiktok/costs, com requireTiktokConnection).
  const scopedProducts = products;
  const withCost = scopedProducts.filter((p) => p.cost != null && p.cost > 0).length;
  const missingCost = scopedProducts.length - withCost;
  const visibleProducts = scopedProducts
    .filter((p) => {
      const matchesQuery = `${p.title || ""} ${p.sku || ""} ${p.asin || ""}`.toLowerCase().includes(query.toLowerCase());
      const hasCost = p.cost != null && p.cost > 0;
      return matchesQuery && (costFilter === "all" || (costFilter === "complete" ? hasCost : !hasCost));
    })
    .sort((a, b) => {
      if (sort === "stock") return (b.fulfillable ?? -1) - (a.fulfillable ?? -1);
      if (sort === "cost") return (b.cost ?? -1) - (a.cost ?? -1);
      return (a.title || a.id).localeCompare(b.title || b.id, "pt-BR");
    });

  const pageCount = Math.max(1, Math.ceil(visibleProducts.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const paged = visibleProducts.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <div className="products-page listing-page">
      <PageHeader
        eyebrow="Custos e cobertura Amazon"
        title="Produtos"
        icon={pageIcons.box}
        subtitle="Complete os custos que transformam repasse em lucro real. Preço e estoque continuam vindo dos canais conectados."
        action={<button type="button" className="listing-refresh" aria-expanded={addOpen} onClick={() => setAddOpen((open) => !open)}>{addOpen ? "Fechar cadastro" : "Adicionar por ASIN"}</button>}
      />

      {addOpen && (
        <form onSubmit={addByAsin} className="product-add-panel">
          <div><strong>Adicionar produto manual</strong><span>Use o ASIN para buscar título e imagem antes de cadastrar o custo.</span></div>
          <label><span className="sr-only">ASIN do produto</span><input value={newAsin} onChange={(event) => setNewAsin(event.target.value)} placeholder="B0XXXXXXXX" autoFocus /></label>
          <button type="submit" disabled={adding || newAsin.trim() === ""}>{adding ? "Adicionando…" : "Adicionar"}</button>
          {addError && <span role="alert" className="product-add-error">{addError}</span>}
        </form>
      )}

      {error && <div role="alert" className="listing-error"><div><strong>Não foi possível carregar os produtos.</strong><p>{error}</p></div><button type="button" onClick={() => void load()}>Tentar novamente</button></div>}

      {!loading && products.length > 0 && (
        <section className="listing-summary-band" aria-label="Cobertura de custos">
          <div><span>Produtos</span><strong>{scopedProducts.length.toLocaleString("pt-BR")}</strong><small>sincronizados e manuais</small></div>
          <div className="is-positive"><span>Com custo</span><strong>{withCost.toLocaleString("pt-BR")}</strong><small>{Math.round((withCost / scopedProducts.length) * 100)}% da base</small></div>
          <div className={missingCost > 0 ? "is-warning" : "is-positive"}><span>Sem custo</span><strong>{missingCost.toLocaleString("pt-BR")}</strong><small>{missingCost > 0 ? "pendentes para lucro real" : "cobertura completa"}</small></div>
        </section>
      )}

      {!loading && products.length > 0 && (
        <section className="listing-controls cols-3" aria-label="Filtros dos produtos">
          <label className="listing-search"><span className="sr-only">Buscar produto</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Buscar título, SKU ou ASIN" /></label>
          <select value={costFilter} onChange={(event) => { setCostFilter(event.target.value as typeof costFilter); setPage(1); }} aria-label="Filtrar cobertura de custo"><option value="all">Todos os custos</option><option value="missing">Sem custo</option><option value="complete">Com custo</option></select>
          <select value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setPage(1); }} aria-label="Ordenar produtos"><option value="title">Ordenar por nome</option><option value="stock">Maior estoque</option><option value="cost">Maior custo</option></select>
        </section>
      )}

      <section className="listing-table-shell product-table-shell" aria-labelledby="product-results-title">
        <header><div><p className="section-kicker">Base de custos</p><h2 id="product-results-title">{loading ? "Carregando produtos" : `${visibleProducts.length} ${visibleProducts.length === 1 ? "produto encontrado" : "produtos encontrados"}`}</h2></div><p>{withCost} de {scopedProducts.length} com custo cadastrado</p></header>
        <div className="overflow-x-auto">
          <table className="listing-table product-table">
            <caption className="sr-only">Produtos, estoque, preço de venda e custo cadastrado</caption>
            <thead><tr><th>Produto</th><th>Origem</th><th>Estoque</th><th>Preço de venda</th><th>Custo unitário</th><th><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={6}><TableLoading label="Puxando anúncios da conta Amazon" /></td></tr> : products.length === 0 ? <tr><td colSpan={6}><EmptyState title="Nenhum produto sincronizado" description="Anúncios ativos aparecem automaticamente. Você também pode adicionar um produto pelo ASIN." /></td></tr> : visibleProducts.length === 0 ? <tr><td colSpan={6}><EmptyState kind="search" title="Nenhum produto encontrado" description="Ajuste a busca ou altere o filtro de custos." /></td></tr> : paged.map((product) => (
                <tr key={product.id}>
                  <td><div className="listing-product product-identity">{product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product.imageUrl} alt="" loading="lazy" />
                  ) : <span className="listing-image-fallback" aria-hidden="true">AMZ</span>}<div><strong title={product.title}>{product.title || product.id}</strong><small>{product.sku ? `SKU ${product.sku}` : ""}{product.sku && product.asin ? " · " : ""}{product.asin ? `ASIN ${product.asin}` : ""}</small></div></div></td>
                  <td><span className={`product-source is-${product.source}`}>{product.source === "manual" ? "Manual" : product.source === "fba" ? "FBA" : product.source === "tiktok" ? "TikTok Shop" : "Anúncio"}</span></td>
                  <td className="tabular-nums">{product.fulfillable ?? "—"}</td>
                  <td className="tabular-nums">{product.salePrice == null ? "—" : money(product.salePrice)}</td>
                  <td><div className="product-cost-editor"><label><span>R$</span><input type="number" step="0.01" min="0" value={draftCosts[product.id] ?? ""} onChange={(event) => setDraftCosts((previous) => ({ ...previous, [product.id]: event.target.value }))} onKeyDown={(event) => { if (event.key !== "Enter") return; event.preventDefault(); commitCost(product, event.currentTarget.value); event.currentTarget.blur(); }} onBlur={(event) => commitCost(product, event.target.value)} aria-label={`Custo de ${product.title || product.id}`} aria-describedby={`cost-status-${product.id}`} placeholder="0,00" className={`product-cost-input ${product.cost == null || product.cost === 0 ? "is-missing" : ""}`} /></label><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => commitCost(product, draftCosts[product.id] ?? "")} disabled={!canCommit(product)} title={canCommit(product) ? "Salvar custo" : "Digite um custo diferente do atual"}>Salvar</button><small id={`cost-status-${product.id}`} aria-live="polite" className={saveState[product.id] === "error" ? "is-error" : ""}>{saveState[product.id] === "saving" ? "Salvando…" : saveState[product.id] === "saved" ? "Salvo" : saveState[product.id] === "error" ? "Falha ao salvar" : product.cost == null || product.cost === 0 ? "Pendente" : ""}</small></div></td>
                  <td>{product.source === "manual" ? <button type="button" onClick={() => void remove(product)} className="listing-row-danger" title="Remover produto manual">Remover</button> : <span className="listing-open is-disabled" aria-hidden="true">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && pageCount > 1 && <div className="listing-pagination"><Pagination page={current} pageCount={pageCount} total={visibleProducts.length} pageSize={PAGE_SIZE} onPage={setPage} /></div>}
      </section>

      <p className="listing-method-note">O custo é salvo ao pressionar <kbd>Enter</kbd>, ao sair do campo ou em Salvar. Produtos sem custo permanecem fora do lucro real; nenhum valor é extrapolado.</p>
    </div>
  );
}
