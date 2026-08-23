"use client";

import { useEffect, useState } from "react";
import { NexoMensagem } from "../components/NexoMensagem";

const DEMO_MESSAGE = `Tem três coisas que eu olharia hoje.

O Mercado Livre perdeu 62% do faturamento nesta semana. A causa está nos anúncios: 11 dos 14 estão inativos.

Na Amazon as vendas cresceram 9%, mas o produto que responde por 37% da receita fica sem estoque em 6 dias.

A Shopee vendeu mais, e mesmo assim a margem caiu.`;

const ANALYSIS_MS = 400;
const WRITING_MS = 900;

export function NexoDemoMessage() {
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");

  useEffect(() => {
    let frame = 0;
    let typingStartedAt = 0;
    const loadingTimer = window.setTimeout(() => {
      setLoading(false);
      const write = (now: number) => {
        if (!typingStartedAt) typingStartedAt = now;
        const progress = Math.min((now - typingStartedAt) / WRITING_MS, 1);
        const visibleCharacters = Math.max(1, Math.ceil(DEMO_MESSAGE.length * progress));
        setText(DEMO_MESSAGE.slice(0, visibleCharacters));
        if (progress < 1) frame = window.requestAnimationFrame(write);
      };
      frame = window.requestAnimationFrame(write);
    }, ANALYSIS_MS);

    return () => {
      window.clearTimeout(loadingTimer);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      <div className="landing-v2-motion-message">
        <NexoMensagem texto={text} carregando={loading} />
      </div>
      <div className="landing-v2-reduced-message">
        <NexoMensagem texto={DEMO_MESSAGE} />
      </div>
    </>
  );
}
