"use client";

import { useEffect, useRef } from "react";

/**
 * Aquece os períodos padrão em segundo plano, para a PRIMEIRA troca já ser
 * instantânea.
 *
 * ## Por que existe
 *
 * O cache de período resolvia a segunda visita; a primeira continuava pagando a
 * ida inteira. E a pessoa não deveria ter que "treinar" a tela: a Ana descreveu
 * exatamente isso indo de "hoje" para "7 dias" e sentindo a espera. São só
 * quatro janelas, e o servidor responde cada uma entre ~160ms e ~470ms.
 *
 * ## As três regras que ele respeita, e por quê
 *
 * 1. **Depois da primeira pintura.** Dispara em `requestIdleCallback` (ou um
 *    atraso, onde não existe): aquecer não pode competir com o que a pessoa
 *    está esperando ver agora.
 * 2. **Sequencial, nunca em paralelo.** Quatro requisições simultâneas brigam
 *    pelo mesmo pool de conexões que a investigação de performance mostrou
 *    apertado — e atrasariam justamente a tela aberta.
 * 3. **Só o que falta.** Período já em cache não é buscado de novo.
 *
 * ## O que ele NÃO faz
 *
 * Não mexe em estado de tela: escreve apenas no cache de módulo do canal. Como
 * cada dashboard DERIVA o que exibe a partir do período selecionado, um período
 * aquecido só aparece quando a pessoa clica nele — nunca sob o rótulo de outro.
 * É por isso que aquecer aqui é seguro: a honestidade não depende deste arquivo.
 */

/** Os quatro presets do filtro, na ordem em que o dashboard os oferece. */
export const PERIODOS_PADRAO = ["days=today", "days=7", "days=15", "days=30"] as const;

export function usePrefetchDePeriodos({ ativo, atual, escopo, jaTem, buscar }: {
  /** `false` enquanto a tela não pintou, não há conexão, ou o sync inicial roda. */
  ativo: boolean;
  /** Período que a pessoa está vendo — não se aquece o que já está na tela. */
  atual: string;
  /** Identidade da conexão/loja: trocar de loja reaquece, e nunca mistura. */
  escopo: string;
  jaTem: (periodo: string) => boolean;
  buscar: (periodo: string, signal: AbortSignal) => Promise<void>;
}) {
  // Um aquecimento por escopo por sessão. Sem isto, cada revalidação dispararia
  // a fila de novo.
  const feitos = useRef(new Set<string>());

  useEffect(() => {
    if (!ativo || !escopo || feitos.current.has(escopo)) return;
    feitos.current.add(escopo);

    const controller = new AbortController();
    let cancelado = false;

    const aquecer = async () => {
      for (const periodo of PERIODOS_PADRAO) {
        if (cancelado || controller.signal.aborted) return;
        if (periodo === atual || jaTem(periodo)) continue;
        try {
          // `await` dentro do laço é DE PROPÓSITO: uma por vez.
          await buscar(periodo, controller.signal);
        } catch {
          // Aquecer é oportunista: uma falha aqui não vira erro de tela, porque
          // o clique na aba faz a busca de verdade e trata o erro lá.
          return;
        }
      }
    };

    const agendar = typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(() => void aquecer(), { timeout: 2_000 })
      : window.setTimeout(() => void aquecer(), 800);

    return () => {
      cancelado = true;
      controller.abort();
      if (typeof window.cancelIdleCallback === "function" && typeof agendar === "number") {
        window.cancelIdleCallback(agendar);
      }
      window.clearTimeout(agendar as number);
    };
  }, [ativo, atual, escopo, jaTem, buscar]);
}
