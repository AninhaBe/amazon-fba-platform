"use client";

import { useEffect, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader, pageIcons } from "../../components/PageHeader";
import { TableLoading } from "../../components/LoadingState";

interface Product {
  id: string;
  costId: string;
  sku: string | null;
  title: string;
  price: number;
  currency: string;
  availableQuantity: number;
  soldQuantity: number;
  thumbnail: string | null;
  cost: number | null;
}

function money(value: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

export default function MercadoLivreProdutosPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draftCosts, setDraftCosts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [taxRate, setTaxRate] = useState("");
  const [taxState, setTaxState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch("/api/integrations/mercado-livre/products", { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível carregar os produtos.");
        setProducts(data.products);
        setDraftCosts(Object.fromEntries(data.products.map((product: Product) => [product.costId, product.cost == null ? "" : String(product.cost)])));
      }),
      fetch("/api/integrations/mercado-livre/settings", { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível carregar a alíquota.");
        setTaxRate(String(data.taxRate));
      }),
    ]).catch((reason) => {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setError(reason instanceof Error ? reason.message : "Não foi possível carregar os dados.");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  async function saveCost(product: Product, cost: number) {
    const previous = product.cost;
    setProducts((current) => current.map((item) => item.costId === product.costId ? { ...item, cost } : item));
    setSaveState((current) => ({ ...current, [product.costId]: "saving" }));
    try {
      const response = await fetch("/api/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: product.costId, sku: product.sku || product.id, title: product.title, imageUrl: product.thumbnail, cost }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar o custo.");
      setSaveState((current) => ({ ...current, [product.costId]: "saved" }));
    } catch {
      setProducts((current) => current.map((item) => item.costId === product.costId ? { ...item, cost: previous } : item));
      setDraftCosts((current) => ({ ...current, [product.costId]: previous == null ? "" : String(previous) }));
      setSaveState((current) => ({ ...current, [product.costId]: "error" }));
    }
  }

  async function saveTaxRate(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(taxRate.replace(",", "."));
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      setTaxState("error");
      return;
    }
    setTaxState("saving");
    try {
      const response = await fetch("/api/integrations/mercado-livre/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxRate: value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar a alíquota.");
      setTaxRate(String(data.taxRate));
      setTaxState("saved");
    } catch {
      setTaxState("error");
    }
  }

  const visibleProducts = products.filter((product) =>
    `${product.title} ${product.sku || ""} ${product.id}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"))
  );
  const withCost = products.filter((product) => product.cost != null && product.cost > 0).length;

  return <div className="products-page meli-products-page space-y-8">
    <PageHeader
      eyebrow="Produtos Mercado Livre"
      title="Produtos"
      subtitle="Cadastre o custo de compra de cada produto e a alíquota média da sua empresa para calcular o lucro do canal."
      icon={pageIcons.box}
    />

    <form className="meli-tax-card" onSubmit={saveTaxRate}>
      <div>
        <p className="section-kicker">Imposto sobre vendas</p>
        <h2>Alíquota da sua empresa</h2>
        <p>O percentual será aplicado ao faturamento dos pedidos pagos no período.</p>
      </div>
      <label>
        <span>Alíquota média</span>
        <span className="meli-tax-input"><input type="number" min="0" max="100" step="0.01" value={taxRate} onChange={(event) => { setTaxRate(event.target.value); setTaxState("idle"); }} aria-label="Alíquota média de imposto" /><b>%</b></span>
      </label>
      <button type="submit" disabled={taxState === "saving"}>{taxState === "saving" ? "Salvando…" : "Salvar alíquota"}</button>
      <small aria-live="polite" className={taxState === "error" ? "is-error" : ""}>{taxState === "saved" ? "Alíquota salva" : taxState === "error" ? "Informe um percentual entre 0 e 100" : ""}</small>
    </form>

    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

    {!loading && products.length > 0 && <div className="filter-toolbar flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-500">{withCost} de {products.length} produtos com custo cadastrado</p>
      <label className="w-full sm:w-80"><span className="sr-only">Buscar produto</span><input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar produto, SKU ou código" /></label>
    </div>}

    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
      <table className="w-full min-w-[720px] text-sm">
        <caption className="sr-only">Produtos do Mercado Livre e seus custos</caption>
        <thead><tr><th>Produto</th><th className="text-right">Estoque</th><th className="text-right">Vendidos</th><th className="text-right">Preço</th><th className="text-right">Custo unitário</th></tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={5}><TableLoading label="Carregando produtos do Mercado Livre" /></td></tr>
          : products.length === 0 ? <tr><td colSpan={5}><EmptyState title="Nenhum produto publicado" description="Quando houver anúncios ativos, eles aparecerão aqui para o cadastro de custos." /></td></tr>
          : visibleProducts.length === 0 ? <tr><td colSpan={5}><EmptyState kind="search" title="Nenhum produto encontrado" description="Tente buscar por outro nome, SKU ou código." /></td></tr>
          : visibleProducts.map((product) => <tr key={product.id}>
            <td><div className="flex items-center gap-3">{product.thumbnail && <>
              {/* Imagem externa já reduzida pelo catálogo do canal. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={product.thumbnail} alt="" className="h-11 w-11 shrink-0 rounded-lg object-contain" />
            </>}<div className="min-w-0"><strong className="block max-w-[360px] truncate">{product.title}</strong><small className="block text-slate-400">{product.sku ? `SKU ${product.sku} · ` : ""}{product.id}</small></div></div></td>
            <td className="text-right tabular-nums">{product.availableQuantity}</td>
            <td className="text-right tabular-nums">{product.soldQuantity}</td>
            <td className="text-right tabular-nums">{money(product.price, product.currency)}</td>
            <td><div className="flex flex-col items-end gap-1"><input type="number" min="0" step="0.01" value={draftCosts[product.costId] ?? ""} onChange={(event) => setDraftCosts((current) => ({ ...current, [product.costId]: event.target.value }))} onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0 && value !== (product.cost ?? 0)) void saveCost(product, value); }} placeholder="0,00" aria-label={`Custo de ${product.title}`} className={`product-cost-input ${product.cost ? "has-cost" : "is-missing"}`} /><small aria-live="polite">{saveState[product.costId] === "saving" ? "Salvando…" : saveState[product.costId] === "saved" ? "Salvo" : saveState[product.costId] === "error" ? "Falha ao salvar" : ""}</small></div></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <p className="text-xs leading-relaxed text-slate-400">O lucro estimado considera pedidos pagos, comissão de venda, custo dos produtos cadastrados e a alíquota acima. Frete subsidiado, publicidade e ajustes posteriores ainda não entram no resultado.</p>
  </div>;
}
