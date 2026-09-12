"use client";

import type { ReactNode } from "react";

import { AnimatedNumber } from "./AnimatedNumber";

/**
 * A faixa do período — as colunas que abrem o caminho do dinheiro, mais a
 * margem no fim.
 *
 * ⚠️ NASCEU DENTRO DO `PainelV3` E SAIU DE LA EM 12/09/2026,
 * quando a Amazon entrou no mesmo padrao. A ordem da dona do produto foi *"usar
 * o Meli de base"*: a Amazon usa a MESMA peca, com as colunas dela — e nao uma
 * copia, que divergiria no primeiro ajuste e faria o mesmo bloco dizer coisas
 * diferentes em dois canais.
 *
 * ⚠️ A EXTRACAO NAO MUDOU UMA LINHA DE COMPORTAMENTO, de
 * proposito: o JSX veio verbatim, so trocando `dados.X` por prop. Refatoracao
 * que "aproveita para melhorar" e a receita do regresso invisivel — o que
 * aparecesse de melhorar no caminho ficou anotado, nao feito.
 *
 * ⚠️ E O NUMERO DE COLUNAS NAO E DA PECA: o ML manda sete
 * (vendeu, tarifa, frete, custo, imposto, lucro + margem) e a Amazon manda oito
 * (com anuncio, porque la o Ads entra no lucro). Quem decide e o canal; a peca
 * so desenha o que recebe.
 */
export interface ColunaDoPeriodo {
  id: string;
  rotulo: string;
  /** Já formatado. Travessão quando desconhecido — nunca "R$ 0,00". */
  valor: string;
  share: string;
  /** `positivo` pinta o valor de verde; `negativo`, de vermelho; `vazio`, de cinza. */
  tom?: "normal" | "positivo" | "negativo" | "vazio";
  dica?: string;
  /**
   * O valor CRU, quando conhecido — é ele que faz o número rolar até o novo em
   * vez de trocar de uma vez.
   *
   * ⚠️ ORDEM DELA EM 12/09/2026: *"importante, manter o efeito de
   * troca de numero que tinha na versao anterior"*. O v3 tinha deixado o efeito
   * cair na faixa: as colunas recebiam texto pronto, e texto não conta.
   * Devolver é correção, não redesenho — e vale para todo canal que usar a
   * peça, porque a peça é uma só.
   *
   * Sem `bruto` (ou sem `formatar`) o texto fica estático, que é o certo para
   * coluna que não é número: travessão, "alíquota não configurada", etc.
   */
  bruto?: number | null;
  /** Como o bruto vira texto. Sem isto o efeito não liga — não há o que rolar. */
  formatar?: (valor: number) => string;
}

/**
 * ⚠️ `nota: string`, E NAO `ReactNode`, porque era assim que
 * estava. Alargar o tipo numa extracao e mudanca de comportamento disfarcada de
 * arrumacao: passaria a aceitar JSX aqui sem ninguem ter decidido isso.
 */
export interface MargemDoPeriodo {
  valor: string;
  tom: "positivo" | "negativo" | "vazio";
  nota: string;
}

export function FaixaDoPeriodoV3({
  periodoLabel,
  resumoApuracao,
  hrefResultado,
  colunas,
  margem,
  notaDoImposto,
  identidadeDoPeriodo,
}: {
  periodoLabel: string;
  resumoApuracao: ReactNode;
  hrefResultado: string;
  colunas: ColunaDoPeriodo[];
  margem: MargemDoPeriodo;
  notaDoImposto: ReactNode | null;
  /**
   * Qual recorte este número é — `identidadeDePeriodo(from, to)`. Sem ela o
   * efeito não conta a partir do número anterior: contar a partir do total de
   * OUTRO período afirma um valor que não é daquele rótulo, e foi o defeito
   * medido em 28/08/2026.
   */
  identidadeDoPeriodo?: string;
}) {
  // A faixa do período: as colunas do canal, mais a margem no fim.
  return (
    <section className="v3-card v3-faixa">
      <div className="v3-card-cab">
        <h2>{periodoLabel}</h2>
        <div className="v3-card-cab-dir">
          <span className="v3-meta">{resumoApuracao}</span>
          <a className="v3-btn" href={hrefResultado}>Abrir resultado →</a>
        </div>
      </div>

      <div className="v3-colunas">
        {colunas.map((c) => (
          <div className="v3-coluna" key={c.id}>
            <p className="v3-coluna-rotulo">
              {c.rotulo}
              {c.dica ? (
                <span className="metric-info" data-dica={c.dica} tabIndex={0} role="note">i</span>
              ) : null}
            </p>
            <strong className={`v3-coluna-valor${c.tom && c.tom !== "normal" ? ` is-${c.tom}` : ""}`}>
              {c.bruto != null && c.formatar ? (
                <AnimatedNumber id={`faixa-${c.id}`} periodo={identidadeDoPeriodo} value={c.bruto} format={c.formatar} />
              ) : (
                c.valor
              )}
            </strong>
            {c.share ? <span className="v3-coluna-share">{c.share}</span> : null}
          </div>
        ))}
        <div className="v3-coluna is-ultima">
          <p className="v3-coluna-rotulo">Margem</p>
          <strong className={`v3-coluna-valor is-${margem.tom}`}>{margem.valor}</strong>
          {margem.nota ? <span className="v3-coluna-share">{margem.nota}</span> : null}
        </div>
      </div>

      {notaDoImposto ? <p className="v3-nota">{notaDoImposto}</p> : null}
    </section>
  );
}
