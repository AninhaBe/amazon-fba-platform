"use client";

import { useEffect, useState } from "react";
import { chaveDeAvisoSincronizada } from "@/lib/coberturaPeriodo";
import { brDate } from "@/lib/datetime";

/**
 * Aviso de conclusão da primeira importação: "Sua loja está 100% sincronizada —
 * histórico desde DD/MM completo." Derivado só do estado do sync — aparece
 * quando o backfill fechou (`status === "complete"`) e há cobertura registrada;
 * nenhum dado novo é gravado no servidor.
 *
 * O dismiss vive em localStorage, com uma chave por conexão.
 *
 * ⚠️ Limitação aceita (decisão de 27/08/2026): o dismiss NÃO acompanha a
 * pessoa entre dispositivos nem entre navegadores — persisti-lo no servidor
 * exigiria um lugar comum aos 4 canais, e a conta Amazon não tem linha em
 * workspace_integrations para pendurar metadata. localStorage nivela os quatro.
 */
export function SincronizacaoCompleta({ connectionId, status, coveredFrom }: {
  connectionId: string;
  status: string | null | undefined;
  coveredFrom: string | null | undefined;
}) {
  const chave = chaveDeAvisoSincronizada(connectionId);
  // Nasce oculto para não piscar antes de o localStorage responder (e para o
  // servidor e o cliente renderizarem o mesmo HTML na hidratação).
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    if (status !== "complete" || !coveredFrom) return;
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
  }, [chave, coveredFrom, status]);

  // Some sozinho depois de 12s. Isto aqui e COMEMORACAO de um evento que
  // acabou de acontecer, nao um estado permanente da tela — e estava ocupando
  // uma faixa de largura total no topo dos quatro dashboards ate alguem clicar
  // em "Dispensar". Quem clicar continua nao vendo nunca mais (o dismiss em
  // localStorage segue igual); quem nao clicar deixa de carregar a faixa para
  // sempre. Nada e removido: o aviso aparece e da tempo de ler.
  useEffect(() => {
    if (!visivel) return;
    const relogio = setTimeout(() => setVisivel(false), 12_000);
    return () => clearTimeout(relogio);
  }, [visivel]);

  if (status !== "complete" || !coveredFrom || !visivel) return null;

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
      Sua loja está 100% sincronizada — histórico desde {brDate(new Date(coveredFrom))} completo.{" "}
      <button
        type="button"
        onClick={dispensar}
        className="font-semibold text-[var(--acao)] underline-offset-2 hover:underline"
      >
        Entendi
      </button>
    </div>
  );
}
