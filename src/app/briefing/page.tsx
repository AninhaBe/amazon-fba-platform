"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader, pageIcons } from "../components/PageHeader";
import { PanelLoading } from "../components/LoadingState";
import { EmptyState } from "../components/EmptyState";
import { readJson } from "../../lib/readJson";

interface Insight {
  id: string;
  type: string;
  provider: string;
  entityRef?: string;
  severity: number;
  title: string;
  evidence: Record<string, unknown>;
  impact: Record<string, unknown>;
  recommendation?: string;
  actionHref?: string;
}

const CHANNEL: Record<string, string> = { amazon: "Amazon", mercado_livre: "Mercado Livre" };
const TYPE_LABEL: Record<string, string> = { ruptura: "Ruptura de estoque", velocidade: "Queda de vendas", margem: "Margem apertada" };
const EVIDENCE_LABEL: Record<string, string> = {
  disponivel: "Disponível",
  aCaminho: "A caminho",
  vendasPorDia: "Vendas/dia",
  diasRestantes: "Dias restantes",
  vendidosNoPeriodo: "Vendidos (30d)",
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function severityStripe(sev: number) {
  return sev >= 90 ? "bg-red-500" : sev >= 70 ? "bg-amber-500" : "bg-slate-300";
}

export default function BriefingPage() {
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/briefing");
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Não foi possível montar o briefing.");
      setInsights(data.insights);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
      setInsights([]);
    }
  }

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, []);

  async function act(id: string, action: "dispensar" | "adiar" | "resolver") {
    setBusy(id);
    try {
      const res = await fetch("/api/briefing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, snoozeDays: 3 }),
      });
      const data = await readJson(res);
      if (res.ok) setInsights(data.insights);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="briefing-page space-y-6">
      <PageHeader
        eyebrow="Seller Intelligence"
        title="Briefing"
        icon={pageIcons.chart}
        subtitle="As poucas coisas da sua operação que merecem atenção hoje — com evidência, impacto e o próximo passo."
      />

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>{error}</p>
          <button type="button" onClick={() => void load()} className="mt-3 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white">
            Tentar novamente
          </button>
        </div>
      )}

      {insights == null ? (
        <PanelLoading label="Analisando sua operação" />
      ) : insights.length === 0 ? (
        <EmptyState title="Tudo sob controle" description="Nenhuma prioridade exige sua atenção agora. Voltamos amanhã com o próximo briefing." />
      ) : (
        <>
          <p className="text-lg font-semibold text-slate-900">
            {greeting()}. Hoje há <span className="text-blue-600">{insights.length}</span>{" "}
            {insights.length === 1 ? "coisa" : "coisas"} que {insights.length === 1 ? "merece" : "merecem"} sua atenção.
          </p>

          <ul className="space-y-3">
            {insights.map((it) => {
              const impactUnits = it.impact?.unidadesEmRiscoEstimadas as number | undefined;
              const premissa = it.impact?.premissa as string | undefined;
              return (
                <li key={it.id} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <span className={`absolute inset-y-0 left-0 w-1 ${severityStripe(it.severity)}`} aria-hidden="true" />
                  <div className="space-y-3 p-5 pl-6">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{TYPE_LABEL[it.type] || it.type}</span>
                      <span className="text-slate-400">{CHANNEL[it.provider] || it.provider}</span>
                    </div>

                    <h2 className="text-[15px] font-semibold text-slate-900">{it.title}</h2>

                    {it.recommendation && <p className="text-sm text-slate-600">{it.recommendation}</p>}

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      {Object.entries(it.evidence).map(([k, v]) => (
                        <span key={k}>
                          <span className="text-slate-400">{EVIDENCE_LABEL[k] || k}:</span>{" "}
                          <strong className="font-semibold tabular-nums text-slate-700">{v == null ? "—" : String(v)}</strong>
                        </span>
                      ))}
                    </div>

                    {impactUnits != null && (
                      <p className="text-xs text-amber-700">
                        Impacto estimado: ≈ <strong className="tabular-nums">{impactUnits}</strong> unidade(s) em risco
                        {premissa ? <span className="text-amber-600/80"> · {premissa}</span> : null}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                      {it.actionHref ? (
                        <Link href={it.actionHref} className="text-xs font-semibold text-blue-600 hover:text-blue-700">
                          Ver e agir →
                        </Link>
                      ) : <span />}
                      <div className="flex items-center gap-1.5">
                        <button type="button" disabled={busy === it.id} onClick={() => void act(it.id, "adiar")} className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50">
                          Adiar 3d
                        </button>
                        <button type="button" disabled={busy === it.id} onClick={() => void act(it.id, "dispensar")} className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50">
                          Dispensar
                        </button>
                        <button type="button" disabled={busy === it.id} onClick={() => void act(it.id, "resolver")} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                          Resolver
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="text-xs text-slate-400">
            Protótipo (v1): por enquanto só o detector de <strong>ruptura</strong> (Amazon), calculado sob demanda.
            Velocidade e margem, e a execução no cron diário, vêm em seguida. Sinais de <em>demanda/risco</em>, não de lucro.
          </p>
        </>
      )}
    </div>
  );
}
