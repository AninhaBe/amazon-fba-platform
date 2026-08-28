"use client";

import { useEffect, useRef, useState } from "react";

// Rola o número do valor exibido até o novo em ~550ms (ease-out). Na primeira
// aparição mostra o valor real de imediato (sem contar do zero — em valores
// altos a contagem parecia bug); anima quando o valor muda (troca de período).
// Sob prefers-reduced-motion o valor final aparece de imediato.
//
// `id` (opcional) guarda o último valor exibido por instância num escopo de
// módulo. Ao trocar de período um skeleton pisca e o componente desmonta/remonta;
// sem essa memória ele reaparecia já no valor final. Com o `id`, ao remontar ele
// parte do valor anterior — sem precisar manter conteúdo pesado montado durante
// o loading.
//
// ⚠️ `periodo`: TROCA DE PERÍODO NÃO ANIMA.
//
// Medido em produção em 28/08/2026: no caminho com cache (sem skeleton), o
// primeiro quadro depois do clique mostrava o valor do período ANTERIOR sob o
// rótulo do período NOVO — a Ana mandou print com R$ 325,91 de "hoje" embaixo
// de "7 dias". A contagem de 550ms não era lentidão: era a tela afirmando um
// número que não é daquele período.
//
// A animação continua onde ela é honesta: quando o MESMO período recebe valor
// novo (revalidação, dado chegando), contar comunica "isto mudou". Quando o
// período muda, o valor aparece direto.
//
// A identidade vem por PROP, não por heurística: adivinhar "mudou muito, deve
// ser outro período" erraria nos dois sentidos — dois períodos com o mesmo
// total não animariam, e uma venda grande no mesmo período pareceria troca.

const DURATION_MS = 550;
const lastValueById = new Map<string, { valor: number; periodo: string | undefined }>();

function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

export function AnimatedNumber({ id, value, format, periodo }: {
  id?: string;
  value: number;
  format: (value: number) => string;
  /**
   * Identidade do período a que este valor pertence (`period.query` das telas).
   * Mudou = período outro = pinta direto, sem contar a partir do número alheio.
   */
  periodo?: string;
}) {
  const lembrado = id !== undefined ? lastValueById.get(id) : undefined;
  // Semente só vale se for comprovadamente do MESMO período. Sem `periodo`, o
  // componente NÃO herda valor entre montagens — o padrão é o seguro: quem não
  // declara o período nunca anima a partir do número de outro. Dentro de uma
  // mesma montagem a animação segue normal (é o caso honesto: mesmo período,
  // valor novo chegando).
  const seed = periodo !== undefined && lembrado?.periodo === periodo ? lembrado.valor : value;
  const [displayed, setDisplayed] = useState(seed);
  const displayedRef = useRef(seed);
  const periodoRef = useRef(periodo);
  const frameRef = useRef(0);

  useEffect(() => {
    const remember = (current: number) => {
      if (id !== undefined) lastValueById.set(id, { valor: current, periodo });
    };
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const trocouDePeriodo = periodoRef.current !== periodo;
    periodoRef.current = periodo;
    const from = displayedRef.current;
    if (reduceMotion || trocouDePeriodo || from === value) {
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
  }, [value, id, periodo]);

  return <>{format(displayed)}</>;
}
