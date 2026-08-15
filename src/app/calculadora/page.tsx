"use client";

import { useState, useEffect } from "react";
import { PageHeader, pageIcons } from "../components/PageHeader";
import { readJson } from "../../lib/readJson";
import { AmazonTaxRateSetting } from "../components/AmazonTaxRateSetting";

interface ModeFees {
  totalFees: number;
  feeDetails: { type: string; amount: number }[];
}
interface FeesResult {
  currency: string;
  fba: ModeFees;
  fbm: ModeFees;
}

function money(v: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);
}
function num(v: string) {
  return Number(v || 0) || 0;
}

interface Column {
  key: string;
  label: string;
  hint: string;
  lines: { label: string; value: number }[];
  amazonFees: number;
  extras: number;
  net: number;
  marginPct: number;
  roiPct: number;
}

export default function CalculatorPage() {
  const [asin, setAsin] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");

  // Custos específicos por modo (editáveis)
  const [storage, setStorage] = useState(""); // FBA — armazenagem/mês
  const [fbaShip, setFbaShip] = useState(""); // FBA — frete até o centro
  const [fbmShip, setFbmShip] = useState(""); // FBM — seu envio ao cliente
  const [dbaFee, setDbaFee] = useState(""); // DBA — coleta + entrega

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FeesResult | null>(null);

  const [fetchingPrice, setFetchingPrice] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [lastFetchedAsin, setLastFetchedAsin] = useState("");
  const [product, setProduct] = useState<{
    title?: string;
    brand?: string;
    imageUrl?: string;
    source?: string;
    dimensionsCm?: { length: number; width: number; height: number };
    volumeM3?: number;
    storageRatePerM3?: number;
    estimatedStorageFee?: number;
  } | null>(null);

  async function fetchPrice(asinOverride?: string) {
    const target = (asinOverride ?? asin).trim();
    if (!target) {
      setPriceError("Informe o ASIN primeiro.");
      return;
    }
    if (asinOverride) setAsin(asinOverride);
    setPriceError(null);
    setProduct(null);
    setFetchingPrice(true);
    setLastFetchedAsin(target);
    try {
      const res = await fetch(`/api/price?asin=${encodeURIComponent(target)}`);
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Erro ao buscar preço.");
      setPrice(String(data.price.listingPrice));
      if (data.info?.estimatedStorageFee != null) setStorage(String(data.info.estimatedStorageFee));
      setProduct({
        title: data.info?.title,
        brand: data.info?.brand,
        imageUrl: data.info?.imageUrl,
        source: data.price.source,
        dimensionsCm: data.info?.dimensionsCm,
        volumeM3: data.info?.volumeM3,
        storageRatePerM3: data.info?.storageRatePerM3,
        estimatedStorageFee: data.info?.estimatedStorageFee,
      });
    } catch (err) {
      setPriceError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setFetchingPrice(false);
    }
  }

  // Ao abrir com ?asin=... (vindo da Pesquisa), preenche e já busca o preço.
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("asin");
    const timer = a ? window.setTimeout(() => void fetchPrice(a), 0) : undefined;
    return () => {
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function calculate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/fees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asin, price: num(price) }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Erro ao calcular.");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setLoading(false);
    }
  }

  // Monta as colunas de comparação a partir do resultado + custos editáveis.
  let columns: Column[] = [];
  if (result) {
    const p = num(price);
    const c = num(cost);
    const referral = result.fbm.totalFees; // FBM devolve só a comissão
    const fbaFulfill = Math.max(0, result.fba.totalFees - referral);

    const build = (
      key: string,
      label: string,
      hint: string,
      lines: { label: string; value: number }[]
    ): Column => {
      const amazonFees = lines.reduce((s, l) => s + l.value, 0);
      const net = p - c - amazonFees;
      return {
        key,
        label,
        hint,
        lines,
        amazonFees,
        extras: amazonFees - referral,
        net,
        marginPct: p > 0 ? (net / p) * 100 : 0,
        roiPct: c > 0 ? (net / c) * 100 : 0,
      };
    };

    columns = [
      build("FBA", "FBA", "Amazon estoca e envia", [
        { label: "Comissão", value: referral },
        { label: "Logística FBA", value: fbaFulfill },
        { label: "Armazenagem/mês", value: num(storage) },
        { label: "Frete até o centro", value: num(fbaShip) },
      ]),
      build("FBM", "Próprio (FBM)", "Você estoca e envia", [
        { label: "Comissão", value: referral },
        { label: "Seu envio ao cliente", value: num(fbmShip) },
      ]),
      build("DBA", "DBA", "Você estoca, Amazon entrega", [
        { label: "Comissão", value: referral },
        { label: "Coleta + entrega (DBA)", value: num(dbaFee) },
      ]),
    ];
  }

  const bestNet = columns.length ? Math.max(...columns.map((col) => col.net)) : 0;

  const inputCls =
    "rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none";

  return (
    <div className="calculator-page space-y-8">
      <PageHeader
        eyebrow="Simulação de rentabilidade"
        title="Calculadora de lucro"
        subtitle="Digite um ASIN e compare FBA, logística própria e DBA com os custos e tarifas da sua operação."
        icon={pageIcons.calculator}
      />

      {/* Entradas compartilhadas */}
      <form
        onSubmit={calculate}
        className="decision-sheet grid grid-cols-1 gap-4 border-y border-slate-300 py-6 sm:grid-cols-3"
      >
        <div className="flex flex-col gap-1 sm:col-span-3">
          <label htmlFor="calculator-asin" className="text-sm font-medium">ASIN do produto</label>
          <div className="flex gap-2">
            <input
              id="calculator-asin"
              required
              value={asin}
              onChange={(e) => setAsin(e.target.value)}
              onBlur={() => {
                if (asin.trim() && asin.trim() !== lastFetchedAsin) fetchPrice();
              }}
              placeholder="B0XXXXXXXX"
              className={`flex-1 ${inputCls}`}
            />
            <button
              type="button"
              onClick={() => fetchPrice()}
              disabled={fetchingPrice}
              className="whitespace-nowrap rounded-lg border border-blue-600 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
            >
              {fetchingPrice ? "Buscando…" : "Buscar preço"}
            </button>
          </div>
          {priceError && <span role="alert" className="text-xs text-red-600">{priceError}</span>}
          {product && (
            <div className="mt-2 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              {product.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={product.imageUrl}
                  alt={product.title || asin}
                  className="h-14 w-14 rounded object-contain"
                />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{product.title || "Produto encontrado"}</p>
                <p className="text-xs text-slate-500">
                  {product.brand ? `${product.brand} · ` : ""}
                  Preço {product.source === "buybox" ? "do Buy Box" : "mais baixo"} preenchido
                </p>
                {product.dimensionsCm && (
                  <p className="text-xs text-slate-400">
                    {product.dimensionsCm.length} × {product.dimensionsCm.width} ×{" "}
                    {product.dimensionsCm.height} cm · {product.volumeM3} m³
                    {product.storageRatePerM3
                      ? ` · armazenagem R$ ${product.storageRatePerM3}/m³`
                      : ""}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            Preço de venda (R$){" "}
            <span className="font-normal text-slate-400">— auto</span>
          </span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={fetchingPrice ? "Buscando…" : "auto ou digite"}
            className={inputCls}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Custo do produto (R$)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="40.00"
            className={inputCls}
          />
        </label>

        <div className="flex items-end">
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Calculando…" : "Comparar logísticas"}
          </button>
        </div>
      </form>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Configuração persistente, não entrada do cálculo acima: fica salva na
          conta e alimenta o lucro do dashboard. Mesmo desenho do ML. */}
      <AmazonTaxRateSetting />

      {/* Comparação lado a lado */}
      {result && (
        <section className="logistics-board">
          <div className="logistics-board-heading">
            <div>
              <p className="section-kicker">Cenários calculados</p>
              <h2>Comparação por modalidade</h2>
            </div>
            <p>Edite os custos variáveis em cada opção; o resultado é atualizado na hora.</p>
          </div>

          <div className="logistics-comparison">
            {columns.map((col) => {
              const isBest = col.net === bestNet && num(price) > 0;
              const positive = col.net >= 0;
              return (
                <article key={col.key} className={`logistics-option ${isBest ? "is-best" : ""}`}>
                  <header className="logistics-option-heading">
                    <div>
                      <h3>{col.label}</h3>
                      <p>{col.hint}</p>
                    </div>
                    {isBest && <span className="best-option">Melhor resultado</span>}
                  </header>

                  <div className={`logistics-result ${positive ? "is-positive" : "is-negative"}`}>
                    <div>
                      <p>Lucro por unidade</p>
                      <strong>{money(col.net, result.currency)}</strong>
                    </div>
                    <dl>
                      <div><dt>Margem</dt><dd>{col.marginPct.toFixed(1)}%</dd></div>
                      <div><dt>ROI</dt><dd>{num(cost) > 0 ? `${col.roiPct.toFixed(1)}%` : "—"}</dd></div>
                    </dl>
                  </div>

                  <ul className="logistics-breakdown">
                    <li className="is-revenue"><span>Preço de venda</span><strong>{money(num(price), result.currency)}</strong></li>
                    {col.lines.map((line) => (
                      <li key={line.label}><span>{line.label}</span><span>− {money(line.value, result.currency)}</span></li>
                    ))}
                    <li><span>Custo do produto</span><span>− {money(num(cost), result.currency)}</span></li>
                  </ul>

                  <div className="logistics-editable">
                    <p>Custos sob seu controle</p>
                    {col.key === "FBA" && (
                      <>
                        <EditCost label="Armazenagem/mês (R$)" value={storage} onChange={setStorage} />
                        <EditCost label="Frete até o centro (R$)" value={fbaShip} onChange={setFbaShip} />
                      </>
                    )}
                    {col.key === "FBM" && <EditCost label="Seu envio ao cliente (R$)" value={fbmShip} onChange={setFbmShip} />}
                    {col.key === "DBA" && <EditCost label="Coleta + entrega DBA (R$)" value={dbaFee} onChange={setDbaFee} />}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {result && (
        <p className="text-xs text-slate-400">
          Comissão e logística FBA são calculadas automaticamente. Armazenagem,
          frete e a taxa DBA são custos que você controla — edite em cada coluna e o lucro
          recalcula na hora. O DBA usa a mesma comissão; a taxa de coleta/entrega é a da
          tabela DBA da sua conta.
        </p>
      )}
    </div>
  );
}

function EditCost({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-slate-500">
      <span>{label}</span>
      <input
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
        className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums focus:border-blue-500 focus:outline-none"
      />
    </label>
  );
}
