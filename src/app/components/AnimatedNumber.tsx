"use client";

import { useEffect, useRef, useState } from "react";

// Rola o número do valor exibido até o novo em ~550ms (ease-out). Na primeira
// aparição mostra o valor real de imediato (sem contar do zero — em valores
// altos a contagem parecia bug); anima quando o valor muda (troca de período).
// Sob prefers-reduced-motion o valor final aparece de imediato.
//
// `id` (opcional) guarda o último valor exibido por instância num escopo de
// módulo. Ao trocar de período um skeleton pisca e o componente desmonta/remonta;
// sem essa memória ele reaparecia já no valor final (animava só a partir do 2º
// clique, quando o período vinha do cache e não havia skeleton). Com o `id`, ao
// remontar ele parte do valor anterior e anima em todas as trocas — sem precisar
// manter conteúdo pesado montado durante o loading.

const DURATION_MS = 550;
const lastValueById = new Map<string, number>();

function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

export function AnimatedNumber({ id, value, format }: { id?: string; value: number; format: (value: number) => string }) {
  const seed = id !== undefined && lastValueById.has(id) ? lastValueById.get(id)! : value;
  const [displayed, setDisplayed] = useState(seed);
  const displayedRef = useRef(seed);
  const frameRef = useRef(0);

  useEffect(() => {
    const remember = (current: number) => {
      if (id !== undefined) lastValueById.set(id, current);
    };
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = displayedRef.current;
    if (reduceMotion || from === value) {
      displayedRef.current = value;
      remember(value);
      setDisplayed(value);
      return;
    }
    const startedAt = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / DURATION_MS);
      const current = from + (value - from) * easeOutCubic(progress);
      displayedRef.current = current;
      remember(current);
      setDisplayed(current);
      if (progress < 1) frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value, id]);

  return <>{format(displayed)}</>;
}
