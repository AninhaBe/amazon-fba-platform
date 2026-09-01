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
 * É a família de defeito do AGENTS.md vista pelo avesso: aqui não foi o teste
 * que garantiu o símbolo sem o comportamento, foi o COMENTÁRIO. Por isso a
 * invariante saiu do texto e virou código com um dono só.
 *
 * ## Por que peça própria, e não mais um `useRef` no hook
 *
 * Para ser testável por COMPORTAMENTO. Enquanto a regra morasse dentro do laço
 * do hook, o único teste possível seria casar texto do fonte — que é
 * exatamente o tipo de teste que passa depois de alguém apagar a chamada.
 */
export interface ControleDeVoo {
  /** Reserva a vez. `false` = já há uma busca desta janela no ar; não emita outra. */
  tentar(chave: string): boolean;
  /** Libera a vez, com ou sem sucesso — falha também tem de liberar. */
  concluir(chave: string): void;
  noAr(chave: string): boolean;
}

export function criaControleDeVoo(): ControleDeVoo {
  const noAr = new Set<string>();
  return {
    tentar(chave) {
      if (noAr.has(chave)) return false;
      noAr.add(chave);
      return true;
    },
    concluir(chave) {
      noAr.delete(chave);
    },
    noAr(chave) {
      return noAr.has(chave);
    },
  };
}

/** A chave é por ESCOPO e janela: trocar de loja não reaproveita a vez da outra. */
export function chaveDeVoo(escopo: string, janela: string): string {
  return `${escopo}|${janela}`;
}
