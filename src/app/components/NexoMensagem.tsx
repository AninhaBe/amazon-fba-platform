"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

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
  carregando = false,
}: {
  texto?: string;
  ctaHref?: string;
  ctaLabel?: string;
  /** Mostra "NEXO analisando…" com shimmer enquanto o modelo escreve. */
  carregando?: boolean;
}) {
  const paragrafos = (texto ?? "").split(/\n+/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="nexo-mensagem">
      {/* Seta da marca inline, preenchida em branco puro (currentColor herda a
          cor do avatar). Sem contorno — é o contorno + invert que criava aquele
          quadrado quando o símbolo padrão ia para o círculo escuro. */}
      <span className="nexo-mensagem-avatar" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path
            d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"
            fill="currentColor"
          />
        </svg>
      </span>
      <div className="nexo-mensagem-fala">
        <span className="nexo-mensagem-nome">NEXO</span>
        {carregando && !paragrafos.length ? (
          <div className="nexo-mensagem-carregando" aria-live="polite">
            <span className="nexo-mensagem-shimmer" style={{ width: "88%" }} />
            <span className="nexo-mensagem-shimmer" style={{ width: "70%" }} />
            <span className="sr-only">NEXO está lendo a operação…</span>
          </div>
        ) : (
          paragrafos.map((p, i) => <p key={i}>{p}</p>)
        )}
        {ctaHref && !carregando && (
          <Link href={ctaHref} className="nexo-mensagem-cta">
            {ctaLabel} <ArrowRight className="briefing-acao-seta" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}
