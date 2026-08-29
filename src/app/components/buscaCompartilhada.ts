"use client";

/**
 * Uma pergunta em voo é UMA pergunta, mesmo com dois perguntando.
 *
 * ## O defeito que isto conserta
 *
 * Medido em produção em 28/08/2026, na abertura de qualquer canal:
 * `/api/admin/eu` e `/api/trial` saíam DUAS vezes, e `/api/auth/accounts` saía
 * duas vezes na Amazon. Os três já tinham cuidado de cache — e o cuidado era o
 * mesmo, e errado do mesmo jeito: guardavam o RESULTADO. Enquanto a primeira
 * resposta não chegava não havia resultado nenhum para consultar, então a
 * segunda montagem perguntava de novo. Na medição a primeira saiu aos 21ms e
 * só respondeu aos 2648ms; a segunda saiu aos 1205ms, no meio da primeira.
 *
 * Guardar o RESULTADO cobre a montagem que vem depois. Guardar a PROMESSA cobre
 * também a que vem durante — que é justamente a que acontece na navegação entre
 * telas, quando a pessoa está esperando.
 *
 * ## O que ele deliberadamente NÃO faz
 *
 * Não é cache de resposta: a promessa sai do mapa assim que resolve. Segurar
 * resultado aqui daria dado velho a quem monta depois — e estas três perguntas
 * mudam (troca de conta, período de teste que expira, permissão revogada). O
 * ganho é só eliminar a repetição SIMULTÂNEA, que nunca traz informação nova:
 * as duas idas voltariam com a mesma resposta do mesmo instante.
 *
 * Quem quiser cache de resultado continua guardando por conta própria, como o
 * `useEhAdmin` faz — as duas camadas se somam sem se confundir.
 */

const emVoo = new Map<string, Promise<unknown>>();

/**
 * @param chave identifica a PERGUNTA, não quem pergunta. Duas telas com a mesma
 *   chave compartilham a resposta; perguntas diferentes nunca se cruzam.
 */
export function buscaCompartilhada<T>(chave: string, buscar: () => Promise<T>): Promise<T> {
  const jaEmVoo = emVoo.get(chave) as Promise<T> | undefined;
  if (jaEmVoo) return jaEmVoo;
  // `finally` devolve uma promessa nova que preserva valor e rejeição — quem
  // assinar recebe exatamente o que receberia sem o compartilhamento, inclusive
  // o erro. E a chave sai do mapa resolvendo OU falhando: falha presa aqui
  // deixaria a tela sem nunca mais poder tentar.
  const promessa = buscar().finally(() => { emVoo.delete(chave); });
  emVoo.set(chave, promessa);
  return promessa;
}
