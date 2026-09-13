"use client";

import { useEffect, useState } from "react";

import { buscaCompartilhada } from "./buscaCompartilhada";
import { readJson } from "../../lib/readJson";

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

export function AccountSwitcher({ compact = false, appearance = "default" }: { compact?: boolean; appearance?: "default" | "chip" }) {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      // A Amazon pergunta a mesma coisa na mesma abertura (ver `useAmazonPendencias`).
      const res = await buscaCompartilhada("auth/accounts", () => fetch("/api/auth/accounts"));
      const data = await readJson(res);
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
      const data = await readJson(res);
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
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Erro ao renomear conta.");
      setEditing(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao renomear conta.");
    } finally {
      setSaving(false);
    }
  }

  if (!info) {
    return (
      <div role="status" aria-label="Carregando contas" className={`account-loading${appearance === "chip" ? " is-chip" : ""}`} aria-busy="true">
        <span />
        <span />
      </div>
    );
  }

  const activeAccount = info.active
    ? info.accounts.find((a) => a.sellerId === info.active) ?? null
    : null;
  const activeLabel = activeAccount
    ? labelOf(activeAccount)
    : info.hasOwnerToken
      ? "Minha conta"
      : "Nenhuma conta";

  if (appearance === "chip") {
    const podeTrocar = info.accounts.length > 0 || info.hasOwnerToken;
    return (
      <div className="amazon-account-chip-wrap">
        {editing && activeAccount ? (
          <div className="amazon-account-chip-edit">
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveName(activeAccount.sellerId);
                if (event.key === "Escape") setEditing(false);
              }}
              placeholder="Apelido da conta"
              aria-label="Apelido da conta Amazon"
            />
            <button type="button" onClick={() => void saveName(activeAccount.sellerId)} disabled={saving}>Salvar</button>
            <button type="button" onClick={() => setEditing(false)}>Cancelar</button>
          </div>
        ) : (
          <>
            <label className="meli-account-chip amazon-account-chip" title={podeTrocar ? "Trocar conta Amazon" : activeLabel}>
              <i />
              <span>{activeLabel}</span>
              <small>{activeAccount?.marketplace || "Amazon BR"}</small>
              {podeTrocar && (
                <select
                  value={info.active ?? ""}
                  onChange={(event) => void switchTo(event.target.value)}
                  disabled={busy}
                  aria-label="Trocar conta Amazon ativa"
                >
                  {info.hasOwnerToken && <option value="">Conta principal</option>}
                  {info.accounts.map((account) => <option key={account.sellerId} value={account.sellerId}>{labelOf(account)}</option>)}
                </select>
              )}
            </label>
            {activeAccount && (
              <button
                type="button"
                className="amazon-account-chip-rename"
                onClick={() => { setDraft(activeAccount.name ?? activeAccount.marketplace ?? ""); setEditing(true); }}
                aria-label="Renomear conta Amazon"
                title="Renomear conta"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M12 20h9" strokeLinecap="round" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" strokeLinejoin="round" /></svg>
              </button>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    );
  }

  if (compact) {
    return (
      <div className="account-switcher-compact">
        {editing && activeAccount ? (
          <div className="account-switcher-edit">
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveName(activeAccount.sellerId);
                if (event.key === "Escape") setEditing(false);
              }}
              placeholder="Apelido da conta"
              aria-label="Apelido da conta Amazon"
            />
            <button type="button" onClick={() => void saveName(activeAccount.sellerId)} disabled={saving}>
              Salvar
            </button>
          </div>
        ) : (
          <div className="account-switcher-row">
            <select
              value={info.active ?? ""}
              onChange={(event) => void switchTo(event.target.value)}
              disabled={busy}
              aria-label="Trocar conta Amazon ativa"
              title={activeLabel}
            >
              {info.hasOwnerToken && <option value="">Conta principal</option>}
              {info.accounts.map((account) => (
                <option key={account.sellerId} value={account.sellerId}>
                  {labelOf(account)}
                </option>
              ))}
            </select>
            {activeAccount && (
              <button
                type="button"
                className="account-switcher-rename"
                onClick={() => {
                  setDraft(activeAccount.name ?? activeAccount.marketplace ?? "");
                  setEditing(true);
                }}
                title="Renomear conta"
                aria-label="Renomear conta"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M12 20h9" strokeLinecap="round" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5 rounded-xl border border-[var(--line-strong)]/80 bg-[var(--ink-03)]/80 px-3 py-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[var(--ink-muted)] shadow-sm ring-1 ring-[var(--line-strong)]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4">
            <circle cx="12" cy="8" r="3.2" />
            <path d="M5 20a7 7 0 0 1 14 0" strokeLinecap="round" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
            Conta Amazon ativa
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
                className="w-full rounded-md border border-[var(--line-strong)] px-2 py-0.5 text-sm focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={() => saveName(activeAccount.sellerId)}
                disabled={saving}
                aria-label="Salvar nome da conta"
                className="text-xs font-semibold text-[var(--acao)] hover:opacity-80 disabled:opacity-50"
              >
                ok
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-semibold text-[var(--ink-soft)]" title={activeLabel}>
                {activeLabel}
              </p>
              {activeAccount && (
                <button
                  onClick={() => {
                    setDraft(activeAccount.name ?? activeAccount.marketplace ?? "");
                    setEditing(true);
                  }}
                  title="Renomear conta"
                  aria-label="Renomear conta"
                  className="icon-hit-area text-[var(--ink-muted)] hover:text-[var(--acao)]"
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
            <p className="truncate font-mono text-[12px] text-[var(--ink-muted)]" title={activeAccount.sellerId}>
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
          className="w-full cursor-pointer rounded-lg border border-[var(--line-strong)] bg-white px-2.5 py-1.5 text-xs text-[var(--ink-soft)] hover:border-[var(--line-strong)]"
        >
          {info.hasOwnerToken && <option value="">Conta principal</option>}
          {info.accounts.map((a) => (
            <option key={a.sellerId} value={a.sellerId}>
              {labelOf(a)}
            </option>
          ))}
        </select>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
