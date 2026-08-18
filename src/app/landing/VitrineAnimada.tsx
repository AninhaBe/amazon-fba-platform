"use client";

import { useEffect, useState } from "react";

/**
 * A tela do NEXO se montando em loop — a técnica é a do midday
 * (`time-tracking-calendar-animation.tsx`): estado com os itens visíveis,
 * `setTimeout` escalonado por índice, e um `setInterval` que REINICIA tudo. É o
 * reinício que faz parecer vídeo em vez de "carregou uma vez e parou".
 *
 *   calendarEvents.forEach((e, i) => setTimeout(..., i * 150 + 300));
 *   setInterval(animateEvents, 8000);
 *
 * O cursor percorrendo a tela vem do dub.co. Aqui ele vai até o filtro de
 * período, "clica", e o painel se remonta — mostrando o produto sendo usado, não
 * um print parado.
 *
 * Sem dependência nova: o midday usa `motion/react`, que não está no projeto.
 * Estado + transição CSS entrega o mesmo resultado.
 *
 * Devolve só a JANELA. A moldura, a legenda e a troca de abas são de
 * `Vitrine.tsx` — cada aba tem a sua tela e a sua animação, como no dub.
 */

const CICLO_MS = 9000;
const PASSO_MS = 130;

const CARDS: Array<[string, string, string]> = [
  ["Faturamento", "R$ 39,80", "2 de 5 conciliadas"],
  ["Taxas", "R$ 6,12", "Total do período"],
  ["Comissão", "R$ 0,00", "Não cobrada"],
  ["Logística FBA", "R$ 0,00", "Não cobrada"],
  ["Anúncios", "R$ 6,12", "Total do período"],
  ["Custo", "R$ 13,64", "Total do período"],
  ["Impostos", "—", "Configure a alíquota"],
  ["Estornos", "R$ 0,00", "Nenhum no período"],
  ["Lucro", "R$ 20,04", "50,4% margem"],
];

const BARRAS = [12, 28, 18, 44, 36, 62, 48, 74, 58, 88, 70, 96];
const LIBERACOES: Array<[string, string]> = [["18/08", "R$ 19,90"], ["24/08", "R$ 19,90"]];

/** Onde o cursor pousa em cada etapa, em % da janela. */
const ROTA = [
  { x: 82, y: 12, clica: false },
  { x: 82, y: 12, clica: true },
  { x: 40, y: 44, clica: false },
  { x: 78, y: 76, clica: false },
];

export function PainelCanal() {
  const [visiveis, setVisiveis] = useState(0);
  const [etapa, setEtapa] = useState(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const rodar = () => {
      // Reinício: é o que transforma "carregou" em "está acontecendo".
      setVisiveis(0);
      setEtapa(0);
      CARDS.forEach((_, i) => {
        timers.push(setTimeout(() => setVisiveis((n) => Math.max(n, i + 1)), i * PASSO_MS + 400));
      });
      ROTA.forEach((_, i) => {
        timers.push(setTimeout(() => setEtapa(i), i * 1500 + 900));
      });
    };
    rodar();
    const intervalo = setInterval(rodar, CICLO_MS);
    return () => {
      clearInterval(intervalo);
      for (const t of timers) clearTimeout(t);
    };
  }, []);

  const alvo = ROTA[etapa] ?? ROTA[0];

  return (
    <div className="lp-app" aria-hidden="true">
        <aside className="lp-app-nav">
          <span className="lp-app-marca">N</span>
          {["Central", "Amazon", "Mercado Livre", "Shopee", "TikTok"].map((canal, i) => (
            <span key={canal} className={i === 1 ? "is-ativo" : ""}>{canal}</span>
          ))}
        </aside>

        <div className="lp-app-corpo">
          <div className="lp-app-topo">
            <strong>Visão do canal</strong>
            <span className={`lp-app-periodo${alvo.clica ? " is-clicado" : ""}`}>30 dias</span>
          </div>

          <div className="lp-app-cards">
            {CARDS.map(([rotulo, valor, nota], i) => (
              <div
                key={rotulo}
                className={`${i === 8 ? "is-lucro " : ""}${i < visiveis ? "is-visivel" : ""}`}
              >
                <small>{rotulo}</small>
                <strong>{valor}</strong>
                <em>{nota}</em>
              </div>
            ))}
          </div>

          <div className="lp-app-baixo">
            <div className="lp-app-grafico">
              <div className="lp-app-grafico-topo">
                <span>Evolução das vendas</span>
                <strong>R$ 108,34</strong>
              </div>
              <div className="lp-barras">
                {BARRAS.map((h, i) => (
                  <span
                    key={i}
                    className={visiveis > 0 ? "is-visivel" : ""}
                    style={{ height: `${h}%`, transitionDelay: `${i * 45 + 500}ms` }}
                  />
                ))}
              </div>
              <p className="lp-app-split">
                <b>2 confirmados</b> · R$ 39,80 &nbsp;|&nbsp; <i>3 aguardando</i> · R$ 66,33
              </p>
            </div>

            <div className="lp-app-saldo">
              <span>Saldo na Amazon</span>
              <div className="is-cobranca"><small>Disponível</small><strong>− R$ 6,12</strong></div>
              <ul>
                {LIBERACOES.map(([dia, valor], i) => (
                  <li key={dia} className={visiveis > 5 + i ? "is-visivel" : ""}>
                    <span>{dia}</span><strong>{valor}</strong>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

      {/* Cursor percorrendo a tela — a ideia é do dub.co. */}
      <span
        className={`lp-cursor${alvo.clica ? " is-clicando" : ""}`}
        style={{ left: `${alvo.x}%`, top: `${alvo.y}%` }}
      />
    </div>
  );
}
