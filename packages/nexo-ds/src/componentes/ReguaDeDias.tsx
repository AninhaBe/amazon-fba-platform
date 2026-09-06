import type { CSSProperties } from "react";

/**
 * REGUA DE DIAS — o lucro dia a dia, ao lado do numero de hoje.
 *
 * ⚠️ DIA DESCONHECIDO NAO VIRA COLUNA NO CHAO, e numa serie temporal isso e
 * mais perigoso que numa tela estatica: zero num grafico nao parece ausencia,
 * parece NOTICIA RUIM — uma queda que nao aconteceu. O contrato do produtor
 * distingue os dois na origem (`0` = nao vendeu, e fato; `null` = vendeu e o
 * custo ou a tarifa ainda nao chegaram), e aqui o `null` aparece como ausencia
 * de coluna com um traco no lugar do valor.
 *
 * ⚠️ ESTA PECA NAO FORMATA DINHEIRO NEM DECIDE O QUE E "HOJE" — as duas coisas
 * dependem de moeda e de fuso, que sao de quem monta a tela. E a altura sai como
 * FRACAO; o "vezes 100" mora no CSS, que e onde geometria pertence.
 */
export interface DiaDaRegua {
  /** Chave estavel; no app e a data ISO. */
  id: string;
  /** "qui", "hoje" — quem chama decide, porque so ele sabe que dia e hoje. */
  rotulo: string;
  /** So para a proporcao e o tom. `null` nao desenha coluna. */
  valor: number | null;
  /** O rotulo curto em cima da coluna ("540", "0", "—"). */
  compacto: string;
  /** O valor por extenso, para leitor de tela. */
  completo: string;
  destaque: boolean;
}

export function ReguaDeDias({ titulo, dias }: { titulo: string; dias: DiaDaRegua[] }) {
  if (dias.length === 0) return null;
  // A escala sai do maior valor CONHECIDO: um dia desconhecido nao pode
  // encolher os outros — ele nao tem tamanho.
  const maior = Math.max(...dias.map((dia) => (dia.valor == null ? 0 : Math.abs(dia.valor))), 0);

  return (
    <section className="lucro-por-dia" aria-label={titulo}>
      <p className="cockpit-kicker is-menor">{titulo}</p>
      <ol className="lucro-colunas">
        {dias.map((dia) => {
          const fracao = maior > 0 && dia.valor != null ? Math.abs(dia.valor) / maior : 0;
          const negativo = dia.valor != null && dia.valor < 0;
          return (
            <li
              key={dia.id}
              className={`lucro-coluna${dia.destaque ? " is-destaque" : ""}${dia.valor == null ? " is-desconhecido" : ""}${negativo ? " is-negativo" : ""}`}
              aria-label={dia.completo}
            >
              <span className="lucro-valor" aria-hidden="true">{dia.compacto}</span>
              <span className="lucro-barra" style={{ "--fracao": fracao } as CSSProperties} aria-hidden="true" />
              <span className="lucro-dia" aria-hidden="true">{dia.rotulo}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
