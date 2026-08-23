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
  aoTentarDeNovo,
}: {
  texto?: string;
  ctaHref?: string;
  ctaLabel?: string;
  /** Mostra "NEXO analisando…" com shimmer enquanto o modelo escreve. */
  carregando?: boolean;
  /**
   * Quando informado E não há texto nem carregamento, o bloco assume o estado de
   * FALHA em vez de sumir da tela.
   *
   * O sumiço era o comportamento antigo: a tela renderizava `null` quando a
   * narração vinha vazia, então o NEXO aparecia "lendo sua operação" e depois
   * simplesmente não estava mais lá (23/08/2026). Some sem explicação é pior que
   * erro: a pessoa não sabe se deu errado, se acabou, ou se ela fez algo.
   */
  aoTentarDeNovo?: () => void;
}) {
  const paragrafos = (texto ?? "").split(/\n+/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="nexo-mensagem">
      {/* Robôzinho do NEXO (G3): cabeça com antena, um olho é a seta da marca e o
          outro é um ponto. currentColor herda a cor do avatar (branco no círculo
          escuro). A antena pisca de leve e o robô flutua devagar — ver globals.css. */}
      <span className="nexo-mensagem-avatar" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="nexo-bot">
          <rect x="4" y="6.5" width="16" height="13" rx="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M12 3.6v2.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle className="nexo-bot-antena" cx="12" cy="2.9" r="1.1" fill="currentColor" />
          <g transform="translate(6 9.4) scale(0.34)">
            <path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" fill="currentColor" />
          </g>
          <circle cx="15.2" cy="12.4" r="1.3" fill="currentColor" />
        </svg>
      </span>
      <div className="nexo-mensagem-fala">
        <span className="nexo-mensagem-nome">NEXO</span>
        {carregando && !paragrafos.length ? (
          // O texto precisa ser VISÍVEL. Antes ele estava em `sr-only` — só o
          // leitor de tela ouvia "NEXO está lendo", e quem olhava via duas barras
          // cinzas sem explicação nenhuma (apontado em 22/08/2026).
          <div className="nexo-mensagem-carregando" aria-live="polite">
            <p className="nexo-mensagem-lendo">
              Lendo sua operação<span className="nexo-mensagem-pontos" aria-hidden="true" />
            </p>
            <span className="nexo-mensagem-shimmer" style={{ width: "72%" }} />
          </div>
        ) : !paragrafos.length && aoTentarDeNovo ? (
          // FALHA — o bloco fica, e diz o que houve. Ver `aoTentarDeNovo` acima.
          <div className="nexo-mensagem-falha" aria-live="polite">
            <p>Não consegui montar a leitura de hoje. Os números abaixo estão certos e não dependem de mim.</p>
            <button type="button" className="nexo-mensagem-retry" onClick={aoTentarDeNovo}>
              Tentar de novo
            </button>
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
