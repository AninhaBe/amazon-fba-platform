"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "./EmptyState";
import { PanelLoading } from "./LoadingState";
import { PageHeader } from "./PageHeader";

// Curva ABC por lucro — visão compartilhada entre canais. A fonte de dados muda
// pelo `endpoint`; o formato de resposta é idêntico (Mercado Livre e Amazon).

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
  contribution: number | null;
  marginPct: number | null;
  costMissing: boolean;
  salesClass: AbcClass;
  profitClass: AbcClass | null;
  quadrant: Quadrant | null;
  complete: boolean;
}
interface Abc {
  currency: string;
  covered: boolean;
  taxRate: number;
  products: AbcProduct[];
}

interface AbcRequestState {
  key: string;
  data: Abc | null;
  error: string | null;
}

const QUAD: Record<Quadrant, { label: string; sub: string; act: string; info: string; dot: string; tag: string }> = {
  motor: { label: "Prioritários", sub: "alto giro · alta margem", act: "Proteger e garantir estoque", info: "<b>Seus melhores produtos:</b> giram bem e ainda deixam boa margem. São o motor do lucro — priorize estoque e posição, e nunca deixe faltar.", dot: "bg-emerald-500", tag: "bg-emerald-50 text-emerald-700" },
  vamp: { label: "Baixa margem", sub: "alto giro · baixa margem", act: "Rever preço ou frete grátis", info: "<b>Vendem muito, mas sobra pouco</b> por unidade. Costumam esconder frete grátis assumido ou preço apertado. Pequenos ajustes aqui rendem muito no total.", dot: "bg-red-500", tag: "bg-red-50 text-red-600" },
  joia: { label: "Potenciais", sub: "baixo giro · alta margem", act: "Investir: anúncio, ads, estoque", info: "<b>Margem alta, mas vendem pouco.</b> Têm espaço para crescer — vale investir em anúncio, ads ou preço mais competitivo sem perder rentabilidade.", dot: "bg-blue-600", tag: "bg-blue-50 text-blue-700" },
  morto: { label: "Marginais", sub: "baixo giro · baixa margem", act: "Avaliar descontinuar", info: "<b>Vendem pouco e lucram pouco.</b> Consomem estoque, capital e atenção com pouco retorno. Candidatos a revisão de preço ou descontinuação.", dot: "bg-[var(--ink-32)]", tag: "bg-[var(--ink-05)] text-[var(--ink-muted)]" },
};
const QUAD_ORDER: Quadrant[] = ["motor", "vamp", "joia", "morto"];

function money(value: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

export function AbcView({ endpoint, eyebrow, subtitle, costsHref }: { endpoint: string; eyebrow: string; subtitle: string; costsHref: string }) {
  const [days, setDays] = useState(30);
  const requestKey = `${endpoint}:${days}`;
  const [request, setRequest] = useState<AbcRequestState>({ key: "", data: null, error: null });
  const [quad, setQuad] = useState<Quadrant | null>(null);

  const currentRequest = request.key === requestKey ? request : null;
  const loading = currentRequest == null;
  const error = currentRequest?.error ?? null;
  const data = currentRequest?.data ?? null;

  function selectDays(nextDays: number) {
    if (nextDays === days) return;
    setRequest({ key: "", data: null, error: null });
    setDays(nextDays);
  }

  useEffect(() => {
    let active = true;
    fetch(`${endpoint}?days=${days}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || "Não foi possível montar a curva ABC.");
        if (active) { setRequest({ key: requestKey, data: body as Abc, error: null }); setQuad(null); }
      })
      .catch((err) => active && setRequest({ key: requestKey, data: null, error: err instanceof Error ? err.message : "Erro" }));
    return () => { active = false; };
  }, [days, endpoint, requestKey]);

  return (
    <div className="dashboard-page analysis-page abc-page">
      <PageHeader eyebrow={eyebrow} title="Curva ABC por lucro" subtitle={subtitle} />

      <div className="abc-period-tabs" role="tablist" aria-label="Período da curva ABC">
          {[7, 15, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => selectDays(d)}
              role="tab"
              aria-selected={days === d}
            >
              {d} dias
            </button>
          ))}
      </div>

      {loading ? (
        <PanelLoading label="Classificando seus produtos por lucro…" />
      ) : error ? (
        <EmptyState title="Não foi possível montar" description={error} />
      ) : !data || data.products.length === 0 ? (
        <EmptyState title="Sem vendas no período" description="Amplie o período ou aguarde a sincronização terminar." />
      ) : (
        <Results data={data} quad={quad} setQuad={setQuad} costsHref={costsHref} />
      )}
    </div>
  );
}

function Results({ data, quad, setQuad, costsHref }: { data: Abc; quad: Quadrant | null; setQuad: (q: Quadrant | null) => void; costsHref: string }) {
  const { products, currency } = data;

  const { totalProfit, skusMaking80, byQuadrant, classified, costMissing } = useMemo(() => {
    // Só produtos COM custo cadastrado entram no cálculo de lucro; os demais
    // ("custo pendente") não têm margem confiável e ficam de fora.
    const withCost = products.filter((p) => p.contribution != null);
    const missing = products.filter((p) => p.costMissing).length;
    const total = withCost.reduce((sum, p) => sum + (p.contribution ?? 0), 0);
    const positives = withCost.filter((p) => (p.contribution ?? 0) > 0);
    const totalPos = positives.reduce((sum, p) => sum + (p.contribution ?? 0), 0) || 1;
    let cumulative = 0;
    let count = 0;
    for (const p of positives) { cumulative += p.contribution ?? 0; count++; if (cumulative / totalPos >= 0.8) break; }
    const groups: Record<Quadrant, { count: number; profit: number }> = {
      motor: { count: 0, profit: 0 }, vamp: { count: 0, profit: 0 }, joia: { count: 0, profit: 0 }, morto: { count: 0, profit: 0 },
    };
    for (const p of products) { if (p.quadrant) { groups[p.quadrant].count++; groups[p.quadrant].profit += p.contribution ?? 0; } }
    return { totalProfit: total, skusMaking80: count, byQuadrant: groups, classified: withCost.length, costMissing: missing };
  }, [products]);

  const shown = quad ? products.filter((p) => p.quadrant === quad) : products;

  return (
    <div className="abc-results">
      {classified > 0 ? (
        <p className="text-[15px] text-[var(--ink-soft)]">
          <b className="font-bold text-[var(--ink)]">{skusMaking80} SKU{skusMaking80 !== 1 ? "s" : ""}</b>{" "}
          ({Math.round((skusMaking80 / classified) * 100)}% dos classificados) fazem{" "}
          <b className="font-bold text-[var(--ink)]">80% do seu lucro</b> no período.
        </p>
      ) : (
        <p className="text-[15px] text-[var(--ink-soft)]">Nenhum produto com custo cadastrado — cadastre os custos para ver o lucro por produto.</p>
      )}

      {costMissing > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          <span aria-hidden="true">⚠️</span>
          <span><b className="font-semibold">{costMissing} produto{costMissing !== 1 ? "s" : ""} sem custo cadastrado</b> — não entra{costMissing !== 1 ? "m" : ""} no cálculo de lucro até você cadastrar o custo.</span>
          <a href={costsHref} className="font-semibold text-amber-900 underline">Cadastrar custos →</a>
        </div>
      )}

      <div className="abc-quadrant-band">
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
              className={`abc-quad${selected ? " is-selected" : ""}`}
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
              <div className="flex items-center gap-2 text-[13px] font-bold text-[var(--ink)]">
                <span className={`h-2.5 w-2.5 rounded ${q.dot}`} />
                {q.label}
              </div>
              <div className="mt-0.5 text-[12px] text-[var(--ink-muted)]">{q.sub}</div>
              <div className="mt-2 text-[26px] font-extrabold tabular-nums tracking-tight text-[var(--ink)]">
                {g.count}
                <small className="ml-1 text-[13px] font-semibold text-[var(--ink-muted)]">SKUs</small>
              </div>
              <div className="text-xs text-[var(--ink-muted)]">{share.toFixed(0)}% do lucro</div>
              <div className="mt-2 border-t border-dashed border-[var(--line-strong)] pt-2 text-xs text-[var(--ink-muted)]">{q.act}</div>
            </button>
          );
        })}
      </div>

      <div className="abc-detail-stack">
        <section className="abc-pareto-panel">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] px-5 py-4">
            <div>
              <h2 className="text-[15px] font-bold text-[var(--ink)]">Concentração do lucro (Pareto)</h2>
              <p className="mt-0.5 text-[12.5px] text-[var(--ink-muted)]">Cada barra é um produto (do mais ao menos lucrativo); a linha é o lucro acumulado.</p>
            </div>
            <div className="flex flex-wrap gap-3.5 text-[11.5px] text-[var(--ink-muted)]">
              <span><i className="mr-1 inline-block h-[11px] w-[11px] rounded-sm align-[-1px]" style={{ background: "var(--positive)" }} />Classe A (80%)</span>
              <span><i className="mr-1 inline-block h-[11px] w-[11px] rounded-sm align-[-1px]" style={{ background: "#f59e0b" }} />Classe B (+15%)</span>
              <span><i className="mr-1 inline-block h-[11px] w-[11px] rounded-sm align-[-1px]" style={{ background: "#94a3b8" }} />Classe C (5%)</span>
            </div>
          </div>
          <div className="px-5 py-4"><Pareto products={products} /></div>
        </section>

        <section className="listing-table-shell abc-products-panel">
          <div className="border-b border-[var(--line)] px-5 py-4">
            <h2 className="text-[15px] font-bold text-[var(--ink)]">
              {quad ? `Produtos · ${QUAD[quad].label}` : `Produtos (${products.length})`}
            </h2>
            <p className="mt-0.5 text-[12.5px] text-[var(--ink-muted)]">Classe A/B/C pela contribuição acumulada. Clique num quadrante para filtrar.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="listing-table abc-table">
              <thead>
                <tr className="[&_th]:border-b [&_th]:border-[var(--line-strong)] [&_th]:bg-[var(--ink-03)] [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-[12px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-[var(--ink-muted)]">
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
                  const q = p.quadrant ? QUAD[p.quadrant] : null;
                  const clsColor = p.profitClass === "A" ? "bg-emerald-50 text-emerald-700" : p.profitClass === "B" ? "bg-amber-50 text-amber-700" : "bg-[var(--ink-05)] text-[var(--ink-muted)]";
                  const neg = p.contribution != null && p.contribution < 0;
                  return (
                    <tr key={p.sku || p.productId} className="[&_td]:border-b [&_td]:border-[var(--line)] [&_td]:px-3 [&_td]:py-2.5 [&_td]:tabular-nums hover:bg-[var(--ink-03)]">
                      <td className="!text-left">
                        <div className="flex max-w-[240px] flex-col">
                          <strong className="truncate text-[13px] font-semibold" title={p.title}>{p.title}</strong>
                          <small className="font-mono text-[12px] text-[var(--ink-muted)]">{p.sku || p.productId}{!p.costMissing && !p.complete && " · parcial"}</small>
                        </div>
                      </td>
                      <td className="text-right">{p.units}</td>
                      <td className="text-right">{money(p.revenue, currency)}</td>
                      <td className={`text-right font-bold ${p.contribution == null ? "text-[var(--ink-faint)]" : neg ? "text-red-600" : "text-emerald-700"}`}>{p.contribution == null ? "—" : money(p.contribution, currency)}</td>
                      <td className={`text-right ${p.marginPct == null ? "text-[var(--ink-faint)]" : p.marginPct < 0 ? "font-bold text-red-600" : p.marginPct < 12 ? "text-red-600" : p.marginPct < 18 ? "text-amber-600" : "font-semibold text-emerald-700"}`}>{p.marginPct == null ? "—" : `${p.marginPct.toFixed(1)}%`}</td>
                      <td className="text-center">
                        {p.profitClass == null
                          ? <span className="text-[var(--ink-faint)]">—</span>
                          : <span className={`inline-grid h-[22px] w-[22px] place-items-center rounded-md text-[12px] font-extrabold ${clsColor}`}>{p.profitClass}</span>}
                      </td>
                      <td className="!text-left">
                        {q ? (
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-bold ${q.tag}`}>
                            <span className={`h-1.5 w-1.5 rounded-sm ${q.dot}`} />{q.label}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[12px] font-bold text-amber-700">Sem custo</span>
                        )}
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
        <p className="flex gap-2 px-1 text-xs text-[var(--ink-muted)]">
          <span aria-hidden="true">ℹ️</span>
          <span>Ainda sincronizando o período — alguns produtos podem aparecer como &quot;parcial&quot; até a conciliação terminar.</span>
        </p>
      )}
    </div>
  );
}

function Pareto({ products }: { products: AbcProduct[] }) {
  const pos = products.filter((p): p is AbcProduct & { contribution: number } => p.contribution != null && p.contribution > 0);
  if (pos.length < 2) return <p className="py-8 text-center text-sm text-[var(--ink-muted)]">{pos.length === 0 ? "Sem produtos com custo cadastrado para calcular o lucro." : "Só 1 produto com custo cadastrado — cadastre o custo de mais produtos para a curva de Pareto fazer sentido."}</p>;
  const W = 1000, H = 190, padL = 6, padR = 6, padT = 12, padB = 8;
  const n = pos.length;
  const gap = (W - padL - padR) / n;
  const bw = Math.min(gap * 0.72, 88);
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
