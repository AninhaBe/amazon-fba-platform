"use client";

import { useEffect, useState } from "react";

// `true` só depois que o SERVIDOR confirmar. Enquanto não confirma, é `false` —
// então o link nunca pisca para quem não deveria vê-lo.
//
// ⚠️ Isto NÃO protege nada: é conveniência de navegação. Quem protege é o
// `comAdmin` nas rotas de dados. Ver docs/adr/ADR-024-tela-de-administracao.md.

/** Resultado guardado no módulo: uma consulta por carga de página, não por tela. */
let respostaConhecida: boolean | null = null;

export function useEhAdmin(): boolean {
  const [admin, setAdmin] = useState(respostaConhecida ?? false);

  useEffect(() => {
    if (respostaConhecida !== null) return;
    let vivo = true;
    fetch("/api/admin/eu")
      .then((r) => r.ok)
      .catch(() => false)
      .then((ok) => {
        respostaConhecida = ok;
        if (vivo && ok) setAdmin(true);
      });
    return () => { vivo = false; };
  }, []);

  return admin;
}
