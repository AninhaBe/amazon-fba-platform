"use client";

import { useEffect, useState } from "react";

interface AccountInfo {
  active: string | null;
  hasOwnerToken: boolean;
  accounts: { sellerId: string; name?: string; connectedAt: string }[];
}

export function AccountSwitcher() {
  const [info, setInfo] = useState<AccountInfo | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/auth/accounts");
      setInfo(await res.json());
    } catch {
      /* silencioso */
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function switchTo(sellerId: string) {
    await fetch("/api/auth/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sellerId }),
    });
    window.location.reload();
  }

  if (!info) return null;

  const activeLabel = info.active
    ? info.accounts.find((a) => a.sellerId === info.active)?.name || info.active
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
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Conta ativa
          </p>
          <p className="truncate text-sm font-semibold text-slate-700" title={activeLabel}>
            {activeLabel}
          </p>
        </div>
      </div>

      {(info.accounts.length > 0 || info.hasOwnerToken) && (
        <select
          value={info.active ?? ""}
          onChange={(e) => switchTo(e.target.value)}
          className="w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:border-slate-300"
        >
          {info.hasOwnerToken && <option value="">Minha conta (.env)</option>}
          {info.accounts.map((a) => (
            <option key={a.sellerId} value={a.sellerId}>
              {a.name || a.sellerId}
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
    </div>
  );
}
