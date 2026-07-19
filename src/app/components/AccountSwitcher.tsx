"use client";

import { useEffect, useState } from "react";

interface Acct {
  sellerId: string;
  name?: string;
  marketplace?: string;
  connectedAt: string;
}
interface AccountInfo {
  active: string | null;
  hasOwnerToken: boolean;
  accounts: Acct[];
}

/** Nome exibível: apelido do usuário > marketplace > seller id. */
function labelOf(a: Acct): string {
  return a.name || a.marketplace || a.sellerId;
}

export function AccountSwitcher() {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/auth/accounts");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao carregar contas.");
      setInfo(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar contas.");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function switchTo(sellerId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao trocar de conta.");
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao trocar de conta.");
      setBusy(false);
    }
  }

  async function saveName(sellerId: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerId, name: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao renomear conta.");
      setEditing(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao renomear conta.");
    } finally {
      setSaving(false);
    }
  }

  if (!info) return null;

  const activeAccount = info.active
    ? info.accounts.find((a) => a.sellerId === info.active) ?? null
    : null;
  const activeLabel = activeAccount
    ? labelOf(activeAccount)
    : info.hasOwnerToken
      ? "Minha conta"
      : "Nenhuma conta";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4">
            <circle cx="12" cy="8" r="3.2" />
            <path d="M5 20a7 7 0 0 1 14 0" strokeLinecap="round" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Conta ativa
          </p>
          {editing && activeAccount ? (
            <div className="mt-1 flex items-center gap-1">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName(activeAccount.sellerId);
                  if (e.key === "Escape") setEditing(false);
                }}
                placeholder="Apelido da conta"
                className="w-full rounded-md border border-slate-300 px-2 py-0.5 text-sm focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={() => saveName(activeAccount.sellerId)}
                disabled={saving}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
              >
                ok
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-semibold text-slate-700" title={activeLabel}>
                {activeLabel}
              </p>
              {activeAccount && (
                <button
                  onClick={() => {
                    setDraft(activeAccount.name ?? activeAccount.marketplace ?? "");
                    setEditing(true);
                  }}
                  title="Renomear conta"
                  className="text-slate-400 hover:text-blue-600"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
                    <path d="M12 20h9" strokeLinecap="round" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </div>
          )}
          {activeAccount && !editing && (
            <p className="truncate font-mono text-[10px] text-slate-400" title={activeAccount.sellerId}>
              {activeAccount.sellerId}
            </p>
          )}
        </div>
      </div>

      {(info.accounts.length > 0 || info.hasOwnerToken) && (
        <select
          value={info.active ?? ""}
          onChange={(e) => switchTo(e.target.value)}
          disabled={busy}
          aria-label="Trocar conta Amazon ativa"
          className="w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:border-slate-300"
        >
          {info.hasOwnerToken && <option value="">Minha conta (.env)</option>}
          {info.accounts.map((a) => (
            <option key={a.sellerId} value={a.sellerId}>
              {labelOf(a)}
            </option>
          ))}
        </select>
      )}

      <a
        href="/api/auth/login"
        className="flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 px-3 py-2 text-center text-xs font-semibold text-white shadow-sm shadow-blue-600/25 hover:from-blue-600 hover:to-blue-700"
      >
        <span className="text-sm leading-none">+</span> Conectar conta Amazon
      </a>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
