/**
 * Identidade de uma busca de overview — o que decide se dois pedidos são o
 * MESMO pedido.
 *
 * ## Por que existe
 *
 * Medido em produção em 28/08/2026: a Shopee pedia `/api/integrations/shopee/
 * overview` três vezes antes da primeira pintura, sendo a rota mais cara que
 * medimos (1457ms em 30 dias na conta real). Duas dessas idas eram idênticas —
 * saíam com 5ms de diferença, porque o efeito dependia de objetos (`status`,
 * `searchParams`) cuja referência muda sem que a pergunta mude.
 *
 * A guarda contra a repetição precisa de uma identidade, e a identidade precisa
 * mudar sempre que a pergunta muda de verdade. Ela mora aqui, fora do
 * componente, por um motivo que custou um teste vermelho para ficar claro: a
 * regra que importa é de COMPORTAMENTO ("mexer em qualquer gatilho legítimo
 * produz chave diferente"), e comportamento se prova chamando a função, não
 * conferindo em que linha do componente os identificadores aparecem.
 *
 * ## As duas chaves, e por que são duas
 *
 * - `janela` ignora a loja de propósito. A primeira ida da tela sai SEM
 *   `connection_id` para o servidor resolver a loja padrão (é o corte de
 *   cascata de 28/08/2026). Quando o `status` chega e o componente resolve a
 *   mesma padrão, é a `janela` que reconhece: a resposta que está vindo já é
 *   daquela pergunta.
 * - `alvo` acrescenta a loja. É a identidade completa: duas lojas na mesma
 *   janela são perguntas diferentes e as duas têm de sair.
 */
export interface GatilhosDaBusca {
  /** Loja resolvida, ou `null` enquanto quem resolve é o servidor. */
  loja: string | null;
  /** `period.query` — o recorte escolhido. */
  periodo: string;
  /** Paginação do período. */
  offset: string;
  /** Sobe quando a pessoa manda tentar de novo. */
  tentativa: number;
  /** Sobe a cada volta do acompanhamento da primeira sincronização. */
  sincronizacao: number;
}

export function chaveDaBusca(g: GatilhosDaBusca): { janela: string; alvo: string } {
  const janela = `${g.periodo}|${g.offset}|${g.tentativa}|${g.sincronizacao}`;
  return { janela, alvo: `${g.loja ?? ""}|${janela}` };
}
