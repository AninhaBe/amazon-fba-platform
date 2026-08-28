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

  // ⚠️ AJUSTE DE ESTADO DURANTE O RENDER — padrao documentado do React
  // ("adjusting state when a prop changes"), e aqui ele NAO e otimizacao: e
  // correcao.
  //
  // Medido na v150 em 28/08/2026: sobravam exatamente DOIS quadros com o numero
  // do periodo anterior sob o rotulo novo, e so nos canais que usam este
  // componente (3 de 3 falhavam; o TikTok, que nao usa, passava). A causa e que
  // `displayed` e estado e quem o corrigia era um `useEffect` — efeito roda
  // DEPOIS da pintura, entao o primeiro paint ainda mostrava o valor velho.
  //
  // O `key={periodo}` la embaixo nao resolve isto: chave identifica o span na
  // lista de filhos do PAI, nao remonta este componente, entao o estado
  // sobrevive. Ela serve para a animacao de entrada, e so.
  //
  // Comparacao por VALOR e estrita: `periodo` e string derivada (ex.: "de|ate").
  // Se alguem passar objeto, cada render cria referencia nova, a guarda nunca
  // fecha e isto vira loop — por isso o tipo e `string | undefined` e ha teste
  // travando que as telas passem string.
  const [periodoAnterior, setPeriodoAnterior] = useState(periodo);
  if (periodo !== periodoAnterior) {
    setPeriodoAnterior(periodo);
    // O React re-renderiza antes de pintar: nao sobra quadro com o valor do
    // recorte anterior.
    setDisplayed(value);
    // Os refs NAO sao tocados aqui: `react-hooks/refs` proibe acessa-los no
    // render, e nao e preciso — o efeito abaixo ja detecta a troca de periodo
    // (`mesmoPeriodo` falso), pinta direto e ressincroniza os dois.
  }

  useEffect(() => {
    const remember = (current: number) => {
      if (id !== undefined) lastValueById.set(id, { valor: current, periodo });
    };
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // ⚠️ ANIMAR EXIGE PROVA DE QUE O RECORTE E O MESMO.
    //
    // A Amazon falhou na medicao de 28/08/2026 justamente por depender da
    // disciplina de quem usa: ela nao passava `periodo`, e como no caminho com
    // cache nao ha esqueleto o componente NAO desmonta — o valor anterior
    // sobrevive na propria instancia e a animacao partia dele. O default
    // anterior so protegia a remontagem.
    //
    // Agora a regra e uma so: anima somente quando o chamador DECLARA o periodo
    // e ele nao mudou. Sem declaracao nao da para saber se o valor novo e do
    // mesmo recorte, e na duvida vale o seguro — animacao e enfeite, numero de
    // outro periodo e defeito. Quem esquecer a prop perde a animacao, nunca
    // ganha um numero errado.
    const mesmoPeriodo = periodo !== undefined && periodoRef.current === periodo;
    periodoRef.current = periodo;
    const from = displayedRef.current;
    if (reduceMotion || !mesmoPeriodo || from === value) {
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

  // TROCA DE PERIODO TEM MOVIMENTO, SO NAO TEM MENTIRA.
  //
  // A Ana notou a v148 e disse que o ML "muda cruzao": tirar a contagem deixou
  // a troca seca. O problema nunca foi o movimento — era a contagem PASSAR por
  // numeros que nao pertencem ao periodo novo (cada quadro daqueles afirma um
  // valor falso). Entao o valor novo aparece inteiro, de uma vez, e o que anima
  // e a ENTRADA dele.
  //
  // `key={periodo}`: ao trocar de recorte o span remonta e a animacao de
  // entrada roda de novo. No mesmo recorte nao ha remontagem, entao a contagem
  // de 550ms segue como sempre — que e o efeito honesto e o que ela gosta.
  return <span className="numero-animado" key={periodo}>{format(displayed)}</span>;
}
