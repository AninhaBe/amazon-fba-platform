"use client";

import { useEffect, useRef, useState } from "react";

// Rola o número do valor exibido até o novo em ~550ms (ease-out). Na primeira
// aparição parte de zero; em troca de período, parte do valor anterior — o
// movimento comunica "mesmo indicador, novo recorte". Sob
// prefers-reduced-motion o valor final aparece de imediato.

const DURATION_MS = 550;

function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

export function AnimatedNumber({ value, format }: { value: number; format: (value: number) => string }) {
  const [displayed, setDisplayed] = useState(0);
  const displayedRef = useRef(0);
  const frameRef = useRef(0);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = displayedRef.current;
    if (reduceMotion || from === value) {
      displayedRef.current = value;
      setDisplayed(value);
      return;
    }
    const startedAt = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / DURATION_MS);
      const current = from + (value - from) * easeOutCubic(progress);
      displayedRef.current = current;
      setDisplayed(current);
      if (progress < 1) frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value]);

  return <>{format(displayed)}</>;
}
