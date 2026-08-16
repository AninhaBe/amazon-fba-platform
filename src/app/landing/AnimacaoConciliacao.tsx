"use client";

import { useEffect, useState } from "react";

/**
 * Conciliação financeira — a cascata se montando linha a linha.
 *
 * Fiel à tela real do NEXO (print de 16/08/2026): calha de sinais à esquerda
 * (`−`, `=`), dedução em vermelho, subtotal com fundo cinza, resultado em verde.
 * Os números são os do painel dela naquele momento.
 *
 * Técnica de loop do midday (`time-tracking-calendar-animation.tsx`): estado com
 * quantas linhas estão visíveis, `setTimeout` escalonado, e `setInterval` que
 * reinicia — é o reinício que faz parecer vídeo.
 *
 * Cada funcionalidade tem a SUA animação, como no dub: aqui a conta se forma
 * de cima para baixo, terminando no lucro. O movimento conta a história do
 * produto — "a gente mostra de onde saiu cada centavo" — em vez de decorar.
 */

type Linha = {
  sinal?: "menos" | "igual";
  rotulo: string;
  valor: string;
  tipo?: "deducao" | "subtotal" | "detalhe" | "resultado" | "margem";
};

const LINHAS: Linha[] = [
  { rotulo: "Faturamento (preço de tabela)", valor: "R$ 108,34" },
  { sinal: "menos", rotulo: "Cupons e promoções", valor: "R$ 6,63", tipo: "deducao" },
  { sinal: "igual", rotulo: "Faturamento líquido", valor: "R$ 101,71", tipo: "subtotal" },
  { sinal: "menos", rotulo: "Taxas Amazon", valor: "R$ 6,12", tipo: "deducao" },
  { rotulo: "Anúncios", valor: "R$ 6,12", tipo: "detalhe" },
  { sinal: "menos", rotulo: "Custo dos produtos", valor: "R$ 34,10", tipo: "deducao" },
  { sinal: "igual", rotulo: "Lucro estimado", valor: "R$ 61,49", tipo: "resultado" },
  { rotulo: "Margem", valor: "60,5%", tipo: "margem" },
];

const CICLO_MS = 8500;
const PASSO_MS = 260;

export function AnimacaoConciliacao() {
  const [visiveis, setVisiveis] = useState(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const rodar = () => {
      setVisiveis(0);
      LINHAS.forEach((_, i) => {
        timers.push(setTimeout(() => setVisiveis((n) => Math.max(n, i + 1)), i * PASSO_MS + 500));
      });
    };
    rodar();
    const intervalo = setInterval(rodar, CICLO_MS);
    return () => {
      clearInterval(intervalo);
      for (const t of timers) clearTimeout(t);
    };
  }, []);

  return (
    <div className="lp-cascata" aria-hidden="true">
      <p className="lp-cascata-kicker">Financeiro conciliado</p>
      <h3>Repasses, taxas e lucro</h3>
      <p className="lp-cascata-nota">
        Base dos repasses da Amazon (data de postagem) — difere do faturamento acima, que
        segue a data do pedido como o Seller Central.
      </p>
      <div className="lp-cascata-linhas">
        {LINHAS.map((linha, i) => (
          <div
            key={linha.rotulo}
            className={`${linha.tipo ? `is-${linha.tipo} ` : ""}${i < visiveis ? "is-visivel" : ""}`}
          >
            <span className="lp-cascata-sinal">
              {linha.sinal === "menos" ? "−" : linha.sinal === "igual" ? "=" : ""}
            </span>
            <span className="lp-cascata-rotulo">{linha.rotulo}</span>
            <strong>{linha.valor}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
