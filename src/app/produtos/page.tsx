"use client";

import { useEffect, useState } from "react";
import { PageHeader, pageIcons } from "../components/PageHeader";
import { TableLoading } from "../components/LoadingState";
import { EmptyState } from "../components/EmptyState";

interface Product {
  id: string;
  sku?: string;
  asin?: string;
  title?: string;
  imageUrl?: string;
  salePrice: number | null;
  fulfillable?: number | null;
  cost: number | null;
  source: "listing" | "fba" | "manual";
}

function money(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export default function ProdutosPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [costFilter, setCostFilter] = useState<"all" | "missing" | "complete">("all");
  const [sort, setSort] = useState<"title" | "stock" | "cost">("title");
  const [draftCosts, setDraftCosts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});

  // adicionar por ASIN
  const [newAsin, setNewAsin] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/products");
      const data = await res.json();
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao salvar custo.");
      setSaveState((prev) => ({ ...prev, [p.id]: "saved" }));
    } catch {
      setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, cost: previous } : x)));
      setDraftCosts((prev) => ({ ...prev, [p.id]: previous == null ? "" : String(previous) }));
      setSaveState((prev) => ({ ...prev, [p.id]: "error" }));
    }
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
      const info = await infoRes.json();
      if (!infoRes.ok) throw new Error(info.error || "ASIN não encontrado.");
      const title = info?.info?.title;
      const imageUrl = info?.info?.imageUrl;
      const saveRes = await fetch("/api/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: asin, asin, title, imageUrl, cost: 0 }),
      });
      const saved = await saveRes.json();
      if (!saveRes.ok) throw new Error(saved.error || "Erro ao adicionar produto.");
      setNewAsin("");
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao remover produto.");
    } catch (err) {
      setProducts(previous);
      setError(err instanceof Error ? err.message : "Erro ao remover produto.");
    }
  }

  const withCost = products.filter((p) => p.cost != null && p.cost > 0).length;
  const visibleProducts = products
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

  return (
    <div className="products-page space-y-8">
      <PageHeader
        eyebrow="FBA Inventory · Catalog"
        title="Produtos"
        icon={pageIcons.box}
        subtitle={
          <>
            Seus produtos são puxados automaticamente da conta (anúncios + estoque FBA), já com o{" "}
            <strong className="text-slate-700">preço de venda</strong>. Você só cadastra o{" "}
            <strong className="text-slate-700">custo</strong> — é ele que permite calcular o lucro
            real das vendas.
          </>
        }
      />

      {/* Adicionar por ASIN */}
      <form
        onSubmit={addByAsin}
        className="catalog-entry flex flex-wrap items-end gap-3 border-y border-slate-300 py-5"
      >
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm font-medium">Adicionar produto por ASIN</span>
          <input
            value={newAsin}
            onChange={(e) => setNewAsin(e.target.value)}
            placeholder="B0XXXXXXXX"
            className="rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={adding}
          className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {adding ? "Adicionando…" : "Adicionar"}
        </button>
        {addError && <span role="alert" className="w-full text-xs text-red-600">{addError}</span>}
      </form>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>{error}</p>
          <button type="button" onClick={() => void load()} className="mt-3 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white">
            Tentar novamente
          </button>
        </div>
      )}

      {!loading && products.length > 0 && (
        <div className="filter-toolbar flex flex-wrap items-end justify-between gap-3">
          <p className="text-sm text-slate-500">
            {visibleProducts.length} de {products.length} produto(s) · {withCost} com custo cadastrado
          </p>
          <div className="flex flex-1 flex-wrap justify-end gap-2">
            <label className="min-w-52 flex-1 sm:max-w-xs">
              <span className="sr-only">Buscar produto</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar SKU, ASIN ou título" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </label>
            <select value={costFilter} onChange={(e) => setCostFilter(e.target.value as typeof costFilter)} aria-label="Filtrar por cadastro de custo" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="all">Todos os custos</option>
              <option value="missing">Sem custo</option>
              <option value="complete">Com custo</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Ordenar produtos" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="title">Ordenar por nome</option>
              <option value="stock">Maior estoque</option>
              <option value="cost">Maior custo</option>
            </select>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white shadow-sm ring-1 ring-slate-900/[0.02]">
        <table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">Produtos, estoque, preço de venda e custo cadastrado</caption>
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-3">Produto</th>
              <th scope="col" className="px-4 py-3">Origem</th>
              <th scope="col" className="px-4 py-3 text-right">Estoque</th>
              <th scope="col" className="px-4 py-3 text-right">Preço venda</th>
              <th scope="col" className="px-4 py-3 text-right">Custo (R$)</th>
              <th scope="col" className="px-4 py-3"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8"><TableLoading label="Puxando anúncios da conta Amazon" /></td>
              </tr>
            ) : products.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6"><EmptyState title="Nenhum produto sincronizado" description="Anúncios ativos aparecem automaticamente. Você também pode começar adicionando um produto pelo ASIN acima." /></td>
              </tr>
            ) : visibleProducts.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6"><EmptyState kind="search" title="Nenhum produto encontrado" description="Ajuste a busca ou altere o filtro de custos." /></td></tr>
            ) : (
              visibleProducts.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {p.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.imageUrl}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded object-contain"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="max-w-[320px] truncate font-medium">
                          {p.title || p.id}
                        </p>
                        <p className="font-mono text-xs text-slate-400">
                          {p.sku ? `SKU ${p.sku}` : ""}
                          {p.sku && p.asin ? " · " : ""}
                          {p.asin ? `ASIN ${p.asin}` : ""}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        p.source === "manual"
                          ? "bg-slate-100 text-slate-600"
                          : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {p.source === "manual" ? "Manual" : p.source === "fba" ? "FBA" : "Anúncio"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                    {p.fulfillable != null ? p.fulfillable : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                    {p.salePrice != null ? money(p.salePrice) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-col items-end gap-1">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={draftCosts[p.id] ?? ""}
                        onChange={(e) => setDraftCosts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v) && v >= 0 && v !== (p.cost ?? 0)) void saveCost(p, v);
                        }}
                        aria-label={`Custo de ${p.title || p.id}`}
                        aria-describedby={`cost-status-${p.id}`}
                        placeholder="0.00"
                        className={`product-cost-input w-24 rounded-md border px-2 py-1 text-right text-sm tabular-nums focus:outline-none ${p.cost == null || p.cost === 0 ? "is-missing" : "border-slate-300"}`}
                      />
                      <span id={`cost-status-${p.id}`} aria-live="polite" className={`text-[10px] ${saveState[p.id] === "error" ? "text-red-600" : "text-slate-400"}`}>
                        {saveState[p.id] === "saving" ? "Salvando…" : saveState[p.id] === "saved" ? "Salvo" : saveState[p.id] === "error" ? "Falha ao salvar" : ""}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.source === "manual" && (
                      <button
                        onClick={() => remove(p)}
                        className="text-xs text-slate-400 hover:text-red-600"
                        title="Remover"
                      >
                        remover
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        O custo é salvo automaticamente ao sair do campo. Campos em amarelo ainda não têm custo
        cadastrado — as vendas desses SKUs não entram no cálculo de lucro real.
      </p>
    </div>
  );
}
