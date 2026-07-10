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
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
          Conta ativa
        </p>
        <p className="truncate text-sm font-medium text-slate-700" title={activeLabel}>
          {activeLabel}
        </p>
      </div>

      {(info.accounts.length > 0 || info.hasOwnerToken) && (
        <select
          value={info.active ?? ""}
          onChange={(e) => switchTo(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
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
        className="block rounded-lg bg-orange-600 px-3 py-2 text-center text-xs font-semibold text-white hover:bg-orange-700"
      >
        + Conectar conta Amazon
      </a>
    </div>
  );
}
