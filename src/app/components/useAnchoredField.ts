"use client";

import { useEffect, useRef } from "react";

/** Leva a âncora ao centro da tela e deixa o campo pronto para digitação. */
export function useAnchoredField(anchor: string, ready = true) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!ready) return;

    const reveal = (force = false) => {
      if (!force && window.location.hash !== `#${anchor}`) return;
      document.getElementById(anchor)?.scrollIntoView({ block: "center" });
      inputRef.current?.focus({ preventScroll: true });
    };

    const revealFromLink = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || new URL(link.href, window.location.href).hash !== `#${anchor}`) return;
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => reveal(true)));
    };
    const revealFromHash = () => reveal();

    reveal();
    window.addEventListener("hashchange", revealFromHash);
    document.addEventListener("click", revealFromLink);
    return () => {
      window.removeEventListener("hashchange", revealFromHash);
      document.removeEventListener("click", revealFromLink);
    };
  }, [anchor, ready]);

  return inputRef;
}
