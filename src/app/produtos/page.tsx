"use client";

import { useEffect, useState } from "react";
import { PageHeader, pageIcons } from "../components/PageHeader";

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveCost(p: Product, cost: number) {
    // otimista
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, cost } : x)));
    await fetch("/api/costs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: p.id,
        sku: p.sku,
        asin: p.asin,
        title: p.title,
        imageUrl: p.imageUrl,
        cost,
      }),
    });
  }

  async function addByAsin(e: React.FormEvent) {
    e.preventDefault();
    const asin = newAsin.trim();
    if (!asin) return;
    setAdding(true);
    setAddError(null);
    try {
      // Busca título/imagem no catálogo (reusa /api/price)
      const info = await fetch(`/api/price?asin=${encodeURIComponent(asin)}`).then((r) => r.json());
      const title = info?.info?.title;
      const imageUrl = info?.info?.imageUrl;
      await fetch("/api/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: asin, asin, title, imageUrl, cost: 0 }),
      });
      setNewAsin("");
      await load();
    } catch {
      setAddError("Não foi possível adicionar esse ASIN.");
    } finally {
      setAdding(false);
    }
  }

  async function remove(p: Product) {
    setProducts((prev) => prev.filter((x) => x.id !== p.id));
    await fetch(`/api/costs?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
  }

  const withCost = products.filter((p) => p.cost != null && p.cost > 0).length;

  return (
    <div className="space-y-8">
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
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
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
        {addError && <span className="w-full text-xs text-red-600">{addError}</span>}
      </form>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && products.length > 0 && (
        <p className="text-sm text-slate-500">
          {products.length} produto(s) · {withCost} com custo cadastrado
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white shadow-sm ring-1 ring-slate-900/[0.02]">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Produto</th>
              <th className="px-4 py-3">Origem</th>
              <th className="px-4 py-3 text-right">Estoque</th>
              <th className="px-4 py-3 text-right">Preço venda</th>
              <th className="px-4 py-3 text-right">Custo (R$)</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  Puxando anúncios da conta… (o relatório da Amazon pode levar alguns segundos)
                </td>
              </tr>
            ) : products.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">
                  Nenhum produto encontrado na conta ainda. Quando você tiver anúncios ativos,
                  eles aparecem aqui automaticamente. Enquanto isso, dá pra adicionar por ASIN
                  acima.
                </td>
              </tr>
            ) : (
              products.map((p) => (
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
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={p.cost ?? ""}
                      onBlur={(e) => {
                        const v = Number(e.target.value) || 0;
                        if (v !== (p.cost ?? 0)) saveCost(p, v);
                      }}
                      placeholder="0.00"
                      className={`w-24 rounded-md border px-2 py-1 text-right text-sm tabular-nums focus:border-blue-500 focus:outline-none ${
                        p.cost == null || p.cost === 0
                          ? "border-amber-300 bg-amber-50"
                          : "border-slate-300"
                      }`}
                    />
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
