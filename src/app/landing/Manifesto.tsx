"use client";

import { useEffect, useState } from "react";

/**
 * O manifesto com as três frases rotativas — seção 4 do dub
 * (`docs/landing-nexo.md` → "Manifesto").
 *
 * Eles trocam o texto dentro do parágrafo. Aqui a frase não pode trocar: as três
 * juntas *são* a conta ("o que cobrou" + "o que pagou" + "quando cai"), e trocar
 * uma quebraria a promessa da frase. Então o que rotaciona é a ênfase — acende
 * uma por vez e as outras recuam para o cinza. Mesmo efeito de atenção, sem
 * mentir sobre o que o produto junta.
 */

const FRASES = [
  "o que o marketplace cobrou",
  "o que o comprador pagou",
  "quando o dinheiro cai",
];

const TROCA_MS = 2400;

export function Manifesto() {
  // -1 = todas acesas: é o estado servido e o estado de quem pediu menos movimento.
  const [aceso, setAceso] = useState(-1);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // O primeiro tique já leva -1 → 0. A página abre com as três acesas e a
    // rotação começa depois — o que também evita mexer no estado durante o
    // efeito, que dispara render em cascata.
    const intervalo = setInterval(
      () => setAceso((i) => (i + 1) % FRASES.length),
      TROCA_MS,
    );
    return () => clearInterval(intervalo);
  }, []);

  return (
    <section className="lp-manifesto">
      <h2>
        Não é sobre quanto você vendeu.
        <br />
        <strong>É sobre quanto sobrou.</strong>
      </h2>
      <p>
        Ele junta{" "}
        {FRASES.map((frase, i) => (
          <span key={frase}>
            <em className={aceso === -1 || aceso === i ? "is-aceso" : ""}>{frase}</em>
            {i === 0 ? ", " : i === 1 ? " e " : " "}
          </span>
        ))}
        — numa conta só.
      </p>
      <p className="lp-manifesto-fecho">
        Porque relatório que arredonda para zero não é relatório. É palpite bonito —
        e funcionário que chuta número não dura uma semana.
      </p>
    </section>
  );
}
