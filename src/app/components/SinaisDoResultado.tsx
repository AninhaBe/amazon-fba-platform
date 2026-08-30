"use client";

import Link from "next/link";
import type { SinalDoResultado } from "./oQueFaltaNoResultado";

/**
 * O SINAL QUE ANDA COLADO NO NUMERO.
 *
 * Um componente so para os quatro canais, de proposito: a garantia "o numero
 * nunca aparece sozinho" so vale se houver UM lugar que a cumpra. Quatro copias
 * viram tres copias certas e uma esquecida — foi assim que a decisao de 25/08
 * sobre anuncio chegou ao card da Amazon e nao ao painel.
 *
 * `acao` leva link e cor de atencao: ha o que ela fazer. `progresso` e neutro e
 * sem link: alarme para o que ela nao pode resolver vira ruido, e link para o
 * que nao tem destino e mentira.
 */
export function SinaisDoResultado({ sinais }: { sinais: SinalDoResultado[] }) {
  if (sinais.length === 0) return null;
  return (
    <span className="resultado-sinais" data-sinais={sinais.length}>
      {sinais.map((sinal) => (
        <span key={sinal.chave} className={`resultado-sinal resultado-sinal--${sinal.tom}`}>
          <span aria-hidden="true" className="resultado-sinal-marca">
            {sinal.tom === "acao" ? "⚠" : "◷"}
          </span>
          {sinal.href ? (
            <Link href={sinal.href} className="meli-financial-link">
              {sinal.texto} — cadastrar <span aria-hidden="true">→</span>
            </Link>
          ) : (
            sinal.texto
          )}
        </span>
      ))}
    </span>
  );
}
