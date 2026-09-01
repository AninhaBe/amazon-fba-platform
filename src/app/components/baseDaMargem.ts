/**
 * A DECLARAÇÃO DE BASE DA MARGEM — uma frase, um lugar, os quatro canais.
 *
 * ⚠️ POR QUE ELA EXISTE (31/08/2026, na conta da Ana): a tela mostrava lucro e
 * margem calculados sobre **R$ 748,56 apurados** ao lado de um card de
 * Faturamento de **R$ 1.068,37**. Os dois números estavam certos e descreviam
 * universos diferentes — e ela concluiu, com razão, que a tela estava errada.
 * A explicação existia... dentro do "i". **Declaração que exige hover não
 * declara nada.**
 *
 * ⚠️ POR QUE ELA MORA AQUI, E NÃO DENTRO DO CARD DA AMAZON: a Shopee vai
 * receber o desbloqueio da margem com a mesma necessidade, e ML e TikTok têm a
 * mesma diferença entre faturamento exibido e base apurada. Se cada canal
 * escrever a própria frase, nascem quatro declarações que divergem na primeira
 * vez que alguém ajustar uma — que é o defeito do dia repetido na camada visual.
 *
 * REGRA DE RENDERIZAÇÃO, e ela não é negociável: o texto vai num campo VISÍVEL
 * SEM INTERAÇÃO (o `sub` do card), nunca no `info`/tooltip. Quem renderizar isto
 * dentro de um "i" reintroduz o defeito com a frase certa.
 */

export interface BaseDaMargem {
  /** Receita que REALMENTE entrou na conta de lucro e margem. */
  baseApurada: number | null;
  /** Faturamento que o card ao lado exibe. */
  faturamentoExibido: number | null;
  moeda: string;
  /** Pedidos que ainda não entraram na base — a causa da diferença, quando conhecida. */
  pedidosAguardando?: number | null;
}

const dinheiro = (valor: number, moeda: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(valor);

/**
 * A frase, ou `null` quando não há o que declarar.
 *
 * ⚠️ `null` QUANDO AS BASES COINCIDEM, de propósito: explicar uma diferença que
 * não existe treina a pessoa a ignorar a frase no dia em que ela importa. Foi o
 * mesmo raciocínio da marca de "ainda consolidando" — aviso permanente vira
 * decoração.
 */
export function declaracaoDeBase(entrada: BaseDaMargem): string | null {
  const { baseApurada, faturamentoExibido, moeda } = entrada;
  if (baseApurada == null || faturamentoExibido == null) return null;
  // Só declara quando o faturamento exibido é MAIOR que a base: é esse o caso
  // que faz a pessoa ler "o lucro não sai do faturamento, logo está errado".
  if (faturamentoExibido <= baseApurada) return null;

  const aguardando = entrada.pedidosAguardando ?? 0;
  const causa = aguardando > 0
    ? ` — ${aguardando} pedido${aguardando > 1 ? "s" : ""} aguardando confirmação`
    : "";
  return `sobre ${dinheiro(baseApurada, moeda)} apurados de ${dinheiro(faturamentoExibido, moeda)}${causa}`;
}

/**
 * O texto padrão quando não há diferença a declarar. Existe para os canais não
 * inventarem cada um o seu ("sobre vendas", "sobre o faturamento", "da receita").
 */
export const BASE_SEM_DIFERENCA = "sobre vendas";

/**
 * O NOME DA BASE — a frase que responde "esta porcentagem sai de quê".
 *
 * ⚠️ NÃO É A MESMA PERGUNTA DE `declaracaoDeBase`, e confundir as duas foi o que
 * a medição de 01/09/2026 encontrou. `declaracaoDeBase` responde *"por que este
 * número é menor do que o faturamento ao lado"* — e devolve `null` quando não há
 * divergência, de propósito. Três telas (o monitor, a central e o módulo da
 * Shopee) não têm divergência nenhuma para declarar: elas só precisam **nomear o
 * denominador**. Roteá-las pela peça errada trocaria "sobre a receita
 * processada" por "sobre vendas" — perda de especificidade travestida de
 * refatoração.
 *
 * As duas moram no mesmo arquivo porque o que se quer garantir é a
 * **procedência**: o vocabulário de base sai daqui, de lugar nenhum mais. É o
 * que permite à guarda nascer sem exceção — ver
 * `docs/achado-frase-com-validade-nao-vira-guarda.md`.
 *
 * `rotuloDaBase` é o nome do denominador NA TELA — o mesmo do cartão ao lado,
 * porque é assim que a pessoa liga os dois ("a receita conciliada", e o cartão
 * diz "Receita conciliada"). Ele não é texto livre: é o rótulo que já existe.
 */
export function nomeDaBase(
  entrada: BaseDaMargem & { rotuloDaBase: string },
): string {
  return declaracaoDeBase(entrada) ?? `sobre ${entrada.rotuloDaBase}`;
}
