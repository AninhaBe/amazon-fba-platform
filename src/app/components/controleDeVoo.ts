/**
 * QUEM JÁ ESTÁ NO AR — o controle que impede duas buscas da MESMA janela.
 *
 * ## O defeito que isto corrige (medido em 31/08/2026)
 *
 * `prefetchDePeriodos.ts` tinha duas bocas pedindo ao servidor: a fila de fundo
 * e a antecipação por intenção (o hover). O comentário do arquivo afirmava, em
 * cima do `emVoo`:
 *
 * > *"O que a fila de fundo e a intenção compartilham: nem uma nem outra busca
 * > duas vezes a mesma janela do mesmo escopo."*
 *
 * **A frase era falsa.** Só `aquecerAgora` registrava e consultava o conjunto;
 * a fila de fundo nunca fez nem uma coisa nem outra. Bastava passar o mouse
 * sobre a janela que a fila já estava buscando para sair uma SEGUNDA requisição
 * simultânea da mesma coisa — duas conexões do mesmo pool, no arquivo cujo
 * próprio comentário diz que quatro simultâneas atrasariam a tela aberta.
 *
 * Comentário que descreve invariante que o código não tem é pior que comentário
 * nenhum: ele desliga a desconfiança de quem lê. Por isso a invariante saiu do
 * texto e virou peça com um dono só.
 *
 * ## Por que UMA IDA COMPARTILHADA, e não "o segundo desiste"
 *
 * A primeira versão só sabia recusar (`tentar` devolvia `false`). Isso serve
 * para quem aquece — ninguém está esperando —, mas **não serve para o clique**:
 * a tela que desiste porque já há uma busca no ar fica sem dado nenhum.
 *
 * `umaVezSo` resolve os dois casos com uma primitiva: a segunda chamada não
 * emite requisição nova, ela **espera a mesma ida** e recebe o mesmo resultado.
 * Quem aquece ignora o resultado; quem clicou usa. É o que permite o cache da
 * tela passar por aqui sem recriar a duplicação (condição do cérebro,
 * 31/08/2026).
 *
 * ## Por que registro por escopo, e não um `useRef` no hook
 *
 * Porque as duas bocas do hook **e a busca da própria tela** precisam do MESMO
 * controle. Enquanto ele morasse dentro do hook, a busca do clique passaria por
 * fora — e o defeito voltaria pela porta da tela.
 */
export interface ControleDeVoo {
  /**
   * Executa `fn` no máximo uma vez por chave ao mesmo tempo. Chamadas
   * concorrentes recebem a MESMA promessa — nenhuma requisição a mais.
   */
  umaVezSo<T>(chave: string, fn: () => Promise<T>): Promise<T>;
  /** Já há uma ida desta chave no ar? Para quem aquece e pode simplesmente pular. */
  noAr(chave: string): boolean;
}

export function criaControleDeVoo(): ControleDeVoo {
  const voando = new Map<string, Promise<unknown>>();
  return {
    umaVezSo<T>(chave: string, fn: () => Promise<T>): Promise<T> {
      const existente = voando.get(chave);
      if (existente) return existente as Promise<T>;
      // A limpeza é no `finally`: falha também libera. Sem isso, uma janela que
      // falhou no aquecimento ficaria travada e o clique nela nunca mais
      // buscaria — trocar desperdício por tela que não carrega é piorar.
      const promessa = fn().finally(() => {
        if (voando.get(chave) === promessa) voando.delete(chave);
      });
      voando.set(chave, promessa);
      return promessa;
    },
    noAr(chave) {
      return voando.has(chave);
    },
  };
}

/** A chave é por ESCOPO e janela: trocar de loja não reaproveita a vez da outra. */
export function chaveDeVoo(escopo: string, janela: string): string {
  return `${escopo}|${janela}`;
}

const porEscopo = new Map<string, ControleDeVoo>();

/**
 * O controle COMPARTILHADO de um escopo (canal + conta).
 *
 * ⚠️ Escopo de módulo de propósito: o hook desmonta e remonta a cada navegação,
 * e um controle preso ao ciclo de vida do componente não veria a busca que a
 * própria tela disparou. Não vaza: cada entrada some sozinha quando a ida
 * termina, e o mapa guarda um controle por escopo, não uma entrada por busca.
 */
export function controleDoEscopo(escopo: string): ControleDeVoo {
  let controle = porEscopo.get(escopo);
  if (!controle) {
    controle = criaControleDeVoo();
    porEscopo.set(escopo, controle);
  }
  return controle;
}
