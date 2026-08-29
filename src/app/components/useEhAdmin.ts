"use client";

import { useEffect, useState } from "react";

import { buscaCompartilhada } from "./buscaCompartilhada";

// `true` só depois que o SERVIDOR confirmar. Enquanto não confirma, é `false` —
// então o link nunca pisca para quem não deveria vê-lo.
//
// ⚠️ Isto NÃO protege nada: é conveniência de navegação. Quem protege é o
// `comAdmin` nas rotas de dados. Ver docs/adr/ADR-024-tela-de-administracao.md.

/** Resultado guardado no módulo: uma consulta por carga de página, não por tela.
 *
 * ⚠️ Isto sozinho não bastava. Ele só cobre a montagem que vem DEPOIS da
 * resposta; a que monta enquanto a primeira ainda está no ar não encontra
 * resultado nenhum e pergunta de novo — foi o que a medição de 28/08/2026
 * pegou (21ms e 1205ms, com a resposta chegando aos 2648ms). Quem cobre a
 * montagem simultânea é a `buscaCompartilhada`. */
let respostaConhecida: boolean | null = null;

export function useEhAdmin(): boolean {
  const [admin, setAdmin] = useState(respostaConhecida ?? false);

  useEffect(() => {
    if (respostaConhecida !== null) return;
    let vivo = true;
    buscaCompartilhada("admin/eu", () => fetch("/api/admin/eu").then((r) => r.ok))
      .catch(() => false)
      .then((ok) => {
        respostaConhecida = ok;
        if (vivo && ok) setAdmin(true);
      });
    return () => { vivo = false; };
  }, []);

  return admin;
}
