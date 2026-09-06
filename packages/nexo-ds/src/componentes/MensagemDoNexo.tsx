import type { ReactNode } from "react";

/**
 * MENSAGEM DO NEXO — a voz do modelo na tela.
 *
 * ⚠️ E UM COMPONENTE UNICO, usado igual em todas as abas. A decisao vem de
 * 30/08/2026: quando cada tela desenhava a fala do NEXO do seu jeito, a mesma
 * voz aparecia com tres pesos visuais diferentes e o produto parecia tres
 * produtos. Avatar escuro, seta branca da marca inline, tom neutro.
 *
 * ⚠️ E O TEXTO DE CARREGAMENTO E VISIVEL, nao `sr-only`. Antes so o leitor de
 * tela ouvia "NEXO esta lendo", e quem olhava via duas barras cinzas sem
 * explicacao nenhuma (apontado por ela em 22/08/2026).
 */
export interface MensagemDoNexoProps {
  /** Cada item vira um paragrafo. Vazio + `carregando` mostra o estado de leitura. */
  paragrafos: ReactNode[];
  carregando?: boolean;
  /** Acoes opcionais no rodape da fala (botoes, links). */
  rodape?: ReactNode;
}

export function MensagemDoNexo({ paragrafos, carregando = false, rodape }: MensagemDoNexoProps) {
  return (
    <div className="nexo-mensagem">
      {/* Robozinho do NEXO: cabeca com antena, um olho e a seta da marca e o
          outro e um ponto. `currentColor` herda a cor do avatar. */}
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
        {carregando && paragrafos.length === 0 ? (
          <div className="nexo-mensagem-carregando" aria-live="polite">
            <p className="nexo-mensagem-lendo">
              Lendo sua operação<span className="nexo-mensagem-pontos" aria-hidden="true" />
            </p>
          </div>
        ) : (
          paragrafos.map((paragrafo, indice) => <p key={indice}>{paragrafo}</p>)
        )}
        {rodape}
      </div>
    </div>
  );
}
