"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Contadores subindo de 0 ao entrar na viewport — o "Built to scale" do dub,
 * listado como pendente em `docs/landing-nexo.md` → "Efeitos".
 *
 * Aqui número é promessa (`AGENTS.md`), então o efeito nunca pode produzir um
 * número falso. Três consequências no código:
 *
 * — **O zero nunca aparece na tela.** O estado inicial é o valor final; a
 *   contagem só zera quando o observador dispara, e ele dispara com a seção
 *   ainda fora da tela (`MARGEM_PX`). Sem JS, com `prefers-reduced-motion`, ou
 *   com a seção já visível no carregamento, o valor final fica parado.
 * — **Número pequeno não anima.** "4 canais" passaria 1,2s dos 1,5s exibindo
 *   "0", que nesta base significa "não tem nenhum". Só sobe quem é grande o
 *   bastante para a contagem significar alguma coisa.
 * — **Leitor de tela ouve o valor final**, não a contagem em curso.
 */

const DURACAO_MS = 1500;
/** Quanto antes de entrar na tela a contagem começa — o zero fica fora da vista. */
const MARGEM_PX = 300;
/** Abaixo disso a contagem é ruído: o número aparece pronto. */
const MINIMO_ANIMAVEL = 1000;

/** "70.479" → 70479. `null` quando não é número — aí o texto vai cru. */
function paraNumero(valor: string): number | null {
  const limpo = valor.replace(/\./g, "").trim();
  return /^\d+$/.test(limpo) ? Number(limpo) : null;
}

function animavel(valor: string): number | null {
  const numero = paraNumero(valor);
  return numero !== null && numero >= MINIMO_ANIMAVEL ? numero : null;
}

export function Contadores({
  itens,
}: {
  itens: ReadonlyArray<{ valor: string; rotulo: string }>;
}) {
  const ref = useRef<HTMLElement>(null);
  // Começa em 1 = valor final. Só zera quando dá para animar fora da vista.
  const [progresso, setProgresso] = useState(1);
  const algumAnima = itens.some((item) => animavel(item.valor) !== null);

  useEffect(() => {
    const secao = ref.current;
    if (!secao || !algumAnima) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Já visível no carregamento: zerar agora daria um salto para trás.
    if (secao.getBoundingClientRect().top <= window.innerHeight + MARGEM_PX) return;

    let quadro = 0;
    let inicio = 0;
    const animar = (agora: number) => {
      if (!inicio) inicio = agora;
      const t = Math.min((agora - inicio) / DURACAO_MS, 1);
      setProgresso(1 - (1 - t) ** 4); // sobe rápido e freia no fim
      if (t < 1) quadro = requestAnimationFrame(animar);
    };

    const observador = new IntersectionObserver(
      (entradas) => {
        if (!entradas[0]?.isIntersecting) return;
        observador.disconnect(); // sobe uma vez só, não a cada scroll
        // Scroll rápido (roda em bloco, tecla End, arrastar a barra) pula a
        // margem e o gatilho chega com a seção já na tela — aí zerar mostraria
        // o zero. Nesse caso a animação simplesmente não acontece: perder o
        // efeito é barato, exibir "0 pedidos conciliados" não é.
        if (secao.getBoundingClientRect().top <= window.innerHeight) return;
        setProgresso(0);
        quadro = requestAnimationFrame(animar);
      },
      { rootMargin: `0px 0px ${MARGEM_PX}px 0px` },
    );
    observador.observe(secao);

    return () => {
      observador.disconnect();
      cancelAnimationFrame(quadro);
    };
  }, [algumAnima]);

  return (
    <section ref={ref} className="lp-contadores" aria-label="Números da plataforma">
      {itens.map(({ valor, rotulo }) => {
        const numero = animavel(valor);
        const exibido =
          numero === null ? valor : Math.round(numero * progresso).toLocaleString("pt-BR");
        return (
          <div key={rotulo}>
            <strong>
              <span aria-hidden="true">{exibido}</span>
              <span className="sr-only">{valor}</span>
            </strong>
            <span>{rotulo}</span>
          </div>
        );
      })}
    </section>
  );
}
