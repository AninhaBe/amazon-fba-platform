"use client";

import { useCallback, useRef } from "react";

import { chaveDeVoo, criaControleDeVoo } from "./controleDeVoo";

/**
 * CACHE QUE VIVE O QUE A TELA VIVE — e a garantia é por construção.
 *
 * ## Por que não é o cache de escopo de módulo dos outros dashboards
 *
 * Nos módulos de Shopee e TikTok a tabela é corrigida por um PATCH EM MEMÓRIA:
 * salvar um custo não recarrega nada (pedido dela em 29/08/2026 — *"quero
 * apenas digitar, salvar, sem ter nenhum carregamento a partir disso"*), o valor
 * volta na resposta do POST e vira `custosSalvos`, que é estado de componente.
 *
 * Um cache de escopo de módulo **sobrevive ao patch**, e aí existe este caminho:
 *
 * > salvar o custo → sair da tela → voltar
 * >
 * > O patch morreu com a tela. O cache serve o payload ANTERIOR ao salvamento.
 * > A coluna volta a mostrar "—", e a vendedora conclui que o NEXO perdeu o
 * > custo que ela acabou de digitar.
 *
 * Hoje isso não acontece porque toda visita busca. Trocar isso por um cache que
 * vive mais que o patch é trocar uma tela correta por uma que **parece** ter
 * perdido dado — e só reproduz em quem salvou E navegou, que é o tipo de defeito
 * que some quando se vai procurar.
 *
 * ## A regra, e por que ela não pode falhar
 *
 * O cache e o controle de voo vivem no MESMO `useRef` do componente que guarda
 * o patch. Os três nascem e morrem juntos. **Não existe estado em que o cache
 * sirva um payload velho sem o patch que o corrige** — não é invalidação
 * bem-feita, é invalidação que não tem como falhar.
 *
 * Isso também resolve os dois escritores que moram no SERVIDOR (a sincronização
 * de fundo e a reconexão da loja) e não têm canal para avisar o cliente: como
 * toda visita busca, eles nunca chegam a ser um problema de cache.
 *
 * ⚠️ O PREÇO, DECLARADO: voltar à tela depois de sair paga a ida de novo. É
 * deliberado — é o custo de não ter as invalidações que não existem. O que se
 * ganha é dentro da visita: voltar a um período já visto passa a custar zero, e
 * é esse zero que paga a antecipação por intenção sem subir requisição.
 *
 * ⚠️ E o controle de voo aqui é PRÓPRIO, não o `controleDoEscopo` compartilhado.
 * O compartilhado sobrevive à desmontagem, e uma ida iniciada pela montagem
 * anterior poderia ser entregue à nova — reabrindo pela fresta o mesmo defeito
 * que o tempo de vida comum existe para fechar.
 */
export function useCacheDaTela<T>(escopo: string) {
  const guardado = useRef<Map<string, T> | null>(null);
  const voo = useRef<ReturnType<typeof criaControleDeVoo> | null>(null);
  if (guardado.current === null) guardado.current = new Map<string, T>();
  if (voo.current === null) voo.current = criaControleDeVoo();

  /** Busca uma vez por chave; chamadas concorrentes esperam a MESMA ida. */
  const buscar = useCallback((chave: string, ida: () => Promise<T>): Promise<T> => {
    const emCache = guardado.current!.get(chave);
    if (emCache !== undefined) return Promise.resolve(emCache);
    return voo.current!.umaVezSo(chaveDeVoo(escopo, chave), async () => {
      const corpo = await ida();
      guardado.current!.set(chave, corpo);
      return corpo;
    });
  }, [escopo]);

  const jaTem = useCallback((chave: string) => guardado.current!.has(chave), []);

  /**
   * Esquece tudo. Chamado por quem ESCREVE de dentro da tela e muda o que o
   * servidor vai responder — hoje, salvar a alíquota da loja.
   */
  const esquecer = useCallback(() => { guardado.current!.clear(); }, []);

  return { buscar, jaTem, esquecer };
}
