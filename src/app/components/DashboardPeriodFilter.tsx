"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowRight, CalendarRange } from "lucide-react";

export type DashboardPeriodOption = "today" | "7" | "15" | "30" | "custom";

export function useDashboardPeriod(initialQuery = "", onQueryChange?: (query: string) => void) {
  const initial = new URLSearchParams(initialQuery);
  const hasCustomPeriod = Boolean(initial.get("from") && initial.get("to"));
  const [selected, setSelected] = useState<DashboardPeriodOption>(hasCustomPeriod ? "custom" : "30");
  const [query, setQuery] = useState(hasCustomPeriod ? new URLSearchParams({ from: initial.get("from")!, to: initial.get("to")! }).toString() : "days=30");
  const [from, setFrom] = useState(hasCustomPeriod ? initial.get("from")! : "");
  const [to, setTo] = useState(hasCustomPeriod ? initial.get("to")! : "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // URL is an external source of truth; navigation (including popstate) must replace the draft.
    const current = new URLSearchParams(initialQuery);
    const nextFrom = current.get("from") ?? "";
    const nextTo = current.get("to") ?? "";
    if (nextFrom && nextTo) {
      queueMicrotask(() => { setSelected("custom"); setFrom(nextFrom); setTo(nextTo); setQuery(new URLSearchParams({ from: nextFrom, to: nextTo }).toString()); setError(null); }); return;
    }
    const days = current.get("days");
    if (days === "today" || days === "7" || days === "15" || days === "30") {
      queueMicrotask(() => { setSelected(days); setFrom(""); setTo(""); setQuery(`days=${days}`); setError(null); });
    }
  }, [initialQuery]);

  function selectPreset(value: Exclude<DashboardPeriodOption, "custom">) {
    setSelected(value);
    setError(null);
    setQuery(`days=${value}`);
    onQueryChange?.(`days=${value}`);
  }

  function selectCustom() {
    setSelected("custom");
    setError(null);
  }

  function applyCustom() {
    if (!from || !to) {
      setError("Selecione a data inicial e a data final.");
      return;
    }
    const initialDate = new Date(`${from}T00:00:00`);
    const finalDate = new Date(`${to}T00:00:00`);
    if (initialDate > finalDate) {
      setError("A data inicial precisa ser anterior à data final.");
      return;
    }
    if (finalDate.getTime() - initialDate.getTime() > 365 * 86_400_000) {
      setError("O período pode ter no máximo 365 dias.");
      return;
    }
    setError(null);
    const nextQuery = new URLSearchParams({ from, to }).toString();
    setQuery(nextQuery);
    onQueryChange?.(nextQuery);
  }

  // Rótulo do período em prosa, para entrar em FRASE — "3 vendas hoje", "12
  // vendas nos últimos 7 dias". O filtro já sabia o período ativo, mas só como
  // valor ("7"); sem isto, cada canal remontaria o texto por conta e os quatro
  // escreveriam diferente.
  const label =
    selected === "today" ? "hoje"
      : selected === "custom" ? "no período selecionado"
        : `nos últimos ${selected} dias`;

  return {
    query,
    label,
    filterProps: { selected, from, to, error, onPreset: selectPreset, onCustom: selectCustom, onFrom: setFrom, onTo: setTo, onApply: applyCustom },
  };
}

export function DashboardPeriodFilter({ selected, from, to, error, onPreset, onCustom, onFrom, onTo, onApply, meta }: {
  selected: DashboardPeriodOption;
  from: string;
  to: string;
  error: string | null;
  onPreset: (value: Exclude<DashboardPeriodOption, "custom">) => void;
  onCustom: () => void;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  onApply: () => void;
  meta?: ReactNode;
}) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const options = [{ value: "today", label: "Hoje" }, { value: "7", label: "7 dias" }, { value: "15", label: "15 dias" }, { value: "30", label: "30 dias" }] as const;

  // O filtro é a interação principal do dashboard: fica sticky no desktop e
  // ganha elevação quando "cola" no topo. A sentinela 1px acima dele detecta
  // o momento exato sem escutar scroll.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), { threshold: 0 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return <>
    <div ref={sentinelRef} aria-hidden="true" className="dashboard-period-sentinel" />
    <section className={`dashboard-period-filter${stuck ? " is-stuck" : ""}`} aria-label="Período dos indicadores">
    <div className="dashboard-period-presets" role="group" aria-label="Períodos rápidos">
      {options.map((option) => <button key={option.value} type="button" aria-pressed={selected === option.value} className={selected === option.value ? "is-active" : ""} onClick={() => onPreset(option.value)}>{option.label}</button>)}
      <button type="button" aria-pressed={selected === "custom"} className={selected === "custom" ? "is-active" : ""} onClick={onCustom}>Personalizado</button>
    </div>
    {selected === "custom" && <div className="dashboard-custom-period">
      <div className="dashboard-custom-period-intro">
        <span><CalendarRange aria-hidden="true" /></span>
        <div><strong>Escolha o intervalo</strong><small>Até 365 dias</small></div>
      </div>
      <div className="dashboard-custom-period-fields">
        <label><span>Data inicial</span><input type="date" value={from} max={to || today} onChange={(event) => onFrom(event.target.value)} /></label>
        <ArrowRight aria-hidden="true" />
        <label><span>Data final</span><input type="date" value={to} min={from} max={today} onChange={(event) => onTo(event.target.value)} /></label>
      </div>
      <button type="button" className="dashboard-period-apply" onClick={onApply}>Aplicar período<ArrowRight aria-hidden="true" /></button>
      {error && <p role="alert">{error}</p>}
    </div>}
    {meta && <div className="dashboard-period-meta">{meta}</div>}
    </section>
  </>;
}
