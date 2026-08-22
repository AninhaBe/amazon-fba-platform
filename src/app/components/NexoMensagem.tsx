"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { NexoSymbol } from "./NexoSymbol";

/**
 * A voz do NEXO na tela — uma mensagem, como se fosse uma pessoa falando: avatar
 * da marca, nome e a fala, em tom neutro. É a MESMA peça em todo lugar onde o
 * NEXO se dirige à pessoa (resumo do canal, visão geral, briefing), para a
 * identidade nunca divergir de uma tela para outra.
 *
 * Aceita texto de um ou vários parágrafos (o briefing vem com hífens em linhas
 * separadas). O CTA é opcional: no resumo ele leva ao briefing; no próprio
 * briefing não há para onde mandar.
 */
export function NexoMensagem({
  texto,
  ctaHref,
  ctaLabel = "Ver briefing",
}: {
  texto: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  const paragrafos = texto.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="nexo-mensagem">
      <span className="nexo-mensagem-avatar" aria-hidden="true">
        <NexoSymbol size={22} />
      </span>
      <div className="nexo-mensagem-fala">
        <span className="nexo-mensagem-nome">NEXO</span>
        {paragrafos.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        {ctaHref && (
          <Link href={ctaHref} className="nexo-mensagem-cta">
            {ctaLabel} <ArrowRight className="briefing-acao-seta" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}
