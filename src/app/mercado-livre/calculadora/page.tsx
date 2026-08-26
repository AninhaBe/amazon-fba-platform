"use client";

import { useEffect, useMemo, useState } from "react";
import { dicaDoImposto } from "@/lib/aliquota";
import { PageHeader, pageIcons } from "../../components/PageHeader";
import { calculateMarketplaceScenario } from "@/lib/marketplaceCalculator";
import { marginStateClass } from "@/lib/marginTone";

interface Product {
  id: string;
  title: string;
  price: number;
  currency: string;
  thumbnail: string | null;
  cost: number | null;
  categoryId?: string;
  listingTypeId?: string;
  shippingMode?: string | null;
  logisticType?: string | null;
  catalogProduct?: boolean;
  estimatedSellerShipping?: number | null;
}

interface SaleFee {
  itemId: string;
  currency: string;
  listingTypeName: string;
  listingTypeId: string;
  total: number;
  fixed: number;
  percentage: number;
  financing: number;
}

function number(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

function pct(value: number) {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export default function MercadoLivreCalculatorPage() {
  const [externalListing, setExternalListing] = useState<Product | null>(null);
  const [reference, setReference] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [itemId, setItemId] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  // Vazio, não "0": campo pré-preenchido com zero afirma isenção antes de a
  // vendedora informar qualquer coisa.
  const [taxRate, setTaxRate] = useState("");
  // A alíquota que está SALVA na conta. O campo acima é simulação e pode
  // divergir — guardar as duas é o que permite a tela dizer qual é qual.
  const [aliquotaSalva, setAliquotaSalva] = useState<number | null>(null);
  const [sellerShipping, setSellerShipping] = useState("");
  const [adsRate, setAdsRate] = useState("");
  const [otherCosts, setOtherCosts] = useState("");
  const [targetMargin, setTargetMargin] = useState("20");
  const [fee, setFee] = useState<SaleFee | null>(null);
  const [premiumFee, setPremiumFee] = useState<SaleFee | null>(null);
  const [feePrice, setFeePrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/integrations/mercado-livre/settings", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar o imposto configurado.");
      // `null` = não configurada. `String(null)` escreveria "null" no campo.
      setTaxRate(data.taxRate == null ? "" : String(data.taxRate));
      setAliquotaSalva(data.taxRate ?? null);
    }).catch((reason) => {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setError(reason instanceof Error ? reason.message : "Não foi possível carregar a calculadora.");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const salePrice = number(price);
    if (!itemId || salePrice <= 0) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setCalculating(true);
      setError(null);
      const requestFee = async (listingTypeId?: "gold_special" | "gold_pro") => {
        const response = await fetch("/api/integrations/mercado-livre/calculator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId,
            price: salePrice,
            ...(externalListing ? {
              useContext: true,
              categoryId: externalListing.categoryId || "",
              listingTypeId,
              currency: externalListing.currency,
              shippingMode: externalListing.shippingMode,
              logisticType: externalListing.logisticType,
            } : {}),
          }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível consultar a tarifa de venda.");
        return data;
      };
      void Promise.all(externalListing
        ? [requestFee("gold_special"), requestFee("gold_pro")]
        : [requestFee()]
      ).then(([classic, premium]) => {
        setFee(classic.fee);
        setPremiumFee(premium?.fee ?? null);
        setFeePrice(classic.price);
      }).catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setFee(null);
          setPremiumFee(null);
          setFeePrice(null);
          setError(reason instanceof Error ? reason.message : "Não foi possível consultar a tarifa de venda.");
        }
      }).finally(() => {
        if (!controller.signal.aborted) setCalculating(false);
      });
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [itemId, price, externalListing]);

  const selected = externalListing?.id === itemId ? externalListing : null;
  const currentPrice = number(price);
  const feeIsCurrent = fee && fee.itemId === itemId && feePrice === currentPrice
    && (!externalListing || fee.listingTypeId === "gold_special");
  const premiumFeeIsCurrent = premiumFee && premiumFee.itemId === itemId && feePrice === currentPrice
    && premiumFee.listingTypeId === "gold_pro";
  const scenario = useMemo(() => calculateMarketplaceScenario({
    price: currentPrice,
    productCost: number(cost),
    marketplaceFee: feeIsCurrent ? fee.total : 0,
    fixedMarketplaceFee: feeIsCurrent ? fee.fixed : 0,
    taxRate: number(taxRate),
    sellerShipping: number(sellerShipping),
    adsRate: number(adsRate),
    otherCosts: number(otherCosts),
    targetMarginRate: number(targetMargin),
  }), [currentPrice, cost, fee, feeIsCurrent, taxRate, sellerShipping, adsRate, otherCosts, targetMargin]);
  const premiumScenario = useMemo(() => calculateMarketplaceScenario({
    price: currentPrice,
    productCost: number(cost),
    marketplaceFee: premiumFeeIsCurrent ? premiumFee.total : 0,
    fixedMarketplaceFee: premiumFeeIsCurrent ? premiumFee.fixed : 0,
    taxRate: number(taxRate),
    sellerShipping: number(sellerShipping),
    adsRate: number(adsRate),
    otherCosts: number(otherCosts),
    targetMarginRate: number(targetMargin),
  }), [currentPrice, cost, premiumFee, premiumFeeIsCurrent, taxRate, sellerShipping, adsRate, otherCosts, targetMargin]);

  async function lookupListing(event: React.FormEvent) {
    event.preventDefault();
    if (!reference.trim()) return;
    setLookingUp(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations/mercado-livre/calculator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar esse anúncio.");
      const listing = { ...data.listing, cost: null } as Product;
      setExternalListing(listing);
      setItemId(listing.id);
      setPrice(listing.price > 0 ? String(listing.price) : "");
      setCost("");
      setSellerShipping(listing.estimatedSellerShipping == null ? "" : String(listing.estimatedSellerShipping));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar esse anúncio.");
    } finally {
      setLookingUp(false);
    }
  }

  const ready = !!feeIsCurrent && currentPrice > 0;
  const currency = fee?.currency || selected?.currency || "BRL";

  return <div className="meli-calculator-page tool-page">
    <PageHeader
      eyebrow="Simulação Mercado Livre"
      title="Calculadora de margem"
      subtitle="Cole qualquer anúncio que encontrou no Mercado Livre e descubra se vale a pena vender esse produto."
      icon={pageIcons.calculator}
    />

    {error && <div role="alert" className="meli-calculator-alert">{error}</div>}

    {loading ? <div className="meli-calculator-loading">Preparando a calculadora…</div> : <div className="meli-calculator-layout">
      <section className="meli-calculator-form" aria-labelledby="simulation-inputs">
        <div className="meli-calculator-section-heading">
          <div><p className="section-kicker">Cenário</p><h2 id="simulation-inputs">Dados da venda</h2></div>
          <span>Os resultados atualizam automaticamente</span>
        </div>

        <form className="meli-listing-lookup" onSubmit={lookupListing}>
          <label htmlFor="meli-listing-reference"><span>Anúncio que você encontrou</span><small>Cole o link completo ou informe o código MLB ou MLBU.</small></label>
          <div><input id="meli-listing-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="https://produto.mercadolivre.com.br/MLB-…" /><button type="submit" disabled={lookingUp || !reference.trim()}>{lookingUp ? "Buscando…" : "Analisar anúncio"}</button></div>
        </form>

        {selected && <div className="meli-selected-product">
          {selected.thumbnail && <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={selected.thumbnail} alt="" />
          </>}
          <div><strong>{selected.title}</strong><small>{selected.id}</small></div>
          <span>{selected.price > 0 ? money(selected.price, selected.currency) : "Informe o preço"}</span>
        </div>}

        <div className="meli-field-grid">
          <MoneyField label="Preço de venda" value={price} onChange={setPrice} placeholder="0,00" />
          <MoneyField label="Custo do produto" value={cost} onChange={setCost} placeholder="0,00" hint={selected?.cost == null ? "Ainda não cadastrado" : "Preenchido pelo cadastro"} />
          <MoneyField label="Frete pago por você" value={sellerShipping} onChange={setSellerShipping} placeholder="0,00" hint={externalListing?.estimatedSellerShipping == null ? undefined : "Estimado para sua conta e a logística encontrada"} />
          {/*
            ⚠️ ESTE CAMPO NÃO SALVA — E PRECISA DIZER ISSO.
            A calculadora só faz GET em /settings; os POST dela vão para
            /calculator, que consulta tarifa. O `taxRate` aqui é `useState`:
            some ao trocar de página.
            Antes a dica dizia "Alíquota configurada" assim que qualquer número
            fosse digitado. Em 25/08/2026 alguém digitou 5%, leu "configurada",
            e o dashboard do canal passou horas com lucro e margem em "—"
            esperando uma alíquota que nunca foi gravada. Quem salva de verdade
            é o card em /mercado-livre/produtos.
          */}
          <RateField label="Imposto sobre a venda" value={taxRate} onChange={setTaxRate} hint={dicaDoImposto(taxRate, aliquotaSalva)} />
          <RateField label="Publicidade" value={adsRate} onChange={setAdsRate} hint="ACOS esperado" />
          <MoneyField label="Embalagem e outros" value={otherCosts} onChange={setOtherCosts} placeholder="0,00" />
        </div>

        <div className="meli-target-row">
          <RateField label="Margem desejada" value={targetMargin} onChange={setTargetMargin} />
          <div><span>Preço sugerido</span><strong>{ready && scenario.suggestedPrice != null ? money(scenario.suggestedPrice, currency) : "—"}</strong><small>Estimativa com a estrutura de tarifa atual</small></div>
        </div>
      </section>

      <div className="meli-calculator-results">
      <aside className={`meli-calculator-result${ready ? " is-ready" : ""}`} aria-live="polite">
        {!ready ? <div className="meli-result-placeholder">
          <span aria-hidden="true">%</span>
          <h2>{calculating ? "Consultando tarifa…" : "Monte uma simulação"}</h2>
          <p>{calculating ? "Estamos verificando os custos deste anúncio para o preço informado." : "Cole um anúncio do Mercado Livre para ver a margem e cada desconto da venda."}</p>
        </div> : <>
          <header><div><p>Margem de contribuição</p><strong className={marginStateClass(scenario.marginRate)}>{pct(scenario.marginRate)}</strong></div><span>{fee.listingTypeName}</span></header>
          <div className="meli-result-kpis">
            <div><span>Sobra por unidade</span><strong>{money(scenario.contribution, currency)}</strong></div>
            <div><span>ROI sobre o produto</span><strong>{scenario.roiRate == null ? "—" : pct(scenario.roiRate)}</strong></div>
          </div>
          <div className="meli-calculator-breakdown">
            <ResultLine label="Preço de venda" value={currentPrice} currency={currency} revenue />
            <ResultLine label={`Tarifa de venda (${pct(fee.percentage)})`} value={fee.total} currency={currency} />
            <ResultLine label={`Imposto (${pct(number(taxRate))})`} value={scenario.tax} currency={currency} />
            <ResultLine label="Frete pago por você" value={number(sellerShipping)} currency={currency} />
            <ResultLine label="Custo do produto" value={number(cost)} currency={currency} />
            <ResultLine label={`Publicidade (${pct(number(adsRate))})`} value={scenario.ads} currency={currency} />
            <ResultLine label="Embalagem e outros" value={number(otherCosts)} currency={currency} />
            <ResultLine label="Margem de contribuição" value={scenario.contribution} currency={currency} total />
          </div>
          <div className="meli-ads-limit"><div><span>Teto de publicidade</span><strong>{pct(scenario.maxAdsRate)}</strong></div><p>Até {money(scenario.maxAdsAmount, currency)} por venda antes de zerar a margem.</p></div>
          <p className="meli-fee-source">{externalListing?.catalogProduct && !externalListing.categoryId
            ? "Estimativa para a modalidade e o preço informados. Esta página de catálogo não expôs uma oferta vencedora; a tarifa pode variar conforme a categoria do anúncio que você criar."
            : "Tarifa consultada no Mercado Livre para a categoria, modalidade, logística e preço informados."}{fee.fixed > 0 ? ` Inclui ${money(fee.fixed, currency)} de parcela fixa.` : ""}</p>
        </>}
      </aside>
      {ready && premiumFeeIsCurrent && <section className="meli-calculator-result meli-premium-result is-ready" aria-label="Cenário Premium">
        <header><div><p>Margem de contribuição</p><strong className={marginStateClass(premiumScenario.marginRate)}>{pct(premiumScenario.marginRate)}</strong></div><span>{premiumFee.listingTypeName}</span></header>
        <div className="meli-result-kpis">
          <div><span>Sobra por unidade</span><strong>{money(premiumScenario.contribution, currency)}</strong></div>
          <div><span>ROI sobre o produto</span><strong>{premiumScenario.roiRate == null ? "—" : pct(premiumScenario.roiRate)}</strong></div>
        </div>
        <div className="meli-calculator-breakdown">
          <ResultLine label="Preço de venda" value={currentPrice} currency={currency} revenue />
          <ResultLine label={`Tarifa de venda (${pct(premiumFee.percentage)})`} value={premiumFee.total} currency={currency} />
          <ResultLine label={`Imposto (${pct(number(taxRate))})`} value={premiumScenario.tax} currency={currency} />
          <ResultLine label="Frete pago por você" value={number(sellerShipping)} currency={currency} />
          <ResultLine label="Custo do produto" value={number(cost)} currency={currency} />
          <ResultLine label={`Publicidade (${pct(number(adsRate))})`} value={premiumScenario.ads} currency={currency} />
          <ResultLine label="Embalagem e outros" value={number(otherCosts)} currency={currency} />
          <ResultLine label="Margem de contribuição" value={premiumScenario.contribution} currency={currency} total />
        </div>
        <div className="meli-ads-limit"><div><span>Teto de publicidade</span><strong>{pct(premiumScenario.maxAdsRate)}</strong></div><p>Até {money(premiumScenario.maxAdsAmount, currency)} por venda antes de zerar a margem.</p></div>
        <p className="meli-fee-source">Cenário Premium calculado automaticamente com a mesma categoria, logística e custos do Clássico.</p>
      </section>}
      </div>
    </div>}
  </div>;
}

function MoneyField({ label, value, onChange, placeholder, hint }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; hint?: string }) {
  return <label className="meli-field"><span>{label}</span><div className="meli-affixed-input"><b>R$</b><input type="number" min="0" step="0.01" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></div>{hint && <small>{hint}</small>}</label>;
}

function RateField({ label, value, onChange, hint }: { label: string; value: string; onChange: (value: string) => void; hint?: string }) {
  return <label className="meli-field"><span>{label}</span><div className="meli-affixed-input is-rate"><input type="number" min="0" max="100" step="0.01" value={value} onChange={(event) => onChange(event.target.value)} placeholder="0,00" /><b>%</b></div>{hint && <small>{hint}</small>}</label>;
}

function ResultLine({ label, value, currency, revenue = false, total = false }: { label: string; value: number; currency: string; revenue?: boolean; total?: boolean }) {
  return <div className={`${revenue ? "is-revenue" : ""}${total ? " is-total" : ""}`}><span>{label}</span><strong>{revenue || total ? "" : "− "}{money(value, currency)}</strong></div>;
}
