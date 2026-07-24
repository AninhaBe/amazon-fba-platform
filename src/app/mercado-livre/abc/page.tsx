"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { PanelLoading } from "../../components/LoadingState";
import { PageHeader } from "../../components/PageHeader";

type AbcClass = "A" | "B" | "C";
type Quadrant = "motor" | "vamp" | "joia" | "morto";

interface AbcProduct {
  productId: string;
  sku: string | null;
  title: string;
  units: number;
  revenue: number;
  cost: number;
  fees: number;
  tax: number;
  contribution: number;
  marginPct: number;
  salesClass: AbcClass;
  profitClass: AbcClass;
  quadrant: Quadrant;
  complete: boolean;
}
interface Abc {
  currency: string;
  covered: boolean;
  taxRate: number;
  products: AbcProduct[];
}

const QUAD: Record<Quadrant, { label: string; sub: string; act: string; info: string; dot: string; tag: string; bar: string }> = {
  motor: { label: "Prioritários", sub: "alto giro · alta margem", act: "Proteger e garantir estoque", info: "<b>Seus melhores produtos:</b> giram bem e ainda deixam boa margem. São o motor do lucro — priorize estoque e posição, e nunca deixe faltar.", dot: "bg-emerald-500", tag: "bg-emerald-50 text-emerald-700", bar: "var(--positive)" },
  vamp: { label: "Baixa margem", sub: "alto giro · baixa margem", act: "Rever preço ou frete grátis", info: "<b>Vendem muito, mas sobra pouco</b> por unidade. Costumam esconder frete grátis assumido ou preço apertado. Pequenos ajustes aqui rendem muito no total.", dot: "bg-red-500", tag: "bg-red-50 text-red-600", bar: "var(--danger)" },
  joia: { label: "Potenciais", sub: "baixo giro · alta margem", act: "Investir: anúncio, ads, estoque", info: "<b>Margem alta, mas vendem pouco.</b> Têm espaço para crescer — vale investir em anúncio, ads ou preço mais competitivo sem perder rentabilidade.", dot: "bg-blue-600", tag: "bg-blue-50 text-blue-700", bar: "#2563eb" },
  morto: { label: "Marginais", sub: "baixo giro · baixa margem", act: "Avaliar descontinuar", info: "<b>Vendem pouco e lucram pouco.</b> Consomem estoque, capital e atenção com pouco retorno. Candidatos a revisão de preço ou descontinuação.", dot: "bg-slate-400", tag: "bg-slate-100 text-slate-500", bar: "#94a3b8" },
};
const QUAD_ORDER: Quadrant[] = ["motor", "vamp", "joia", "morto"];

function money(value: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

export default function AbcPage() {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Abc | null>(null);
  const [quad, setQuad] = useState<Quadrant | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetch(`/api/integrations/mercado-livre/abc?days=${days}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || "Não foi possível montar a curva ABC.");
        if (active) { setData(body as Abc); setQuad(null); }
      })
      .catch((err) => active && (setError(err instanceof Error ? err.message : "Erro"), setData(null)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [days]);

  return (
    <div className="dashboard-page meli-workspace space-y-6">
      <PageHeader
        eyebrow="Métricas Mercado Livre"
        title="Curva ABC por lucro"
        subtitle="Classifica seus produtos pela contribuição real (A/B/C) e cruza com o giro para revelar onde está o lucro — e onde ele vaza."
      />

      <div className="flex flex-wrap gap-2">
        <div className="inline-flex overflow-hidden rounded-xl border border-slate-300 bg-white">
          {[7, 15, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`px-3.5 py-2 text-[13px] font-semibold ${days === d ? "bg-amber-600 text-white" : "text-slate-500 hover:text-slate-800"}`}
            >
              {d} dias
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <PanelLoading label="Classificando seus produtos por lucro…" />
      ) : error ? (
        <EmptyState title="Não foi possível montar" description={error} />
      ) : !data || data.products.length === 0 ? (
        <EmptyState title="Sem vendas no período" description="Amplie o período ou aguarde a sincronização terminar." />
      ) : (
        <Results data={data} quad={quad} setQuad={setQuad} />
      )}
    </div>
  );
}

function Results({ data, quad, setQuad }: { data: Abc; quad: Quadrant | null; setQuad: (q: Quadrant | null) => void }) {
  const { products, currency } = data;

  const { totalProfit, skusMaking80, byQuadrant } = useMemo(() => {
    const total = products.reduce((sum, p) => sum + p.contribution, 0);
    const positives = products.filter((p) => p.contribution > 0);
    const totalPos = positives.reduce((sum, p) => sum + p.contribution, 0) || 1;
    let cumulative = 0;
    let count = 0;
    for (const p of positives) { cumulative += p.contribution; count++; if (cumulative / totalPos >= 0.8) break; }
    const groups: Record<Quadrant, { count: number; profit: number }> = {
      motor: { count: 0, profit: 0 }, vamp: { count: 0, profit: 0 }, joia: { count: 0, profit: 0 }, morto: { count: 0, profit: 0 },
    };
    for (const p of products) { groups[p.quadrant].count++; groups[p.quadrant].profit += p.contribution; }
    return { totalProfit: total, skusMaking80: count, byQuadrant: groups };
  }, [products]);

  const shown = quad ? products.filter((p) => p.quadrant === quad) : products;

  return (
    <div className="space-y-5">
      <p className="text-[15px] text-slate-600">
        <b className="font-bold text-slate-900">{skusMaking80} SKU{skusMaking80 !== 1 ? "s" : ""}</b>{" "}
        ({Math.round((skusMaking80 / products.length) * 100)}% do catálogo) fazem{" "}
        <b className="font-bold text-slate-900">80% do seu lucro</b> no período.
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {QUAD_ORDER.map((k) => {
          const q = QUAD[k];
          const g = byQuadrant[k];
          const share = totalProfit ? (g.profit / totalProfit) * 100 : 0;
          const selected = quad === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setQuad(selected ? null : k)}
              className={`abc-quad rounded-2xl border bg-white p-4 text-left shadow-sm transition ${selected ? "border-amber-500 ring-2 ring-amber-500/20" : "border-slate-200 hover:border-amber-400"}`}
            >
              <span
                className="abc-info"
                tabIndex={0}
                role="button"
                aria-label={`O que é ${q.label}`}
                onClick={(e) => e.stopPropagation()}
              >
                i<span className="abc-pop" dangerouslySetInnerHTML={{ __html: q.info }} />
              </span>
              <div className="flex items-center gap-2 text-[13px] font-bold text-slate-800">
                <span className={`h-2.5 w-2.5 rounded ${q.dot}`} />
                {q.label}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">{q.sub}</div>
              <div className="mt-2 text-[26px] font-extrabold tabular-nums tracking-tight text-slate-900">
                {g.count}
                <small className="ml-1 text-[13px] font-semibold text-slate-400">SKUs</small>
              </div>
              <div className="text-xs text-slate-500">{share.toFixed(0)}% do lucro</div>
              <div className="mt-2 border-t border-dashed border-slate-200 pt-2 text-xs text-slate-500">{q.act}</div>
            </button>
          );
        })}
      </div>

      <div className="space-y-5">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-[15px] font-bold text-slate-900">Concentração do lucro (Pareto)</h2>
              <p className="mt-0.5 text-[12.5px] text-slate-400">Cada barra é um produto (do mais ao menos lucrativo); a linha é o lucro acumulado.</p>
            </div>
            <div className="flex flex-wrap gap-3.5 text-[11.5px] text-slate-500">
              <span><i className="mr-1 inline-block h-[11px] w-[11px] rounded-sm align-[-1px]" style={{ background: "var(--positive)" }} />Classe A (80%)</span>
              <span><i className="mr-1 inline-block h-[11px] w-[11px] rounded-sm align-[-1px]" style={{ background: "#f59e0b" }} />Classe B (+15%)</span>
              <span><i className="mr-1 inline-block h-[11px] w-[11px] rounded-sm align-[-1px]" style={{ background: "#94a3b8" }} />Classe C (5%)</span>
            </div>
          </div>
          <div className="px-5 py-4"><Pareto products={products} /></div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-[15px] font-bold text-slate-900">
              {quad ? `Produtos · ${QUAD[quad].label}` : `Produtos (${products.length})`}
            </h2>
            <p className="mt-0.5 text-[12.5px] text-slate-400">Classe A/B/C pela contribuição acumulada. Clique num quadrante para filtrar.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="[&_th]:border-b [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-[11px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-slate-500">
                  <th className="text-left">Produto</th>
                  <th className="text-right">Un.</th>
                  <th className="text-right">Faturamento</th>
                  <th className="text-right">Lucro</th>
                  <th className="text-right">Margem</th>
                  <th className="text-center">Classe</th>
                  <th className="text-left">Quadrante</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const q = QUAD[p.quadrant];
                  const clsColor = p.profitClass === "A" ? "bg-emerald-50 text-emerald-700" : p.profitClass === "B" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500";
                  return (
                    <tr key={p.sku || p.productId} className="[&_td]:border-b [&_td]:border-slate-100 [&_td]:px-3 [&_td]:py-2.5 [&_td]:tabular-nums hover:bg-slate-50">
                      <td className="!text-left">
                        <div className="flex max-w-[240px] flex-col">
                          <strong className="truncate text-[13px] font-semibold" title={p.title}>{p.title}</strong>
                          <small className="font-mono text-[11px] text-slate-400">{p.sku || p.productId}{!p.complete && " · parcial"}</small>
                        </div>
                      </td>
                      <td className="text-right">{p.units}</td>
                      <td className="text-right">{money(p.revenue, currency)}</td>
                      <td className={`text-right font-bold ${p.contribution < 0 ? "text-red-600" : "text-emerald-700"}`}>{money(p.contribution, currency)}</td>
                      <td className={`text-right ${p.contribution < 0 ? "font-bold text-red-600" : ""}`}>{p.marginPct.toFixed(1)}%</td>
                      <td className="text-center">
                        <span className={`inline-grid h-[22px] w-[22px] place-items-center rounded-md text-[12px] font-extrabold ${clsColor}`}>{p.profitClass}</span>
                      </td>
                      <td className="!text-left">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${q.tag}`}>
                          <span className={`h-1.5 w-1.5 rounded-sm ${q.dot}`} />{q.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {!data.covered && (
        <p className="flex gap-2 px-1 text-xs text-slate-400">
          <span aria-hidden="true">ℹ️</span>
          <span>Ainda sincronizando o período — alguns produtos podem aparecer como &quot;parcial&quot; até a conciliação terminar.</span>
        </p>
      )}
    </div>
  );
}

function Pareto({ products }: { products: AbcProduct[] }) {
  const pos = products.filter((p) => p.contribution > 0);
  if (pos.length === 0) return <p className="py-8 text-center text-sm text-slate-400">Sem lucro positivo no período.</p>;
  const W = 1000, H = 190, padL = 6, padR = 6, padT = 12, padB = 8;
  const n = pos.length;
  const gap = (W - padL - padR) / n;
  const bw = gap * 0.72;
  const maxP = Math.max(...pos.map((p) => p.contribution), 1);
  const totalPos = pos.reduce((s, p) => s + p.contribution, 0) || 1;
  let cum = 0;
  const bars: React.ReactNode[] = [];
  const pts: Array<[number, number]> = [];
  pos.forEach((p, i) => {
    const x = padL + i * gap + (gap - bw) / 2;
    const h = (p.contribution / maxP) * (H - padT - padB) * 0.82;
    cum += p.contribution;
    const cpct = cum / totalPos;
    pts.push([x + bw / 2, padT + (H - padT - padB) * (1 - cpct)]);
    const col = cpct <= 0.8 ? "var(--positive)" : cpct <= 0.95 ? "#f59e0b" : "#94a3b8";
    bars.push(<rect key={p.sku || p.productId} x={x.toFixed(1)} y={(H - padB - h).toFixed(1)} width={bw.toFixed(1)} height={h.toFixed(1)} rx={2} fill={col}><title>{`${p.sku || p.productId}: ${money(p.contribution)}`}</title></rect>);
  });
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const y80 = padT + (H - padT - padB) * (1 - 0.8);
  const y95 = padT + (H - padT - padB) * (1 - 0.95);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      <line x1={padL} y1={y80} x2={W - padR} y2={y80} stroke="#cbd5e1" strokeDasharray="3 3" />
      <line x1={padL} y1={y95} x2={W - padR} y2={y95} stroke="#e2e8f0" strokeDasharray="3 3" />
      {bars}
      <path d={line} fill="none" stroke="#1b1e24" strokeWidth={1.6} />
      {pts.map((p, i) => <circle key={i} cx={p[0].toFixed(1)} cy={p[1].toFixed(1)} r={2.2} fill="#1b1e24" />)}
    </svg>
  );
}
