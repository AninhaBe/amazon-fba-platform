/**
 * Qual loja a tela mostra quando ninguém escolheu — UMA regra, os dois lados.
 *
 * ## Por que isto existe
 *
 * Para eliminar um RTT da abertura (medido em 28/08/2026: ~500ms só para
 * descobrir a conexão antes de poder pedir o dado), o SERVIDOR passou a
 * resolver a loja padrão quando a requisição não traz `connection_id`.
 *
 * ⚠️ Isso cria um risco novo, e é o motivo deste módulo existir: se o servidor
 * escolher a loja A e o seletor da tela escolher a loja B, a pessoa lê o número
 * de uma loja sob o nome de outra. É a MESMA classe de defeito do número sob o
 * rótulo de período errado que passamos a noite consertando — e num app
 * multi-loja é pior, porque o vendedor não tem como desconfiar.
 *
 * A regra estava duplicada (uma cópia em `selectShopeeConnection`, outra no
 * `ShopeeWorkspace`). Eram equivalentes por acaso, não por construção: bastava
 * alguém mudar um filtro de um lado. Agora é uma função só, e o teste prova que
 * os dois lados chamam esta.
 *
 * ## A regra
 *
 * 1. Pedido explícito ganha, se existir e estiver conectado.
 * 2. Senão, a PRIMEIRA conectada — na ordem em que o banco devolve
 *    (`ORDER BY connected_at`), que é a mesma lista que alimenta o seletor.
 *
 * A ordem importa tanto quanto o filtro: dois lados que filtram igual mas
 * ordenam diferente escolhem lojas diferentes.
 */

export interface ConexaoSelecionavel {
  id: string;
  status: string;
}

export function escolherConexaoPadrao<T extends ConexaoSelecionavel>(
  conexoes: readonly T[],
  pedida?: string | null,
): T | null {
  const conectadas = conexoes.filter((conexao) => conexao.status === "connected");
  if (pedida) return conectadas.find((conexao) => conexao.id === pedida) ?? null;
  return conectadas[0] ?? null;
}
