"use client";

import { useEffect, useRef, useState } from "react";

import { identidadeDePeriodo, sementeDaContagem } from "./efeitoDeNumero";

// Re-exportado: dezenas de telas importam `identidadeDePeriodo` daqui, e mover
// logica para poder testa-la nao e hora de mandar o produto trocar import.
export { identidadeDePeriodo, sementeDaContagem };

// Rola o número até o valor novo em ~550ms (ease-out). Na primeira aparição
// mostra o valor real de imediato — contar do zero na estreia, em valor alto,
// parecia bug. Depois disso todo valor novo é contado: do número anterior
// quando o período é o mesmo, do zero quando o período muda.
// Sob prefers-reduced-motion o valor final aparece de imediato, sem movimento.
//
// `id` (opcional) guarda o último valor exibido por instância num escopo de
// módulo. Ao trocar de período um skeleton pisca e o componente desmonta/remonta;
// sem essa memória ele reaparecia já no valor final. Com o `id`, ao remontar ele
// parte do valor anterior — sem precisar manter conteúdo pesado montado durante
// o loading.
//
// ⚠️ `periodo`: TROCA DE PERÍODO CONTA A PARTIR DO ZERO.
//
// Medido em produção em 28/08/2026: no caminho com cache (sem skeleton), o
// primeiro quadro depois do clique mostrava o valor do período ANTERIOR sob o
// rótulo do período NOVO — a Ana mandou print com R$ 325,91 de "hoje" embaixo
// de "7 dias". O defeito nunca foi o movimento: era a tela AFIRMAR um número
// que pertence a outro recorte. Número real, plausível e parado se confunde
// com verdade.
//
// Zero não se confunde com nada: não é o total de recorte nenhum, e sobe na
// frente da pessoa — o movimento diz sozinho que é animação, não afirmação.
// Então a troca de período volta a ter contagem, só que partindo de zero, com
// a MESMA duração e a mesma curva da contagem de sempre.
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
  // Troca de RECORTE (ha memoria deste id, de outro periodo) comeca do zero e
  // conta ate o valor novo. Primeira aparicao (sem memoria) continua entrando
  // direto: contar do zero na estreia parecia bug em valor alto, e isso ja
  // estava decidido antes.

  // Semente só vale se for comprovadamente do MESMO período. Sem `periodo`, o
  // componente NÃO herda valor entre montagens — o padrão é o seguro: quem não
  // declara o período nunca anima a partir do número de outro. Dentro de uma
  // mesma montagem a animação segue normal (é o caso honesto: mesmo período,
  // valor novo chegando).
  const seed = sementeDaContagem(lembrado, periodo, value);
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
    // ZERO, nao o valor novo: e o primeiro quadro da contagem. O que nao pode
    // aparecer aqui e o valor REAL do periodo anterior — numero plausivel e
    // parado, que se confunde com verdade. Zero em movimento nao se confunde:
    // ele sobe na frente da pessoa e nunca foi o total de recorte nenhum.
    setDisplayed(0);
    // Os refs NAO sao tocados aqui: `react-hooks/refs` proibe acessa-los no
    // render. O efeito abaixo detecta a troca e conta a partir do zero.
  }

  useEffect(() => {
    const remember = (current: number) => {
      if (id !== undefined) lastValueById.set(id, { valor: current, periodo });
    };
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // ⚠️ ANIMAR A PARTIR DO NÚMERO ANTERIOR EXIGE PROVA DE QUE O RECORTE É O
    // MESMO — e só isso.
    //
    // A Amazon falhou na medição de 28/08/2026 justamente por depender da
    // disciplina de quem usa: ela não passava `periodo`, e como no caminho com
    // cache não há esqueleto o componente NÃO desmonta — o valor anterior
    // sobrevive na própria instância e a contagem partia dele.
    //
    // Três caminhos, um critério: mesmo período conta de onde estava (valor novo
    // chegando é mudança real); período declarado e diferente conta do zero; sem
    // `periodo` declarado, pinta direto. Quem esquecer a prop perde o efeito,
    // nunca ganha um número de outro recorte.
    const mesmoPeriodo = periodo !== undefined && periodoRef.current === periodo;
    const trocou = periodoRef.current !== periodo;
    periodoRef.current = periodo;
    // Recorte novo conta do zero; mesmo recorte conta de onde estava. Uma
    // duracao e uma curva so — nao existe segunda animacao aqui.
    const from = trocou ? 0 : displayedRef.current;
    if (reduceMotion || (!mesmoPeriodo && !trocou) || from === value) {
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

  // SEM `key={periodo}` — DE PROPÓSITO, E ISSO MUDOU EM 28/08/2026.
  //
  // A chave existia para remontar o span e refazer a animação de entrada
  // (`numero-entra`: 180ms de fade + 4px de subida) a cada troca de recorte.
  // Medido em produção: ela DISPARAVA mesmo — remontagem aos 62–77ms, opacidade
  // saindo de 0,00 — mas era sutil demais perto da contagem de 550ms que a dona
  // do produto conhecia, e por isso ela dizia que "o efeito não voltou".
  //
  // Agora que a troca conta de zero até o valor, a entrada passaria a ATRAPALHAR:
  // o fade esconderia justamente o começo da contagem. Uma situação, um
  // movimento. A entrada continua no CSS e roda onde ela é a única coisa que
  // acontece: a primeira aparição do número, depois do esqueleto.
  return <span className="numero-animado">{format(displayed)}</span>;
}
