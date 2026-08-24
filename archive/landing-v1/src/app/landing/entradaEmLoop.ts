"use client";

import { useEffect, useState } from "react";

/**
 * Técnica de animação do midday (`time-tracking-calendar-animation.tsx`),
 * extraída porque já serve três telas da landing: escalona `total` itens por
 * índice e **reinicia** o ciclo — é o reinício que faz parecer vídeo em vez de
 * "carregou uma vez e parou".
 *
 * `prefers-reduced-motion` não é tratado aqui de propósito: quem usa este hook
 * esconde os itens por CSS, e a CSS já força `opacity: 1` nesse modo. O loop
 * pode rodar à vontade que nada se mexe.
 */
export function useEntradaEmLoop(total: number, passo: number, ciclo: number, atraso = 450) {
  const [visiveis, setVisiveis] = useState(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const rodar = () => {
      setVisiveis(0);
      for (let i = 0; i < total; i += 1) {
        timers.push(setTimeout(() => setVisiveis((n) => Math.max(n, i + 1)), i * passo + atraso));
      }
    };
    rodar();
    const intervalo = setInterval(rodar, ciclo);
    return () => {
      clearInterval(intervalo);
      for (const t of timers) clearTimeout(t);
    };
  }, [total, passo, ciclo, atraso]);

  return visiveis;
}
