/**
 * A HIERARQUIA DE AVISOS DE UMA TELA — uma peça, quatro canais.
 *
 * ## O critério, e ele não é sobre esta peça: é sobre o CONJUNTO
 *
 * ⚠️ **Hierarquia não é propriedade de cada aviso; é do conjunto.** A marca de
 * estimativa foi desenhada exatamente para não competir com alarme — tinta
 * terciária, sem cor de aviso, colada ao número. Ela cumpre a regra, e mesmo
 * assim SOME, porque acima dela havia cinco faixas e nove marcas "⚠". **Cada
 * peça respeitou a regra sozinha e o conjunto violou.**
 *
 * Foi assim que se chegou lá fazendo tudo certo, um de cada vez — e é por isso
 * que a auditoria de empilhamento precisa acontecer de novo **toda vez que uma
 * tela ganhar mais de duas peças novas**. Não é zelo: nenhuma revisão de peça
 * isolada consegue ver este defeito, por construção.
 *
 * ## O que a auditoria de 01/09/2026 mediu
 *
 * **Não era excesso de informação. Era a MESMA informação repetida.** Nove a
 * doze marcas dizendo TRÊS coisas: `sinaisDoResultado()` devolve até 3 sinais e
 * a mesma lista era passada para 3 cartões no ML e 4 na Shopee. Repetição ensina
 * a varrer a faixa sem ler nenhuma.
 *
 * ⚠️ **E é por isso que o conserto NÃO tira informação.** Os três sinais
 * continuam visíveis, uma vez cada, com número e link. O que sai é a repetição.
 * Se em algum ponto um corte fizer um sinal sumir de vez, o corte está errado —
 * vira o oposto do que ela pediu, que é apontar o que falta com número.
 *
 * ## A referência é a CENTRAL
 *
 * A tela de Visão geral já estava certa: **uma** frase de alerta, escolhida por
 * prioridade, mais a narração. **As telas de canal se alinham ao formato da
 * central, e não o contrário.** Quem for criar tela nova olha para lá.
 *
 * ## As três categorias
 *
 * | categoria | o que é | regra |
 * |---|---|---|
 * | **alarme** | pede ação dela, e ela pode agir agora | 1 por tela, o de maior prioridade |
 * | **informação** | muda como o número é lido, e não há o que fazer | 1 por número, colada a ele — nunca em faixa |
 * | **progresso** | some sozinho | 1 por tela |
 */

export type CategoriaDeAviso = "alarme" | "informacao" | "progresso";

/**
 * Quem manda quando há mais de um progresso.
 *
 * Sync interrompido e sync em andamento descrevem o MESMO eixo, e duas faixas
 * para isso é uma a mais. Interrompido ganha: é o estado que não se resolve
 * sozinho.
 */
export const ORDEM_DO_PROGRESSO = ["interrompido", "em-andamento", "concluido"] as const;
export type EstadoDeProgresso = (typeof ORDEM_DO_PROGRESSO)[number];

export function progressoQueAparece(
  candidatos: ReadonlyArray<EstadoDeProgresso | null | undefined>,
): EstadoDeProgresso | null {
  for (const estado of ORDEM_DO_PROGRESSO) {
    if (candidatos.includes(estado)) return estado;
  }
  return null;
}

/**
 * A CONEXÃO CAÍDA CALA OS SINAIS DE RESULTADO — e este é o corte 2.
 *
 * Sem dado, "3 SKUs sem custo cadastrado" não é o problema dela: cadastrar o
 * custo não traz o número de volta, reconectar traz. Mostrar os dois lado a lado
 * pede duas ações e só uma resolve, e é assim que a pessoa escolhe a errada.
 *
 * ⚠️ E os sinais NÃO somem do produto: eles voltam inteiros no instante em que a
 * conexão volta, porque a condição é o estado da conexão e não uma supressão
 * guardada em algum lugar.
 */
export function sinaisSilenciadosPorAlarme(conexaoCaida: boolean): boolean {
  return conexaoCaida;
}
