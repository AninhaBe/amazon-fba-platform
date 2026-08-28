/**
 * Anúncio inativo não vai para a frente de quem está cadastrando custo.
 *
 * ## Por que isto existe
 *
 * Medido em 28/08/2026, na loja real da dona:
 *
 * | canal | ativos | inativos |
 * |---|---:|---:|
 * | Mercado Livre | 26 | **367** |
 * | Shopee | 107 | **265** |
 * | TikTok | 15 | **85** |
 *
 * A frase dela sobre a Shopee é literal: *"dou de cara com mais de 300 anúncios
 * inativos que não tenho menor interesse de cadastrar custo pra eles"*. No
 * Mercado Livre a proporção é pior ainda — 14 inativos para cada ativo.
 *
 * ## A regra
 *
 * O padrão passa a ser **só os ativos**. O inativo **não some do produto**: o
 * seletor continua oferecendo "todos" e "só inativos", e a tela diz quantos
 * ficaram de fora. Esconder sem dizer seria remover informação — o que esta casa
 * não faz; o que se faz é tirar o irrelevante do caminho e dizer que se tirou.
 *
 * ⚠️ O filtro é do SERVIDOR, de propósito. Filtrar no cliente deixaria o
 * "Exibindo 1–50 de 372" contando o que a tela não mostra, e a paginação pularia
 * páginas inteiras de nada.
 */

export type FiltroDeAtividade = "ativos" | "inativos" | "todos";

/** Status canônico que conta como anúncio vivo. Os outros (`paused`, `closed`) não. */
export const STATUS_ATIVO = "active";

export function filtroDeAtividadeRequest(
  params: URLSearchParams,
  padrao: FiltroDeAtividade = "ativos"
): FiltroDeAtividade {
  const bruto = params.get("atividade");
  if (bruto === "ativos" || bruto === "inativos" || bruto === "todos") return bruto;
  // Valor desconhecido cai no padrão em vez de derrubar a página: é filtro de
  // conveniência, e um parâmetro torto na URL não pode custar a tela inteira.
  return padrao;
}

/**
 * Fragmento de SQL para o filtro, com a coluna de status parametrizada pelo
 * chamador (cada canal nomeia a sua) e o índice do parâmetro do status ativo.
 *
 * Devolve string vazia para "todos" — sem cláusula, sem parâmetro extra.
 */
export function condicaoDeAtividade(coluna: string, indiceDoParametro: number, filtro: FiltroDeAtividade): string {
  if (filtro === "todos") return "";
  if (filtro === "ativos") return ` AND ${coluna} = $${indiceDoParametro}`;
  return ` AND ${coluna} <> $${indiceDoParametro}`;
}

/** Quantos anúncios o filtro está deixando de fora — o número que a tela mostra. */
export function ocultadosPeloFiltro(total: number, exibidos: number): number {
  return Math.max(0, total - exibidos);
}
