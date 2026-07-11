"use client";

import { useState, useEffect } from "react";
import { PageHeader, pageIcons } from "../components/PageHeader";

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
      const data = await res.json();
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
    if (a) fetchPrice(a);
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
      const data = await res.json();
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
    <div className="space-y-8">
      <PageHeader
        eyebrow="Product Fees · Pricing · Catalog"
        title="Calculadora de lucro"
        subtitle="Digite um ASIN e compare os três modos de logística lado a lado — FBA, Próprio (FBM) e DBA — com as taxas reais da Amazon."
        icon={pageIcons.calculator}
      />

      {/* Entradas compartilhadas */}
      <form
        onSubmit={calculate}
        className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-3"
      >
        <div className="flex flex-col gap-1 sm:col-span-3">
          <span className="text-sm font-medium">ASIN do produto</span>
          <div className="flex gap-2">
            <input
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
          {priceError && <span className="text-xs text-red-600">{priceError}</span>}
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
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Comparação lado a lado */}
      {result && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {columns.map((col) => {
            const isBest = col.net === bestNet && num(price) > 0;
            const positive = col.net >= 0;
            return (
              <div
                key={col.key}
                className={`flex flex-col rounded-2xl border bg-white p-5 shadow-sm ${
                  isBest ? "border-emerald-400 ring-2 ring-emerald-200" : "border-slate-200"
                }`}
              >
                <div className="flex flex-col items-center text-center">
                  <span
                    className={`mb-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      isBest ? "bg-emerald-100 text-emerald-700" : "invisible"
                    }`}
                  >
                    Melhor lucro
                  </span>
                  <h3 className="text-lg font-bold">{col.label}</h3>
                  <p className="text-xs text-slate-400">{col.hint}</p>
                </div>

                {/* Lucro + margem em destaque */}
                <div
                  className={`mt-4 rounded-xl p-4 text-center ${
                    positive
                      ? "bg-gradient-to-br from-emerald-500 to-emerald-600"
                      : "bg-gradient-to-br from-red-500 to-red-600"
                  }`}
                >
                  <p className="text-xs font-medium text-white/80">Lucro líquido / unidade</p>
                  <p className="text-3xl font-bold tabular-nums text-white">
                    {money(col.net, result.currency)}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-white/25 pt-3">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-white/70">
                        Margem
                      </p>
                      <p className="text-2xl font-bold tabular-nums text-white">
                        {col.marginPct.toFixed(1)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-white/70">
                        ROI
                      </p>
                      <p className="text-2xl font-bold tabular-nums text-white">
                        {num(cost) > 0 ? `${col.roiPct.toFixed(1)}%` : "—"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Detalhamento */}
                <ul className="mt-4 space-y-2 text-sm">
                  <li className="flex justify-between font-medium text-slate-900">
                    <span>Preço de venda</span>
                    <span className="tabular-nums">{money(num(price), result.currency)}</span>
                  </li>
                  {col.lines.map((l) => (
                    <li key={l.label} className="flex justify-between text-slate-500">
                      <span>{l.label}</span>
                      <span className="tabular-nums">− {money(l.value, result.currency)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between text-slate-500">
                    <span>Custo do produto</span>
                    <span className="tabular-nums">− {money(num(cost), result.currency)}</span>
                  </li>
                  <li className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
                    <span>Lucro líquido</span>
                    <span className={`tabular-nums ${positive ? "text-emerald-600" : "text-red-600"}`}>
                      {money(col.net, result.currency)}
                    </span>
                  </li>
                </ul>

                {/* Custos editáveis específicos do modo */}
                <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                  {col.key === "FBA" && (
                    <>
                      <EditCost label="Armazenagem/mês (R$)" value={storage} onChange={setStorage} />
                      <EditCost label="Frete até o centro (R$)" value={fbaShip} onChange={setFbaShip} />
                    </>
                  )}
                  {col.key === "FBM" && (
                    <EditCost label="Seu envio ao cliente (R$)" value={fbmShip} onChange={setFbmShip} />
                  )}
                  {col.key === "DBA" && (
                    <EditCost label="Coleta + entrega DBA (R$)" value={dbaFee} onChange={setDbaFee} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {result && (
        <p className="text-xs text-slate-400">
          Comissão e logística FBA vêm cravadas da Amazon (Product Fees API). Armazenagem,
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
