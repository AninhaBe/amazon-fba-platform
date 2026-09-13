"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { PageHeader, pageIcons } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { PanelLoading } from "../../../components/LoadingState";
import { Pagination } from "../../../components/Pagination";
import { SeletorNexo } from "../../../components/SeletorNexo";
import { SortButton, type SortDir } from "../../../components/SortButton";
import { AccountSwitcher } from "../../../components/AccountSwitcher";
import { readJson } from "@/lib/readJson";

type Mode = "existing" | "new";
type Relationship = "standalone" | "parent" | "child";

interface ProductPreview {
  item: { asin: string; title?: string; brand?: string; imageUrl?: string };
  productType: string;
  restrictions: Array<{ reasons?: Array<{ message?: string }> }>;
}

interface CategoryDefinition {
  productType: string;
  version?: string;
  required: Array<{ name: string; title: string; description: string }>;
  variationThemes: Array<{ value: string; label: string }>;
}

interface ProductTypeOption { name: string; displayName: string }

interface SubmissionResult {
  sku: string;
  status: string;
  submissionId?: string;
  preview: boolean;
  canPublish: boolean;
  issues: Array<{ code: string; message: string; severity: "ERROR" | "WARNING" | "INFO"; attributeNames: string[] }>;
}

interface CatalogProduct {
  id: string;
  sku?: string;
  asin?: string;
  title?: string;
  imageUrl?: string;
  salePrice: number | null;
  fulfillable?: number | null;
  status?: string;
  fulfillment?: "fba" | "fbm";
  openDate?: string;
  cost: number | null;
  source: "listing" | "fba" | "manual";
}

type CatalogSort = "price" | "stock" | "cost";

interface ExistingDraft {
  kind: "existing";
  asin: string;
  productType: string;
  sku: string;
  price: string;
  condition: string;
  fulfillment: "AMAZON_NA" | "DEFAULT";
  quantity: string;
}

interface NewDraft {
  kind: "new";
  productType: string;
  sku: string;
  title: string;
  brand: string;
  manufacturer: string;
  description: string;
  bulletPoints: string[];
  countryOfOrigin: string;
  imageUrl: string;
  externalId: string;
  externalIdType: "ean" | "upc" | "gtin";
  identifierExemption: boolean;
  price: string;
  condition: string;
  fulfillment: "AMAZON_NA" | "DEFAULT";
  quantity: string;
  relationship: Relationship;
  parentSku: string;
  variationTheme: string;
  variationValue: string;
}

const existingInitial: ExistingDraft = {
  kind: "existing", asin: "", productType: "", sku: "", price: "", condition: "new_new", fulfillment: "AMAZON_NA", quantity: "0",
};

const newInitial: NewDraft = {
  kind: "new", productType: "", sku: "", title: "", brand: "", manufacturer: "", description: "",
  bulletPoints: ["", "", "", "", ""], countryOfOrigin: "BR", imageUrl: "", externalId: "", externalIdType: "ean",
  identifierExemption: false, price: "", condition: "new_new", fulfillment: "AMAZON_NA", quantity: "0",
  relationship: "standalone", parentSku: "", variationTheme: "", variationValue: "",
};

const knownAttributes = new Set([
  "item_name", "brand", "manufacturer", "product_description", "bullet_point", "country_of_origin",
  "supplier_declared_dg_hz_regulation", "condition_type", "main_product_image_locator",
  "externally_assigned_product_identifier", "supplier_declared_has_product_identifier_exemption",
  "purchasable_offer", "fulfillment_availability", "parentage_level", "child_parent_sku_relationship",
  "variation_theme", "number_of_items",
]);

const modeCopy = {
  existing: {
    title: "Vender um produto que já existe",
    description: "Use o ASIN do catálogo. Você define sua oferta, estoque e logística sem recriar o conteúdo.",
  },
  new: {
    title: "Criar um produto novo",
    description: "Monte a página do produto, informe o identificador e organize produtos avulsos ou variações.",
  },
};

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function Icon({ name }: { name: "catalog" | "spark" | "check" | "warning" | "arrow" }) {
  const paths = {
    catalog: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 1 4 16.5v-11Z"/><path d="M4 16.5A2.5 2.5 0 0 1 6.5 14H20M8 7h8M8 10h5"/></>,
    spark: <><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z"/><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    warning: <><path d="M12 4 3.5 19h17L12 4Z"/><path d="M12 9v4m0 3h.01"/></>,
    arrow: <path d="m9 5 7 7-7 7"/>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function AmazonListingsPage() {
  return <Suspense fallback={<PanelLoading label="Carregando anúncios" />}><AmazonListingsContent /></Suspense>;
}

function AmazonListingsContent() {
  const params = useSearchParams();
  const [section, setSection] = useState<"catalog" | "create">(params.get("secao") === "criar" ? "create" : "catalog");
  return (
    <div className="v3 meli-listings-page amazon-listings-page">
      <PageHeader eyebrow="Operação Amazon" title="Anúncios" subtitle="Catálogo, custos por SKU e criação de ofertas da sua conta Amazon." icon={pageIcons.search} action={<AccountSwitcher appearance="chip" />} />
      <nav className="v3-abas" aria-label="Visões dos anúncios Amazon">
        {([["catalog", "Catálogo e custos"], ["create", "Criar anúncio"]] as const).map(([id, label]) => <button key={id} type="button" className={`v3-aba${section === id ? " is-ativa" : ""}`} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}>{label}</button>)}
      </nav>
      {section === "catalog" ? <AmazonCatalog initialQuery={params.get("q") ?? ""} initialCostFilter={params.get("custo") === "missing" ? "missing" : "all"} /> : <AmazonListingBuilder />}
    </div>
  );
}

function AmazonListingBuilder() {
  const [mode, setMode] = useState<Mode>("existing");
  const [step, setStep] = useState(0);
  const [existing, setExisting] = useState(existingInitial);
  const [fresh, setFresh] = useState(newInitial);
  const [product, setProduct] = useState<ProductPreview | null>(null);
  const [definition, setDefinition] = useState<CategoryDefinition | null>(null);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<ProductTypeOption[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [validatedSignature, setValidatedSignature] = useState<string | null>(null);

  const steps = mode === "existing"
    ? ["Encontrar produto", "Configurar oferta", "Revisar e publicar"]
    : ["Categoria", "Conteúdo", "Oferta e variações", "Revisar e publicar"];

  const listing = useMemo(() => mode === "existing" ? {
    ...existing,
    asin: existing.asin.trim().toUpperCase(),
    sku: existing.sku.trim(),
    price: Number(existing.price.replace(",", ".")),
    quantity: Number(existing.quantity),
  } : {
    ...fresh,
    productType: fresh.productType.trim().toUpperCase(),
    sku: fresh.sku.trim(),
    title: fresh.title.trim(),
    brand: fresh.brand.trim(),
    manufacturer: fresh.manufacturer.trim(),
    description: fresh.description.trim(),
    bulletPoints: fresh.bulletPoints.map((value) => value.trim()).filter(Boolean),
    imageUrl: fresh.imageUrl.trim(),
    externalId: fresh.externalId.trim(),
    parentSku: fresh.parentSku.trim(),
    price: Number(fresh.price.replace(",", ".")) || undefined,
    quantity: Number(fresh.quantity),
    variationValue: Number(fresh.variationValue) || undefined,
  }, [existing, fresh, mode]);
  const signature = JSON.stringify(listing);
  const validated = result?.preview && result.canPublish && validatedSignature === signature;

  function changeMode(next: Mode) {
    setMode(next);
    setStep(0);
    setError(null);
    setResult(null);
    setValidatedSignature(null);
  }

  async function requestJson(url: string, init?: RequestInit) {
    const response = await fetch(url, { cache: "no-store", ...init });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Não foi possível concluir esta etapa.");
    return body;
  }

  async function findAsin() {
    if (!/^[A-Z0-9]{10}$/.test(existing.asin.trim().toUpperCase())) {
      setError("Informe um ASIN válido, como B0H9R1888D.");
      return;
    }
    setBusy("asin"); setError(null); setResult(null);
    try {
      const data = await requestJson(`/api/amazon/listings?asin=${encodeURIComponent(existing.asin)}`) as ProductPreview;
      setProduct(data);
      setExisting((current) => ({ ...current, asin: data.item.asin, productType: data.productType }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Produto não encontrado."); }
    finally { setBusy(null); }
  }

  async function searchCategories() {
    if (!categoryQuery.trim()) { setError("Descreva o produto que você vai anunciar."); return; }
    setBusy("category-search"); setError(null);
    try {
      const data = await requestJson(`/api/amazon/listings?keywords=${encodeURIComponent(categoryQuery)}`) as { productTypes: ProductTypeOption[] };
      setCategoryOptions(data.productTypes);
      if (!data.productTypes.length) setError("Nenhuma categoria encontrada. Tente uma descrição mais geral.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Categorias não encontradas."); }
    finally { setBusy(null); }
  }

  async function loadCategory(selected?: string) {
    const productType = selected || fresh.productType;
    if (!productType.trim()) { setError("Escolha uma categoria para continuar."); return; }
    setBusy("category"); setError(null); setResult(null);
    try {
      const data = await requestJson(`/api/amazon/listings?productType=${encodeURIComponent(productType)}`) as CategoryDefinition;
      setDefinition(data);
      setFresh((current) => ({ ...current, productType: data.productType, variationTheme: current.variationTheme || data.variationThemes[0]?.value || "" }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Categoria não encontrada."); }
    finally { setBusy(null); }
  }

  function basicError() {
    if (mode === "existing") {
      if (!product) return "Consulte e confirme o produto antes de continuar.";
      if (!existing.sku.trim()) return "Informe um SKU interno.";
      if (!(Number(existing.price.replace(",", ".")) > 0)) return "Informe um preço válido.";
      return null;
    }
    if (!definition) return "Carregue os requisitos da categoria.";
    if (!fresh.sku.trim() || !fresh.title.trim() || !fresh.brand.trim() || !fresh.description.trim()) return "Preencha SKU, título, marca e descrição.";
    if (!fresh.imageUrl.trim()) return "Informe a URL da imagem principal.";
    if (!fresh.identifierExemption && !fresh.externalId.trim()) return "Informe o EAN/UPC/GTIN ou marque a isenção de identificador.";
    if (fresh.relationship !== "parent" && !(Number(fresh.price.replace(",", ".")) > 0)) return "Informe um preço válido.";
    if (fresh.relationship === "child" && !fresh.parentSku.trim()) return "Informe o SKU pai desta variação.";
    return null;
  }

  function next() {
    setError(null);
    if (mode === "existing" && step === 0 && !product) return setError("Consulte e confirme o produto para avançar.");
    if (mode === "new" && step === 0 && !definition) return setError("Carregue a categoria para avançar.");
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  async function submit(action: "validate" | "publish") {
    const message = basicError();
    if (message) { setError(message); return; }
    if (action === "publish" && !validated) { setError("Valide novamente: os dados mudaram desde a última validação."); return; }
    setBusy(action); setError(null);
    try {
      const data = await requestJson("/api/amazon/listings", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, listing }),
      }) as SubmissionResult;
      setResult(data);
      if (action === "validate") setValidatedSignature(signature);
      if (action === "publish") setValidatedSignature(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível enviar o anúncio."); }
    finally { setBusy(null); }
  }

  return (
    <div className="listing-builder-page analysis-page">
      <section className="listing-mode-grid listing-mode-switch" aria-label="Tipo de anúncio">
        {(["existing", "new"] as Mode[]).map((option) => (
          <button key={option} type="button" className={`listing-mode-card${mode === option ? " is-selected" : ""}`} onClick={() => changeMode(option)} aria-pressed={mode === option}>
            <span className="listing-mode-icon"><Icon name={option === "existing" ? "catalog" : "spark"} /></span>
            <span><strong>{modeCopy[option].title}</strong><small>{modeCopy[option].description}</small></span>
            <span className="listing-mode-check"><Icon name="check" /></span>
          </button>
        ))}
      </section>

      <div className="listing-builder-layout">
        <main className="listing-builder-main">
          <ol className="listing-stepper" aria-label="Etapas do anúncio">
            {steps.map((label, index) => <li key={label} className={`${index === step ? "is-current" : ""}${index < step ? " is-done" : ""}`}><button type="button" onClick={() => index <= step && setStep(index)} disabled={index > step}><span>{index < step ? "✓" : index + 1}</span><small>{label}</small></button></li>)}
          </ol>

          <section className="listing-form-panel">
            {mode === "existing" ? <ExistingFlow step={step} draft={existing} setDraft={setExisting} product={product} findAsin={findAsin} busy={busy} /> : <NewFlow step={step} draft={fresh} setDraft={setFresh} definition={definition} categoryQuery={categoryQuery} setCategoryQuery={setCategoryQuery} categoryOptions={categoryOptions} searchCategories={searchCategories} loadCategory={loadCategory} busy={busy} />}

            {error && <div className="listing-alert is-error" role="alert"><Icon name="warning" /><p>{error}</p></div>}
            {step === steps.length - 1 && <ReviewResult result={result} />}

            <footer className="listing-form-actions">
              <button type="button" className="listing-secondary" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || Boolean(busy)}>Voltar</button>
              {step < steps.length - 1 ? <button type="button" className="listing-primary" onClick={next}>Continuar <Icon name="arrow" /></button> : <div className="listing-submit-actions"><button type="button" className="listing-secondary" onClick={() => void submit("validate")} disabled={Boolean(busy)}>{busy === "validate" ? "Validando…" : "Validar com a Amazon"}</button><button type="button" className="listing-primary" onClick={() => void submit("publish")} disabled={!validated || Boolean(busy)}>{busy === "publish" ? "Publicando…" : "Publicar anúncio"}</button></div>}
            </footer>
          </section>
        </main>

        <aside className="listing-readiness" aria-label="Resumo do anúncio">
          <p className="section-kicker">Prontidão</p><h2>Antes de publicar</h2>
          <ReadinessItem done={mode === "existing" ? Boolean(product) : Boolean(definition)} label={mode === "existing" ? "Produto confirmado" : "Categoria confirmada"} />
          <ReadinessItem done={mode === "existing" ? Boolean(existing.sku && Number(existing.price.replace(",", ".")) > 0) : Boolean(fresh.sku && fresh.title && fresh.brand && fresh.description)} label={mode === "existing" ? "Oferta preenchida" : "Conteúdo essencial"} />
          <ReadinessItem done={mode === "existing" || Boolean(fresh.identifierExemption || fresh.externalId)} label="Identificação do produto" />
          <ReadinessItem done={Boolean(validated)} label="Validação da Amazon" />
          <div className="listing-readiness-note"><strong>Publicar não significa ficar ativo na hora.</strong><p>A Amazon ainda pode revisar o catálogo. Para FBA, o FNSKU e a elegibilidade de envio aparecem depois que o SKU é processado.</p></div>
        </aside>
      </div>
    </div>
  );
}

function AmazonCatalog({ initialQuery, initialCostFilter }: { initialQuery: string; initialCostFilter: "all" | "missing" }) {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [costFilter, setCostFilter] = useState<"all" | "missing" | "complete">(initialCostFilter);
  const [sourceFilter, setSourceFilter] = useState<"all" | CatalogProduct["source"]>("all");
  const [sortCol, setSortCol] = useState<CatalogSort>("stock");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [draftCosts, setDraftCosts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [taxRate, setTaxRate] = useState("");
  const [taxState, setTaxState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [newAsin, setNewAsin] = useState("");
  const [newCost, setNewCost] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [productsRes, settingsRes] = await Promise.all([
        fetch("/api/products", { cache: "no-store" }),
        fetch("/api/integrations/amazon/settings", { cache: "no-store" }),
      ]);
      const [productsData, settingsData] = await Promise.all([readJson(productsRes), readJson(settingsRes)]);
      if (!productsRes.ok) throw new Error(productsData.error || "Erro ao carregar anúncios.");
      setProducts(productsData.products);
      setDraftCosts(Object.fromEntries(productsData.products.map((product: CatalogProduct) => [product.id, product.cost == null ? "" : String(product.cost)])));
      if (settingsRes.ok) setTaxRate(settingsData.taxRate == null ? "" : String(settingsData.taxRate));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro desconhecido.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function saveCost(product: CatalogProduct, cost: number) {
    const previous = product.cost;
    setProducts((current) => current.map((item) => item.id === product.id ? { ...item, cost } : item));
    setSaveState((current) => ({ ...current, [product.id]: "saving" }));
    try {
      const response = await fetch("/api/costs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: product.id, sku: product.sku, asin: product.asin, title: product.title, imageUrl: product.imageUrl, cost }) });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Erro ao salvar custo.");
      setSaveState((current) => ({ ...current, [product.id]: "saved" }));
    } catch {
      setProducts((current) => current.map((item) => item.id === product.id ? { ...item, cost: previous } : item));
      setDraftCosts((current) => ({ ...current, [product.id]: previous == null ? "" : String(previous) }));
      setSaveState((current) => ({ ...current, [product.id]: "error" }));
    }
  }

  function parsedCost(product: CatalogProduct) {
    const raw = draftCosts[product.id] ?? "";
    const value = Number(raw);
    return raw.trim() !== "" && Number.isFinite(value) && value >= 0 && value !== product.cost ? value : null;
  }

  function commitCost(product: CatalogProduct, raw: string) {
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value) || value < 0 || value === product.cost) return;
    void saveCost(product, value);
  }

  async function saveTaxRate(event: React.FormEvent) {
    event.preventDefault();
    const rate = taxRate.trim() === "" ? null : Number(taxRate);
    if (rate != null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) { setTaxState("error"); return; }
    setTaxState("saving");
    try {
      const response = await fetch("/api/integrations/amazon/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taxRate: rate }) });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Erro ao salvar alíquota.");
      setTaxState("saved");
    } catch { setTaxState("error"); }
  }

  async function addByAsin(event: React.FormEvent) {
    event.preventDefault();
    const asin = newAsin.trim().toUpperCase();
    const cost = Number(newCost);
    if (!asin || newCost.trim() === "" || !Number.isFinite(cost) || cost < 0) return;
    setAdding(true); setAddError(null);
    try {
      const infoRes = await fetch(`/api/price?asin=${encodeURIComponent(asin)}`);
      const info = await readJson(infoRes);
      if (!infoRes.ok) throw new Error(info.error || "ASIN não encontrado.");
      const saveRes = await fetch("/api/costs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: asin, asin, title: info?.info?.title, imageUrl: info?.info?.imageUrl, cost }) });
      const saved = await readJson(saveRes);
      if (!saveRes.ok) throw new Error(saved.error || "Erro ao adicionar produto.");
      setNewAsin(""); setNewCost(""); setAddOpen(false); await load();
    } catch (reason) { setAddError(reason instanceof Error ? reason.message : "Não foi possível adicionar esse ASIN."); }
    finally { setAdding(false); }
  }

  async function remove(product: CatalogProduct) {
    if (!window.confirm(`Remover ${product.title || product.asin || product.id} da lista manual?`)) return;
    const response = await fetch(`/api/costs?id=${encodeURIComponent(product.id)}`, { method: "DELETE" });
    if (response.ok) setProducts((current) => current.filter((item) => item.id !== product.id));
    else setError("Não foi possível remover o produto manual.");
  }

  function sortBy(column: CatalogSort) {
    if (sortCol === column) setSortDir((current) => current === "asc" ? "desc" : "asc");
    else { setSortCol(column); setSortDir("desc"); }
    setPage(1);
  }

  const withCost = products.filter((product) => product.cost != null).length;
  const withoutCost = products.length - withCost;
  const withoutStock = products.filter((product) => product.fulfillable === 0).length;
  const visible = products.filter((product) => {
    const matchesQuery = `${product.title || ""} ${product.sku || ""} ${product.asin || ""}`.toLowerCase().includes(query.toLowerCase());
    const hasCost = product.cost != null;
    return matchesQuery && (costFilter === "all" || (costFilter === "complete" ? hasCost : !hasCost)) && (sourceFilter === "all" || product.source === sourceFilter);
  }).sort((a, b) => {
    const left = sortCol === "price" ? a.salePrice : sortCol === "stock" ? a.fulfillable : a.cost;
    const right = sortCol === "price" ? b.salePrice : sortCol === "stock" ? b.fulfillable : b.cost;
    if (left == null) return right == null ? 0 : 1;
    if (right == null) return -1;
    return sortDir === "asc" ? left - right : right - left;
  });
  const pageSize = 15;
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paged = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  if (loading) return <PanelLoading label="Carregando anúncios da Amazon" />;
  if (error && products.length === 0) return <EmptyState title="Não foi possível carregar os anúncios" description={error} />;

  return <div className="amazon-catalog-v3">
    <section className="v3-card" aria-labelledby="amazon-tax-title">
      <div className="v3-card-cab"><h2 id="amazon-tax-title">Alíquota da sua empresa</h2><span className="v3-meta">Aplicada ao faturamento dos pedidos pagos no período</span></div>
      <form className="v3-aliquota" onSubmit={saveTaxRate}><label className="v3-aliquota-campo"><span>Alíquota média</span><span className="v3-aliquota-entrada"><input type="number" min="0" max="100" step="0.01" value={taxRate} onChange={(event) => { setTaxRate(event.target.value); setTaxState("idle"); }} aria-label="Alíquota média de imposto Amazon" /><b>%</b></span></label><button type="submit" className="v3-btn is-primaria" disabled={taxState === "saving"}>{taxState === "saving" ? "Salvando…" : "Salvar alíquota"}</button><small className={`v3-nota${taxState === "error" ? " is-erro" : ""}`} aria-live="polite">{taxState === "saved" ? "Alíquota salva" : taxState === "error" ? "Informe uma alíquota entre 0% e 100%." : ""}</small></form>
    </section>

    <section className="v3-card v3-faixa">
      <div className="v3-card-cab"><h2>Anúncios</h2><button type="button" className="v3-btn" onClick={() => setAddOpen((open) => !open)}>{addOpen ? "Fechar cadastro" : "Adicionar por ASIN"}</button></div>
      <div className="v3-colunas amazon-listing-faixa">
        <div className="v3-coluna"><p className="v3-coluna-rotulo">Anúncios</p><strong className="v3-coluna-valor">{products.length.toLocaleString("pt-BR")}</strong><span className="v3-coluna-share">sincronizados e manuais</span></div>
        <div className="v3-coluna"><p className="v3-coluna-rotulo">Com estoque</p><strong className="v3-coluna-valor">{products.filter((product) => product.fulfillable != null && product.fulfillable > 0).length.toLocaleString("pt-BR")}</strong><span className="v3-coluna-share">unidades disponíveis</span></div>
        <div className="v3-coluna is-tom-vermelho"><p className="v3-coluna-rotulo">Sem estoque</p><strong className={`v3-coluna-valor${withoutStock ? " is-negativo" : ""}`}>{withoutStock.toLocaleString("pt-BR")}</strong><span className="v3-coluna-share">zero confirmado pela fonte</span></div>
        <div className="v3-coluna is-tom-verde"><p className="v3-coluna-rotulo">Com custo</p><strong className="v3-coluna-valor is-positivo">{withCost.toLocaleString("pt-BR")}</strong><span className="v3-coluna-share">{products.length ? `${Math.round(withCost / products.length * 100)}% da base` : "—"}</span></div>
        <div className="v3-coluna is-tom-ambar"><p className="v3-coluna-rotulo">Sem custo</p><strong className="v3-coluna-valor">{withoutCost.toLocaleString("pt-BR")}</strong><span className="v3-coluna-share">{withoutCost ? "sem lucro real ainda" : "base completa"}</span></div>
      </div>
      {addOpen && <form className="product-add-panel" onSubmit={addByAsin}><div><strong>Adicionar produto manual</strong><span>Informe o ASIN e um custo conhecido. Zero é aceito como valor confirmado.</span></div><input value={newAsin} onChange={(event) => setNewAsin(event.target.value)} placeholder="B0XXXXXXXX" aria-label="ASIN do produto" /><input type="number" min="0" step="0.01" value={newCost} onChange={(event) => setNewCost(event.target.value)} placeholder="Custo unitário" aria-label="Custo unitário do produto" /><button type="submit" disabled={adding || !newAsin.trim() || !newCost.trim()}>{adding ? "Adicionando…" : "Adicionar"}</button>{addError && <span role="alert" className="product-add-error">{addError}</span>}</form>}
    </section>

    <section className="v3-card" aria-labelledby="amazon-listing-results">
      <div className="v3-card-cab"><h2 id="amazon-listing-results">{visible.length.toLocaleString("pt-BR")} {visible.length === 1 ? "anúncio encontrado" : "anúncios encontrados"}</h2><span className="v3-meta">Catálogo publicado</span></div>
      <div className="v3-filtros v3-filtros-anuncios" role="search" aria-label="Filtros dos anúncios"><label className="v3-busca"><span className="sr-only">Buscar anúncio</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Buscar título, SKU ou ASIN" /></label><SeletorNexo valor={costFilter} rotuloAcessivel="Filtrar cobertura de custo" aoEscolher={(value) => { setCostFilter(value as typeof costFilter); setPage(1); }} opcoes={[{ valor: "all", rotulo: "Todos os custos" }, { valor: "missing", rotulo: "Sem custo" }, { valor: "complete", rotulo: "Com custo" }]} /><SeletorNexo valor={sourceFilter} rotuloAcessivel="Filtrar origem" aoEscolher={(value) => { setSourceFilter(value as typeof sourceFilter); setPage(1); }} opcoes={[{ valor: "all", rotulo: "Todas as origens" }, { valor: "listing", rotulo: "Anúncios" }, { valor: "fba", rotulo: "Estoque FBA" }, { valor: "manual", rotulo: "Manuais" }]} /></div>
      {visible.length === 0 ? <EmptyState kind="search" title="Nenhum anúncio encontrado" description="Ajuste a busca ou remova algum filtro." /> : <div className="v3-tabela v3-tabela-anuncios v3-tabela-anuncios-amazon">
        <div className="v3-anuncios-cab"><span>Produto</span><span>Status</span><span><SortButton label="Preço" col="price" sortCol={sortCol} sortDir={sortDir} onSort={sortBy} /></span><span><SortButton label="Estoque" col="stock" sortCol={sortCol} sortDir={sortDir} onSort={sortBy} /></span><span>Logística</span><span><SortButton label="Custo unitário" col="cost" sortCol={sortCol} sortDir={sortDir} onSort={sortBy} /></span><span><span className="sr-only">Ações</span></span></div>
        {paged.map((product) => <div className="v3-anuncios-linha" key={product.id}>
          <span className="v3-cel-anuncio">{product.imageUrl ? <img className="v3-anuncio-foto" src={product.imageUrl} alt="" loading="lazy" /> : <span className="v3-anuncio-foto is-vazia" aria-hidden="true">AMZ</span>}<span className="v3-cel-nome"><span className="v3-margem-titulo" title={product.title}>{product.title || product.id}</span><span className="v3-cel-sub">{product.sku ? `SKU ${product.sku}` : ""}{product.sku && product.asin ? " · " : ""}{product.asin ? `ASIN ${product.asin}` : ""}</span></span></span>
          <span className="v3-cel-centro"><em className={`v3-chip v3-cobertura ${product.status?.toLowerCase().includes("active") && !product.status.toLowerCase().includes("inactive") ? "is-saudavel" : product.status?.toLowerCase().includes("incomplete") ? "is-atencao" : "is-vazio"}`}>{product.source === "manual" ? "Manual" : product.status || "—"}</em></span>
          <span className={`v3-cel-num${product.salePrice == null ? " is-vazio" : ""}`}>{product.salePrice == null ? "—" : money(product.salePrice)}</span>
          <span className={`v3-cel-num${product.fulfillable == null ? " is-vazio" : product.fulfillable === 0 ? " is-negativo" : ""}`}>{product.fulfillable == null ? "—" : product.fulfillable.toLocaleString("pt-BR")}</span>
          <span className="v3-cel-num v3-cel-duplo"><span>{product.fulfillment === "fba" ? "FBA" : product.fulfillment === "fbm" ? "Envio próprio" : "—"}</span><span className="v3-cel-sub">{product.source === "fba" ? "estoque na Amazon" : product.source === "listing" ? "oferta publicada" : "produto manual"}</span></span>
          <span className="v3-cel-custo"><label className={`v3-custo-campo${product.cost != null ? "" : " is-pendente"}`}><span aria-hidden="true">R$</span><input type="number" min="0" step="0.01" value={draftCosts[product.id] ?? ""} onChange={(event) => setDraftCosts((current) => ({ ...current, [product.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitCost(product, event.currentTarget.value); event.currentTarget.blur(); } }} onBlur={(event) => commitCost(product, event.target.value)} placeholder="—" aria-label={`Custo de ${product.title || product.id}`} /></label><button type="button" className="v3-custo-salvar" disabled={parsedCost(product) == null} onMouseDown={(event) => event.preventDefault()} onClick={() => commitCost(product, draftCosts[product.id] ?? "")}>Salvar</button><small aria-live="polite" className={saveState[product.id] === "error" ? "is-erro" : ""}>{saveState[product.id] === "saving" ? "Salvando…" : saveState[product.id] === "saved" ? "Salvo" : saveState[product.id] === "error" ? "Falha" : product.cost == null ? "Pendente" : ""}</small></span>
          <span className="v3-cel-fim">{product.source === "manual" ? <button type="button" className="listing-row-danger" onClick={() => void remove(product)}>Remover</button> : <span aria-hidden="true">—</span>}</span>
        </div>)}
      </div>}
      {pageCount > 1 && <div className="v3-paginacao"><Pagination page={currentPage} pageCount={pageCount} total={visible.length} pageSize={pageSize} onPage={setPage} /></div>}
    </section>
  </div>;
}

function ExistingFlow({ step, draft, setDraft, product, findAsin, busy }: { step: number; draft: ExistingDraft; setDraft: React.Dispatch<React.SetStateAction<ExistingDraft>>; product: ProductPreview | null; findAsin: () => void; busy: string | null }) {
  if (step === 0) return <><PanelHeading eyebrow="Etapa 1" title="Qual produto você quer vender?" description="Cole o ASIN. O NEXO confirma título, imagem, categoria e eventuais restrições para sua conta." /><div className="listing-lookup"><Field label="ASIN" hint="10 caracteres, começa normalmente com B"><input value={draft.asin} onChange={(event) => setDraft((current) => ({ ...current, asin: event.target.value.toUpperCase() }))} placeholder="Ex.: B0H9R1888D" maxLength={10} /></Field><button type="button" className="listing-primary" onClick={findAsin} disabled={busy === "asin"}>{busy === "asin" ? "Consultando…" : "Consultar produto"}</button></div>{product && <ProductConfirmation product={product} />}</>;
  if (step === 1) return <><PanelHeading eyebrow="Etapa 2" title="Configure sua oferta" description="O conteúdo continua sendo o do catálogo. Aqui entram os dados comerciais exclusivos da sua conta." /><div className="listing-field-grid"><Field label="SKU" hint="Código interno único; não poderá ser trocado depois"><input value={draft.sku} onChange={(event) => setDraft((current) => ({ ...current, sku: event.target.value }))} placeholder="Ex.: kitprote-24" /></Field><MoneyField value={draft.price} onChange={(price) => setDraft((current) => ({ ...current, price }))} /><Field label="Condição"><select value={draft.condition} onChange={(event) => setDraft((current) => ({ ...current, condition: event.target.value }))}><option value="new_new">Novo</option></select></Field><FulfillmentFields fulfillment={draft.fulfillment} quantity={draft.quantity} onFulfillment={(value) => setDraft((current) => ({ ...current, fulfillment: value }))} onQuantity={(quantity) => setDraft((current) => ({ ...current, quantity }))} /></div></>;
  return <><PanelHeading eyebrow="Etapa 3" title="Revise antes de enviar" description="Primeiro validamos a mesma carga que será publicada. O botão de publicação só é liberado quando não houver erros." /><ReviewRows rows={[["Produto", product?.item.title || draft.asin], ["ASIN", draft.asin], ["SKU", draft.sku || "Não informado"], ["Preço", draft.price ? `R$ ${draft.price}` : "Não informado"], ["Logística", draft.fulfillment === "AMAZON_NA" ? "FBA · Logística da Amazon" : "Envio pelo vendedor"]]} /></>;
}

function NewFlow({ step, draft, setDraft, definition, categoryQuery, setCategoryQuery, categoryOptions, searchCategories, loadCategory, busy }: { step: number; draft: NewDraft; setDraft: React.Dispatch<React.SetStateAction<NewDraft>>; definition: CategoryDefinition | null; categoryQuery: string; setCategoryQuery: (value: string) => void; categoryOptions: ProductTypeOption[]; searchCategories: () => void; loadCategory: (selected?: string) => void; busy: string | null }) {
  if (step === 0) return <><PanelHeading eyebrow="Etapa 1" title="Em qual categoria o produto entra?" description="Descreva o que você vende. O NEXO encontra os tipos aceitos e carrega os requisitos atuais da Amazon." /><div className="listing-lookup"><Field label="Buscar categoria" hint="Use poucas palavras, como “protetor para pé de cadeira”"><input value={categoryQuery} onChange={(event) => setCategoryQuery(event.target.value)} placeholder="O que é o produto?" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); searchCategories(); } }} /></Field><button type="button" className="listing-primary" onClick={searchCategories} disabled={busy === "category-search"}>{busy === "category-search" ? "Buscando…" : "Buscar categorias"}</button></div>{categoryOptions.length > 0 && <div className="category-options" role="list"><p className="section-kicker">Escolha a melhor opção</p>{categoryOptions.map((option) => <button type="button" key={option.name} className={draft.productType === option.name ? "is-selected" : ""} onClick={() => void loadCategory(option.name)} disabled={busy === "category"}><span><strong>{option.displayName}</strong><small>{option.name}</small></span><Icon name="arrow" /></button>)}</div>}{definition && <div className="category-confirmation"><span><Icon name="check" /></span><div><strong>{definition.productType}</strong><p>{definition.required.length} campos obrigatórios encontrados na definição atual da Amazon.</p></div></div>}{definition && <div className="required-attributes"><p className="section-kicker">Cobertura do formulário</p><div>{definition.required.map((field) => <span key={field.name} className={knownAttributes.has(field.name) ? "is-covered" : "is-extra"}>{knownAttributes.has(field.name) ? "✓" : "+"} {field.title}</span>)}</div><small>Os itens marcados com “+” são específicos desta categoria; a validação da Amazon indicará o formato exato antes da publicação.</small></div>}</>;
  if (step === 1) return <><PanelHeading eyebrow="Etapa 2" title="Construa a página do produto" description="Título claro, imagem limpa e benefícios objetivos aumentam a compreensão do anúncio." /><div className="listing-content-layout"><div className="listing-field-grid"><Field label="SKU"><input value={draft.sku} onChange={(event) => setDraft((current) => ({ ...current, sku: event.target.value }))} /></Field><Field label="Marca"><input value={draft.brand} onChange={(event) => setDraft((current) => ({ ...current, brand: event.target.value }))} /></Field><Field label="Título" wide><input value={draft.title} maxLength={200} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /><Counter value={draft.title.length} max={200} /></Field><Field label="Fabricante"><input value={draft.manufacturer} onChange={(event) => setDraft((current) => ({ ...current, manufacturer: event.target.value }))} /></Field><Field label="País de origem"><select value={draft.countryOfOrigin} onChange={(event) => setDraft((current) => ({ ...current, countryOfOrigin: event.target.value }))}><option value="BR">Brasil</option><option value="CN">China</option><option value="US">Estados Unidos</option></select></Field><Field label="Descrição" wide><textarea rows={5} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></Field><Field label="Imagem principal (URL)" hint="Fundo branco, sem textos promocionais" wide><input type="url" value={draft.imageUrl} onChange={(event) => setDraft((current) => ({ ...current, imageUrl: event.target.value }))} placeholder="https://…" /></Field></div><ImagePreview url={draft.imageUrl} title={draft.title} /></div><div className="bullet-editor"><div><p className="section-kicker">Pontos de destaque</p><small>Um benefício por linha; evite repetir o título.</small></div>{draft.bulletPoints.map((point, index) => <Field key={index} label={`Destaque ${index + 1}`}><input value={point} maxLength={500} onChange={(event) => setDraft((current) => ({ ...current, bulletPoints: current.bulletPoints.map((value, itemIndex) => itemIndex === index ? event.target.value : value) }))} /></Field>)}</div></>;
  if (step === 2) return <><PanelHeading eyebrow="Etapa 3" title="Identificação, oferta e variações" description="Separe a identidade do produto da oferta. Um pai de variação não recebe preço nem estoque." /><div className="listing-choice-row"><Choice active={draft.relationship === "standalone"} title="Produto avulso" description="Sem variações" onClick={() => setDraft((current) => ({ ...current, relationship: "standalone" }))} /><Choice active={draft.relationship === "parent"} title="Pai de variações" description="Agrupa os filhos" onClick={() => setDraft((current) => ({ ...current, relationship: "parent" }))} /><Choice active={draft.relationship === "child"} title="Filho" description="Variação vendável" onClick={() => setDraft((current) => ({ ...current, relationship: "child" }))} /></div><div className="listing-subsection"><h3>Identificador</h3><label className="listing-check"><input type="checkbox" checked={draft.identifierExemption} onChange={(event) => setDraft((current) => ({ ...current, identifierExemption: event.target.checked }))} /><span><strong>Tenho isenção de GTIN aprovada</strong><small>A isenção precisa existir para esta marca e categoria na Amazon.</small></span></label>{!draft.identifierExemption && <div className="listing-field-grid"><Field label="Tipo"><select value={draft.externalIdType} onChange={(event) => setDraft((current) => ({ ...current, externalIdType: event.target.value as NewDraft["externalIdType"] }))}><option value="ean">EAN</option><option value="upc">UPC</option><option value="gtin">GTIN</option></select></Field><Field label="Código"><input inputMode="numeric" value={draft.externalId} onChange={(event) => setDraft((current) => ({ ...current, externalId: event.target.value }))} /></Field></div>}</div>{draft.relationship !== "standalone" && <div className="listing-subsection"><h3>Variação</h3><div className="listing-field-grid">{draft.relationship === "child" && <Field label="SKU pai"><input value={draft.parentSku} onChange={(event) => setDraft((current) => ({ ...current, parentSku: event.target.value }))} /></Field>}<Field label="Tema"><select value={draft.variationTheme} onChange={(event) => setDraft((current) => ({ ...current, variationTheme: event.target.value }))}><option value="">Selecione</option>{definition?.variationThemes.map((theme) => <option key={theme.value} value={theme.value}>{theme.label}</option>)}</select></Field>{draft.relationship === "child" && <Field label="Quantidade do kit"><input type="number" min="1" value={draft.variationValue} onChange={(event) => setDraft((current) => ({ ...current, variationValue: event.target.value }))} /></Field>}</div></div>}{draft.relationship !== "parent" && <div className="listing-subsection"><h3>Oferta</h3><div className="listing-field-grid"><MoneyField value={draft.price} onChange={(price) => setDraft((current) => ({ ...current, price }))} /><Field label="Condição"><select value={draft.condition} onChange={(event) => setDraft((current) => ({ ...current, condition: event.target.value }))}><option value="new_new">Novo</option></select></Field><FulfillmentFields fulfillment={draft.fulfillment} quantity={draft.quantity} onFulfillment={(value) => setDraft((current) => ({ ...current, fulfillment: value }))} onQuantity={(quantity) => setDraft((current) => ({ ...current, quantity }))} /></div></div>}</>;
  return <><PanelHeading eyebrow="Etapa 4" title="Revise antes de enviar" description="A pré-validação não altera o catálogo. Ela mostra campos ausentes e regras da categoria com a resposta da Amazon." /><ReviewRows rows={[["Tipo", draft.productType], ["Produto", draft.title || "Não informado"], ["SKU", draft.sku || "Não informado"], ["Estrutura", draft.relationship === "parent" ? "Pai de variações" : draft.relationship === "child" ? `Filho de ${draft.parentSku || "—"}` : "Produto avulso"], ["Oferta", draft.relationship === "parent" ? "Sem preço e estoque" : `${draft.price ? `R$ ${draft.price}` : "Sem preço"} · ${draft.fulfillment === "AMAZON_NA" ? "FBA" : "Envio próprio"}`]]} /></>;
}

function PanelHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <header className="listing-panel-heading"><p className="section-kicker">{eyebrow}</p><h2>{title}</h2><p>{description}</p></header>; }
function Field({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: React.ReactNode }) { return <label className={`listing-field${wide ? " is-wide" : ""}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
function Counter({ value, max }: { value: number; max: number }) { return <small className="listing-counter">{value}/{max}</small>; }
function MoneyField({ value, onChange }: { value: string; onChange: (value: string) => void }) { return <Field label="Preço"><span className="listing-affixed-input"><b>R$</b><input inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} placeholder="0,00" /></span></Field>; }
function FulfillmentFields({ fulfillment, quantity, onFulfillment, onQuantity }: { fulfillment: "AMAZON_NA" | "DEFAULT"; quantity: string; onFulfillment: (value: "AMAZON_NA" | "DEFAULT") => void; onQuantity: (value: string) => void }) { return <><Field label="Logística"><select value={fulfillment} onChange={(event) => onFulfillment(event.target.value as "AMAZON_NA" | "DEFAULT")}><option value="AMAZON_NA">FBA · Logística da Amazon</option><option value="DEFAULT">Envio pelo vendedor</option></select></Field>{fulfillment === "DEFAULT" && <Field label="Estoque disponível"><input type="number" min="0" value={quantity} onChange={(event) => onQuantity(event.target.value)} /></Field>}</>; }
function Choice({ active, title, description, onClick }: { active: boolean; title: string; description: string; onClick: () => void }) { return <button type="button" className={`listing-choice${active ? " is-selected" : ""}`} onClick={onClick}><strong>{title}</strong><small>{description}</small></button>; }
function ProductConfirmation({ product }: { product: ProductPreview }) { const restricted = product.restrictions.length > 0; return <article className="product-confirmation">{product.item.imageUrl ? <Image src={product.item.imageUrl} alt="" width={90} height={90} unoptimized /> : <span className="product-image-fallback">ASIN</span>}<div><span className={`listing-status-chip ${restricted ? "is-warning" : "is-ok"}`}>{restricted ? "Verificar restrições" : "Disponível para oferta"}</span><h3>{product.item.title || product.item.asin}</h3><p>{product.item.brand || "Marca não informada"} · {product.item.asin}</p><small>Tipo: {product.productType}</small></div></article>; }
function ImagePreview({ url, title }: { url: string; title: string }) { return <aside className="listing-image-preview"><p>Prévia da imagem</p>{url ? <Image src={url} alt={title ? `Prévia de ${title}` : "Prévia do produto"} width={166} height={166} unoptimized /> : <div><Icon name="catalog" /><span>Cole uma URL para visualizar</span></div>}</aside>; }
function ReviewRows({ rows }: { rows: string[][] }) { return <dl className="listing-review-rows">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>; }
function ReadinessItem({ done, label }: { done: boolean; label: string }) { return <div className={`readiness-item${done ? " is-done" : ""}`}><span>{done ? "✓" : ""}</span><p>{label}</p></div>; }
function ReviewResult({ result }: { result: SubmissionResult | null }) { if (!result) return <div className="validation-empty"><span><Icon name="check" /></span><div><strong>Nenhuma validação executada</strong><p>Valide para confrontar este anúncio com as regras atuais da Amazon.</p></div></div>; return <section className={`validation-result${result.canPublish ? " is-valid" : " is-invalid"}`}><header><span><Icon name={result.canPublish ? "check" : "warning"} /></span><div><strong>{result.preview ? (result.canPublish ? "Pronto para publicar" : "Ajustes necessários") : "Envio aceito pela Amazon"}</strong><p>{result.preview ? `${result.issues.length} aviso(s) retornado(s) na pré-validação.` : `SKU ${result.sku} enviado para processamento.`}</p></div></header>{result.issues.length > 0 && <ul>{result.issues.map((issue, index) => <li key={`${issue.code}-${index}`}><span>{issue.severity}</span><p>{issue.message}</p></li>)}</ul>}{!result.preview && <p className="submission-note">A publicação foi recebida, mas pode passar por revisão de catálogo. Isso é diferente de o SKU já estar ativo ou pronto para envio FBA.</p>}</section>; }
