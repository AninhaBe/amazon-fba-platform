"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, GripVertical, Settings2 } from "lucide-react";
import { readJson } from "@/lib/readJson";

// Painel personalizado (ADR-005). Recebe os KPIs já prontos como widgets com ID
// estável; o usuário liga/desliga e reordena, e a preferência é salva por
// workspace+view. Sem preferência salva = ordem/visibilidade padrão (a que vem
// nos `widgets`), então nada quebra para quem nunca personalizou.

export interface MetricWidget {
  id: string;
  label: string;
  node: React.ReactNode;
}

interface StoredLayout {
  order: string[];
  hidden: string[];
}

// Ordem efetiva = ordem salva (só IDs ainda existentes) + widgets novos que ainda
// não estavam na preferência (entram no fim, visíveis). Assim um KPI novo aparece
// para todo mundo sem precisar limpar a preferência de ninguém.
function effectiveOrder(saved: string[], allIds: string[]): string[] {
  const known = saved.filter((id) => allIds.includes(id));
  const missing = allIds.filter((id) => !known.includes(id));
  return [...known, ...missing];
}

export function CustomizableMetricGrid({
  viewKey,
  widgets,
  gridClassName = "metric-grid grid grid-cols-1 gap-0 sm:grid-cols-2 lg:grid-cols-4",
  ariaLabel,
}: {
  viewKey: string;
  widgets: MetricWidget[];
  gridClassName?: string;
  ariaLabel?: string;
}) {
  const allIds = useMemo(() => widgets.map((w) => w.id), [widgets]);
  const byId = useMemo(() => new Map(widgets.map((w) => [w.id, w])), [widgets]);

  const [order, setOrder] = useState<string[]>(allIds);
  const [hidden, setHidden] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [draftOrder, setDraftOrder] = useState<string[]>(allIds);
  const [draftHidden, setDraftHidden] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/dashboard-layout?view=${encodeURIComponent(viewKey)}`)
      .then((res) => readJson(res).then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!active || !ok) return;
        const saved = data.layout as StoredLayout | null;
        if (saved) {
          setOrder(effectiveOrder(saved.order ?? [], allIds));
          setHidden((saved.hidden ?? []).filter((id: string) => allIds.includes(id)));
        }
      })
      .catch(() => {
        /* sem preferência salva → mantém o default */
      });
    return () => {
      active = false;
    };
  }, [viewKey, allIds]);

  const visibleOrder = effectiveOrder(order, allIds).filter((id) => !hidden.includes(id));

  function startEdit() {
    setDraftOrder(effectiveOrder(order, allIds));
    setDraftHidden(new Set(hidden));
    setError(null);
    setEditing(true);
  }

  function toggleHidden(id: string) {
    setDraftHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onDrop(targetId: string) {
    const from = dragId.current;
    dragId.current = null;
    if (!from || from === targetId) return;
    setDraftOrder((prev) => {
      const next = prev.filter((id) => id !== from);
      const at = next.indexOf(targetId);
      next.splice(at, 0, from);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    const nextOrder = draftOrder;
    const nextHidden = [...draftHidden];
    try {
      const res = await fetch(`/api/dashboard-layout?view=${encodeURIComponent(viewKey)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: nextOrder, hidden: nextHidden }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Não foi possível salvar.");
      setOrder(nextOrder);
      setHidden(nextHidden);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    const rows = draftOrder;
    const visibleCount = rows.filter((id) => !draftHidden.has(id)).length;
    return (
      <div className="rounded-2xl border border-[var(--line-strong)] bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-[var(--ink)]">Personalizar indicadores</p>
            <p className="text-xs text-[var(--ink-muted)]">Arraste para reordenar · clique no olho para ocultar</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-50">
              Cancelar
            </button>
            <button type="button" onClick={save} disabled={saving || visibleCount === 0} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
        <ul className="space-y-1.5">
          {rows.map((id) => {
            const widget = byId.get(id);
            if (!widget) return null;
            const isHidden = draftHidden.has(id);
            return (
              <li
                key={id}
                draggable
                onDragStart={() => (dragId.current = id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(id)}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${isHidden ? "border-[var(--line-strong)] bg-[var(--ink-03)] opacity-60" : "border-[var(--line-strong)] bg-white"}`}
              >
                <span className="cursor-grab text-[var(--ink-faint)]" aria-hidden="true"><GripVertical className="h-4 w-4" /></span>
                <span className="flex-1 truncate text-sm font-medium text-[var(--ink-soft)]">{widget.label}</span>
                <button
                  type="button"
                  onClick={() => toggleHidden(id)}
                  aria-pressed={!isHidden}
                  aria-label={isHidden ? `Mostrar ${widget.label}` : `Ocultar ${widget.label}`}
                  className={`icon-hit-area ${isHidden ? "text-[var(--ink-muted)] hover:text-[var(--ink-soft)]" : "text-blue-600 hover:text-blue-700"}`}
                >
                  {isHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </li>
            );
          })}
        </ul>
        {visibleCount === 0 && <p className="mt-2 text-xs text-amber-600">Deixe pelo menos um indicador visível.</p>}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={startEdit}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:bg-[var(--ink-05)] hover:text-[var(--ink-soft)]"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Personalizar
        </button>
      </div>
      <section className={gridClassName} aria-label={ariaLabel}>
        {visibleOrder.map((id) => {
          const widget = byId.get(id);
          return widget ? <Fragment key={id}>{widget.node}</Fragment> : null;
        })}
      </section>
    </div>
  );
}
