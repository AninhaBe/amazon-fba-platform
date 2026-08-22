"use client";

import { useMemo, useState } from "react";
import styles from "./FinancialSummaryPanel.module.css";

export interface CompositionSlice {
  id: string;
  label: string;
  value: number;
  /** Verdadeiro só para o que SOBRA. Todo o resto é dinheiro que saiu. */
  isRemainder?: boolean;
  /** Resultado negativo: usa o acento de perigo, nunca o verde de lucro. */
  isLoss?: boolean;
  /** Saldo ainda sem classificação; não é custo confirmado nem lucro. */
  isPending?: boolean;
}

/**
 * Donut de composição — para onde foi o faturamento.
 *
 * ## Por que este elemento e não mais uma tabela
 *
 * A cascata financeira que já existe responde "quanto foi cada custo". Ela não
 * responde "qual custo está comendo a operação", porque ler proporção numa
 * coluna de números exige a pessoa fazer a divisão de cabeça. O donut responde
 * isso antes da leitura: a fatia grande é grande.
 *
 * ## A decisão de cor, que é o ponto
 *
 * A referência usa uma paleta categórica — uma cor por tipo. Aqui isso seria
 * errado por dois motivos. Primeiro, a identidade reserva cor saturada para o
 * que significa estado, e "logística" não é um estado. Segundo, e mais
 * importante: **as fatias não são categorias equivalentes.** Comissão, frete,
 * anúncios e custo do produto são todos a mesma coisa — dinheiro que saiu. Só
 * uma fatia é diferente em natureza: a que sobrou.
 *
 * Então os custos são degraus da MESMA tinta, do mais pesado ao mais leve, o
 * lucro é verde e uma composição ainda aberta recebe apenas um âmbar discreto.
 * A leitura fica imediata e verdadeira: a parte escura foi embora, a verde é
 * sua e a âmbar ainda precisa fechar. Uma paleta arco-íris diria que anúncio e
 * lucro são coisas do mesmo tipo, e não são.
 *
 * Prejuízo inverte o único acento: sem verde, o que "sobra" é vermelho.
 */

const RAIO = 54;
const ESPESSURA = 14;
const CIRC = 2 * Math.PI * RAIO;

/** Degraus de tinta para os custos: do mais pesado ao mais leve. */
const TONS_CUSTO = [
  "color-mix(in oklch, var(--danger) 82%, var(--ink))",
  "color-mix(in oklch, var(--danger) 72%, var(--paper))",
  "color-mix(in oklch, var(--danger) 58%, var(--paper))",
  "color-mix(in oklch, var(--danger) 46%, var(--paper))",
  "color-mix(in oklch, var(--danger) 34%, var(--paper))",
  "color-mix(in oklch, var(--danger) 24%, var(--paper))",
];

export function CompositionDonut({
  slices,
  total,
  totalLabel,
  format,
}: {
  slices: CompositionSlice[];
  /** O 100% — o faturamento, não a soma das fatias exibidas. */
  total: number;
  totalLabel: string;
  format: (value: number) => string;
}) {
  const [ativo, setAtivo] = useState<string | null>(null);

  const visiveis = useMemo(
    () => slices.filter((s) => s.value > 0).sort((a, b) => {
      // O que sobra vai por último no anel, independente do tamanho: a leitura
      // é "saiu, saiu, saiu, sobrou isto".
      const rank = (slice: CompositionSlice) => slice.isRemainder ? 2 : slice.isPending ? 1 : 0;
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return b.value - a.value;
    }),
    [slices],
  );

  const soma = visiveis.reduce((t, s) => t + s.value, 0);
  const base = total > 0 ? total : soma;
  if (base <= 0 || visiveis.length === 0) return null;

  // `reduce` em vez de acumulador mutável: cada arco precisa saber onde o
  // anterior parou, e mutar uma variável dentro do `map` é escrita durante o
  // render — o compilador do React sinaliza, e com razão: numa re-renderização
  // interrompida o acumulado pode entrar sujo.
  const arcos = visiveis.reduce<Array<CompositionSlice & { fracao: number; offset: number; tom: string | null }>>(
    (acc, s, i) => {
      const fracao = s.value / base;
      const offset = acc.length === 0 ? 0 : acc[acc.length - 1].offset + acc[acc.length - 1].fracao;
      acc.push({
        ...s,
        fracao,
        offset,
        tom: s.isRemainder
          ? null
          : s.isPending
            ? "color-mix(in oklch, var(--warning) 52%, var(--paper))"
            : TONS_CUSTO[Math.min(i, TONS_CUSTO.length - 1)],
      });
      return acc;
    },
    [],
  );

  const destacado = arcos.find((a) => a.id === ativo);
  const centroValor = destacado ? destacado.value : total;
  const centroRotulo = destacado ? destacado.label : totalLabel;
  const centroPct = destacado ? `${(destacado.fracao * 100).toFixed(1).replace(".", ",")}%` : null;
  const centroTexto = centroPct ?? format(centroValor);
  const centroTamanho = centroTexto.length > 14 ? styles.centerTight : centroTexto.length > 11 ? styles.centerCompact : "";

  return (
    <div className={`composition-donut${arcos.length > 2 ? " is-detailed" : ""}`}>
      <div className="composition-donut-ring">
        <svg viewBox="0 0 140 140" role="img" aria-label={`${totalLabel}: ${format(total)}`}>
          <circle cx="70" cy="70" r={RAIO} fill="none" stroke="var(--ink-05)" strokeWidth={ESPESSURA} />
          {arcos.map((a) => (
            <circle
              key={a.id}
              cx="70"
              cy="70"
              r={RAIO}
              fill="none"
              className={`composition-arc${a.isRemainder ? " is-remainder" : ""}${a.isLoss ? " is-loss" : ""}${a.isPending ? " is-pending" : ""}${ativo === a.id ? " is-active" : ""}${ativo && ativo !== a.id ? " is-dimmed" : ""}`}
              stroke={a.tom ?? undefined}
              strokeWidth={ESPESSURA}
              strokeDasharray={`${a.fracao * CIRC} ${CIRC}`}
              strokeDashoffset={-a.offset * CIRC}
              // -90° põe o início no topo; sem isso o anel começa às 3 horas e
              // a primeira fatia (a maior) fica cortada ao meio pelo eixo.
              transform="rotate(-90 70 70)"
              onMouseEnter={() => setAtivo(a.id)}
              onMouseLeave={() => setAtivo(null)}
            />
          ))}
        </svg>
        {/* O centro é o que muda no hover — é ele que transforma o donut de
            enfeite em leitura: você passa o mouse e lê o número daquela fatia
            sem tirar o olho do anel. */}
        <div
          className={`composition-donut-centro${
            destacado
              ? destacado.isPending
                ? " is-pending"
                : destacado.isRemainder && !destacado.isLoss
                  ? " is-positive"
                  : " is-cost"
              : ""
          }`}
          aria-live="polite"
        >
          <strong className={`${styles.centerValue}${centroTamanho ? ` ${centroTamanho}` : ""}`}>{centroTexto}</strong>
          <span>{centroRotulo}</span>
          {centroPct && <small>{format(centroValor)}</small>}
        </div>
      </div>

      <ul className="composition-legenda">
        {arcos.map((a) => (
          <li
            key={a.id}
            className={[
              ativo === a.id ? "is-active" : "",
              ativo && ativo !== a.id ? "is-dimmed" : "",
              a.isPending ? "is-pending" : a.isRemainder && !a.isLoss ? "is-remainder" : "is-cost",
            ].filter(Boolean).join(" ")}
            tabIndex={0}
            aria-label={`${a.label}: ${format(a.value)}, ${(a.fracao * 100).toFixed(1).replace(".", ",")}%`}
            onMouseEnter={() => setAtivo(a.id)}
            onMouseLeave={() => setAtivo(null)}
            onFocus={() => setAtivo(a.id)}
            onBlur={() => setAtivo(null)}
          >
            <span
              className={`composition-ponto${a.isRemainder ? " is-remainder" : ""}${a.isLoss ? " is-loss" : ""}${a.isPending ? " is-pending" : ""}`}
              style={a.tom ? { background: a.tom } : undefined}
              aria-hidden="true"
            />
            <span className="composition-legenda-label">{a.label}</span>
            <span className="composition-legenda-valor">{format(a.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
