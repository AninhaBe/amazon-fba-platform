"use client";

import { useEffect, useState } from "react";
import { chaveDeAvisoSincronizada, mesesDeHistorico } from "@/lib/coberturaPeriodo";

/**
 * Aviso de conclusão do backfill (frente K): "Sua loja está 100% sincronizada —
 * histórico de N meses completo." Derivado só do estado do sync — aparece
 * quando o backfill fechou (`status === "complete"`) e há cobertura de ponta a
 * ponta; nenhum dado novo é gravado no servidor.
 *
 * O dismiss vive em localStorage, com chave por conexão + meses cobertos:
 * aprofundar o alvo de histórico (ex.: 60 dias → 12 meses) muda a chave e o
 * aviso reaparece com o número novo.
 *
 * ⚠️ Limitação aceita (decisão de 27/08/2026): o dismiss NÃO acompanha a
 * pessoa entre dispositivos nem entre navegadores — persisti-lo no servidor
 * exigiria um lugar comum aos 4 canais, e a conta Amazon não tem linha em
 * workspace_integrations para pendurar metadata. localStorage nivela os quatro.
 */
export function SincronizacaoCompleta({ connectionId, status, coveredFrom, coveredTo }: {
  connectionId: string;
  status: string | null | undefined;
  coveredFrom: string | null | undefined;
  coveredTo: string | null | undefined;
}) {
  const meses = mesesDeHistorico(coveredFrom, coveredTo);
  const chave = meses == null ? null : chaveDeAvisoSincronizada(connectionId, meses);
  // Nasce oculto para não piscar antes de o localStorage responder (e para o
  // servidor e o cliente renderizarem o mesmo HTML na hidratação).
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    if (status !== "complete" || !chave) return;
    // localStorage é fonte externa: a leitura sai do corpo do efeito via
    // microtask, mesmo padrão do DashboardPeriodFilter.
    queueMicrotask(() => {
      try {
        setVisivel(window.localStorage.getItem(chave) !== "1");
      } catch {
        // Sem localStorage (modo privado restrito): mostra sem lembrar o dismiss.
        setVisivel(true);
      }
    });
  }, [chave, status]);

  if (status !== "complete" || meses == null || !chave || !visivel) return null;

  const dispensar = () => {
    try {
      window.localStorage.setItem(chave, "1");
    } catch {
      // Sem persistência disponível, o dismiss vale só para esta visita.
    }
    setVisivel(false);
  };

  return (
    <div role="status" className="integration-message">
      Sua loja está 100% sincronizada — histórico de {meses} {meses === 1 ? "mês" : "meses"} completo.{" "}
      <button
        type="button"
        onClick={dispensar}
        className="font-semibold text-sky-700 underline-offset-2 hover:underline"
      >
        Entendi
      </button>
    </div>
  );
}
