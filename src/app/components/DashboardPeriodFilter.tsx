"use client";

import { useState } from "react";

export type DashboardPeriodOption = "today" | "7" | "15" | "30" | "custom";

export function useDashboardPeriod() {
  const [selected, setSelected] = useState<DashboardPeriodOption>("30");
  const [query, setQuery] = useState("days=30");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  function selectPreset(value: Exclude<DashboardPeriodOption, "custom">) {
    setSelected(value);
    setError(null);
    setQuery(`days=${value}`);
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
    setQuery(new URLSearchParams({ from, to }).toString());
  }

  return {
    query,
    filterProps: { selected, from, to, error, onPreset: selectPreset, onCustom: selectCustom, onFrom: setFrom, onTo: setTo, onApply: applyCustom },
  };
}

export function DashboardPeriodFilter({ selected, from, to, error, onPreset, onCustom, onFrom, onTo, onApply }: {
  selected: DashboardPeriodOption;
  from: string;
  to: string;
  error: string | null;
  onPreset: (value: Exclude<DashboardPeriodOption, "custom">) => void;
  onCustom: () => void;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  onApply: () => void;
}) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const options = [{ value: "today", label: "Hoje" }, { value: "7", label: "7 dias" }, { value: "15", label: "15 dias" }, { value: "30", label: "30 dias" }] as const;

  return <section className="dashboard-period-filter" aria-label="Período dos indicadores">
    <div className="dashboard-period-presets" role="group" aria-label="Períodos rápidos">
      {options.map((option) => <button key={option.value} type="button" aria-pressed={selected === option.value} className={selected === option.value ? "is-active" : ""} onClick={() => onPreset(option.value)}>{option.label}</button>)}
      <button type="button" aria-pressed={selected === "custom"} className={selected === "custom" ? "is-active" : ""} onClick={onCustom}>Personalizado</button>
    </div>
    {selected === "custom" && <div className="dashboard-custom-period">
      <label>De<input type="date" value={from} max={to || today} onChange={(event) => onFrom(event.target.value)} /></label>
      <span aria-hidden="true">→</span>
      <label>Até<input type="date" value={to} min={from} max={today} onChange={(event) => onTo(event.target.value)} /></label>
      <button type="button" className="dashboard-period-apply" onClick={onApply}>Aplicar período</button>
      {error && <p role="alert">{error}</p>}
    </div>}
  </section>;
}
