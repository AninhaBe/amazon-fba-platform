"use client";

import { useState } from "react";
import { signOut } from "../login/actions";

/**
 * Sair com RELOAD real do navegador — não uma navegação SPA. É o reload que zera
 * os caches de módulo do cliente (centralCache, dashCache, monitorCache…), que de
 * outro modo sobreviveriam ao logout e pintariam os dados da conta anterior na
 * próxima conta. Ver o vazamento entre contas de 22/08/2026 e src/app/login/actions.ts.
 */
export function LogoutButton({ compact = false }: { compact?: boolean }) {
  const [saindo, setSaindo] = useState(false);

  async function sair() {
    setSaindo(true);
    try {
      await signOut();
    } finally {
      // Hard navigation: descarta todo o estado de módulo do app.
      window.location.href = "/login";
    }
  }

  return (
    <div className={compact ? "logout-form is-compact" : "logout-form"}>
      <button type="button" onClick={sair} disabled={saindo} title="Sair do NEXO" aria-label="Sair do NEXO">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M14 8l4 4-4 4M9 12h9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {!compact && <span>{saindo ? "Saindo…" : "Sair"}</span>}
      </button>
    </div>
  );
}
