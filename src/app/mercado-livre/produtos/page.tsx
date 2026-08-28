"use client";

import { useEffect, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader, pageIcons } from "../../components/PageHeader";
import { TableLoading } from "../../components/LoadingState";
import { Pagination } from "../../components/Pagination";
import { useAnchoredField } from "../../components/useAnchoredField";
import { AvisoDeOcultos, FiltroDeAtividade } from "../../components/FiltroDeAtividade";
import type { FiltroDeAtividade as FiltroDeAtividadeValor } from "@/lib/integrations/filtroDeAtividade";

const PAGE_SIZE = 30;
export const MERCADO_LIVRE_TAX_RATE_ANCHOR = "mercado-livre-aliquota";

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
  const [taxError, setTaxError] = useState<string | null>(null);
  const [costFilter, setCostFilter] = useState<"all" | "missing" | "complete">("all");
  // Padrão "ativos": medido em 28/08/2026 nesta conta, 365 pausados para 26
  // ativos. Ver `filtroDeAtividade.ts` — o inativo continua a um clique.
  const [atividade, setAtividade] = useState<FiltroDeAtividadeValor>("ativos");
  const [ocultados, setOcultados] = useState(0);
  const [page, setPage] = useState(1);
  const taxInputRef = useAnchoredField(MERCADO_LIVRE_TAX_RATE_ANCHOR);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch(`/api/integrations/mercado-livre/products?atividade=${atividade}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível carregar os produtos.");
        setProducts(data.products);
        setOcultados(Number(data.ocultados ?? 0));
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
    // `atividade` entra nas dependências: trocar o recorte busca de novo no
    // servidor. Filtrar no cliente contaria errado o "N no recorte".
  }, [atividade]);

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

  // Ponto único de confirmação do custo: usado pelo Enter, pelo botão "Cadastrar" e
  // pelo blur. Ignora valor vazio/inválido e evita salvar quando nada mudou.
  function commitCost(product: Product, raw: string) {
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value) || value < 0) return;
    if (value === (product.cost ?? 0)) return;
    void saveCost(product, value);
  }

  // Só habilita o botão quando há um valor novo e válido para gravar.
  function canCommit(product: Product): boolean {
    const raw = draftCosts[product.costId] ?? "";
    const value = Number(raw);
    return raw.trim() !== "" && Number.isFinite(value) && value >= 0 && value !== (product.cost ?? 0);
  }

  async function saveTaxRate(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(taxRate.replace(",", "."));
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      setTaxError("Informe um percentual entre 0 e 100.");
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
      if (!response.ok) throw new Error(data.error || `Não foi possível salvar a alíquota (HTTP ${response.status}).`);
      setTaxRate(String(data.taxRate));
      setTaxError(null);
      setTaxState("saved");
    } catch (reason) {
      // ⚠️ O ERRO REAL, NÃO UM PALPITE.
      //
      // Antes qualquer falha — sessão expirada, 404, 500, rede caída — exibia
      // "Informe um percentual entre 0 e 100", culpando o número que a pessoa
      // digitou. Em 25/08/2026 isso escondeu por horas uma alíquota que nunca
      // era salva: quem tentava lia que o valor estava errado, e estava certo.
      setTaxError(reason instanceof Error ? reason.message : "Não foi possível salvar a alíquota.");
      setTaxState("error");
    }
  }

  const visibleProducts = products.filter((product) => {
    const matchesQuery = `${product.title} ${product.sku || ""} ${product.id}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"));
    const hasCost = product.cost != null && product.cost > 0;
    return matchesQuery && (costFilter === "all" || (costFilter === "complete" ? hasCost : !hasCost));
  });
  const withCost = products.filter((product) => product.cost != null && product.cost > 0).length;
  const pageCount = Math.max(1, Math.ceil(visibleProducts.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const paged = visibleProducts.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return <div className="products-page meli-products-page listing-page">
    <PageHeader
      eyebrow="Produtos Mercado Livre"
      title="Produtos"
      subtitle="Cadastre o custo de compra de cada produto e a alíquota média da sua empresa para calcular o lucro do canal."
      icon={pageIcons.box}
    />

    <form id={MERCADO_LIVRE_TAX_RATE_ANCHOR} className="meli-tax-card product-tax-panel" onSubmit={saveTaxRate}>
      <div>
        <p className="section-kicker">Imposto sobre vendas</p>
        <h2>Alíquota da sua empresa</h2>
        <p>O percentual será aplicado ao faturamento dos pedidos pagos no período.</p>
      </div>
      <label>
        <span>Alíquota média</span>
        <span className="meli-tax-input"><input ref={taxInputRef} type="number" min="0" max="100" step="0.01" value={taxRate} onChange={(event) => { setTaxRate(event.target.value); setTaxState("idle"); }} aria-label="Alíquota média de imposto" /><b>%</b></span>
      </label>
      <button type="submit" disabled={taxState === "saving"}>{taxState === "saving" ? "Salvando…" : "Salvar alíquota"}</button>
      <small aria-live="polite" className={taxState === "error" ? "is-error" : ""}>{taxState === "saved" ? "Alíquota salva" : taxState === "error" ? (taxError ?? "Não foi possível salvar a alíquota.") : ""}</small>
    </form>

    {error && <div role="alert" className="listing-error"><div><strong>Não foi possível carregar os produtos.</strong><p>{error}</p></div></div>}

    {!loading && products.length > 0 && <section className="listing-summary-band" aria-label="Cobertura de custos">
      <div><span>Produtos</span><strong>{products.length.toLocaleString("pt-BR")}</strong><small>publicados no canal</small></div>
      <div className="is-positive"><span>Com custo</span><strong>{withCost.toLocaleString("pt-BR")}</strong><small>{Math.round((withCost / products.length) * 100)}% da base</small></div>
      <div className={products.length - withCost > 0 ? "is-warning" : "is-positive"}><span>Sem custo</span><strong>{(products.length - withCost).toLocaleString("pt-BR")}</strong><small>pendentes para lucro real</small></div>
    </section>}

    {!loading && products.length > 0 && <section className="listing-controls cols-3" aria-label="Filtros dos produtos">
      <label className="listing-search"><span className="sr-only">Buscar produto</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Buscar produto, SKU ou código" /></label>
      <select value={costFilter} onChange={(event) => { setCostFilter(event.target.value as typeof costFilter); setPage(1); }} aria-label="Filtrar cobertura de custo"><option value="all">Todos os custos</option><option value="missing">Sem custo</option><option value="complete">Com custo</option></select>
      <FiltroDeAtividade atual={atividade} onChange={(valor) => { setAtividade(valor); setPage(1); }} />
      <span className="listing-filter-context">{visibleProducts.length} no recorte</span>
    </section>}
    {!loading && <AvisoDeOcultos ocultados={ocultados} atividade={atividade} verTodos={() => { setAtividade("todos"); setPage(1); }} />}

    <section className="listing-table-shell product-table-shell" aria-labelledby="ml-product-results">
      <header><div><p className="section-kicker">Base de custos</p><h2 id="ml-product-results">{loading ? "Carregando produtos" : `${visibleProducts.length} ${visibleProducts.length === 1 ? "produto encontrado" : "produtos encontrados"}`}</h2></div><p>{withCost} de {products.length} com custo cadastrado</p></header>
      <div className="overflow-x-auto">
      <table className="listing-table product-table">
        <caption className="sr-only">Produtos do Mercado Livre e seus custos</caption>
        <thead><tr><th>Produto</th><th className="text-right">Estoque</th><th className="text-right">Vendidos</th><th className="text-right">Preço</th><th className="text-right">Custo unitário</th></tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={5}><TableLoading label="Carregando produtos do Mercado Livre" /></td></tr>
          : products.length === 0 ? <tr><td colSpan={5}><EmptyState title="Nenhum produto publicado" description="Quando houver anúncios ativos, eles aparecerão aqui para o cadastro de custos." /></td></tr>
          : visibleProducts.length === 0 ? <tr><td colSpan={5}><EmptyState kind="search" title="Nenhum produto encontrado" description="Tente buscar por outro nome, SKU ou código." /></td></tr>
          : paged.map((product) => <tr key={product.id}>
            <td><div className="listing-product">{product.thumbnail ? <>
              {/* Imagem externa já reduzida pelo catálogo do canal. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={product.thumbnail} alt="" loading="lazy" />
            </> : <span className="listing-image-fallback" aria-hidden="true">ML</span>}<div><strong title={product.title}>{product.title}</strong><small>{product.sku ? `SKU ${product.sku} · ` : ""}{product.id}</small></div></div></td>
            <td className="tabular-nums">{product.availableQuantity}</td>
            <td className="tabular-nums">{product.soldQuantity}</td>
            <td className="tabular-nums">{money(product.price, product.currency)}</td>
            <td><div className="product-cost-editor"><label><span>R$</span><input type="number" min="0" step="0.01" value={draftCosts[product.costId] ?? ""} onChange={(event) => setDraftCosts((current) => ({ ...current, [product.costId]: event.target.value }))} onKeyDown={(event) => { if (event.key !== "Enter") return; event.preventDefault(); commitCost(product, event.currentTarget.value); event.currentTarget.blur(); }} onBlur={(event) => commitCost(product, event.target.value)} placeholder="0,00" aria-label={`Custo de ${product.title}`} className={`product-cost-input ${product.cost ? "has-cost" : "is-missing"}`} /></label><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => commitCost(product, draftCosts[product.costId] ?? "")} disabled={!canCommit(product)} title={canCommit(product) ? "Salvar custo" : "Digite um custo diferente do atual"}>Salvar</button><small aria-live="polite" className={saveState[product.costId] === "error" ? "is-error" : ""}>{saveState[product.costId] === "saving" ? "Salvando…" : saveState[product.costId] === "saved" ? "Salvo" : saveState[product.costId] === "error" ? "Falha ao salvar" : product.cost ? "" : "Pendente"}</small></div></td>
          </tr>)}
        </tbody>
      </table>
      </div>
      {!loading && pageCount > 1 && <div className="listing-pagination"><Pagination page={current} pageCount={pageCount} total={visibleProducts.length} pageSize={PAGE_SIZE} onPage={setPage} /></div>}
    </section>
    <p className="listing-method-note">O lucro estimado considera pedidos pagos, comissão de venda, custos cadastrados e a alíquota acima. Frete subsidiado, publicidade e ajustes posteriores ainda não entram no resultado.</p>
  </div>;
}
