// Capital parado no Full do Mercado Livre: quantidade em estoque × custo vigente.
//
// Módulo puro, sem banco nem rede — a regra de contagem é o miolo da feature e
// precisa ser lida (e testada) sem subir infraestrutura.
//
// ⚠️ POR QUE NÃO É `SUM(available_qty)`
//
// No Full o estoque vive no PRODUTO DO VENDEDOR (`user_product`), não no
// anúncio. Vários anúncios — o do catálogo e o próprio, por exemplo — apontam
// para o mesmo estoque físico e cada um reporta a MESMA `available_quantity`.
// Medido em 27/08/2026 no banco de produção: o SKU `AREIA-MAGICA-300G` aparece
// em 3 ofertas Full, todas com 159 unidades. Somar daria 477 e triplicaria o
// capital; o estoque real é 159. `MESA-INFANTIL-MELI`: 2 ofertas, 213 cada,
// soma 426.
//
// Por isso a unidade de contagem é o GRUPO de ofertas que dividem estoque, e a
// quantidade do grupo é o MÁXIMO entre as ofertas — nunca a soma.
//
// ⚠️ A CHAVE BOA AINDA NÃO ESTÁ NO BANCO
//
// O identificador certo é o `user_product_id` do ML, que o sync já lê de
// `/items` (`mercadoLivre.ts:216`) — mas na mesma medição só **1 de 29** ofertas
// Full com estoque tinha o campo preenchido; as 3 do AREIA vinham `null`. Então
// ele é usado quando existe e o SKU é o desempate. Duas ofertas com o mesmo SKU
// são, por definição de SKU, o mesmo produto — e no Full, o mesmo estoque.
// Oferta sem `user_product_id` e sem SKU não tem como ser agrupada: fica sozinha
// e o campo `agrupadoPor` diz isso, para a tela não afirmar precisão que não tem.

export interface OfertaFull {
  externalProductId: string;
  sku: string | null;
  title: string;
  availableQty: number;
  userProductId: string | null;
}

export type ChaveDeAgrupamento = "user_product" | "sku" | "oferta";

export interface ItemFull {
  /** Título do anúncio representante do grupo. */
  produto: string;
  sku: string | null;
  qtyFull: number;
  /** `null` = custo não cadastrado. NUNCA zero por omissão. */
  custoUnitario: number | null;
  /** `null` sempre que `custoUnitario` for `null` — não se estima subtotal. */
  subtotal: number | null;
  /** Ofertas que dividem este estoque. Mais de uma é o caso do catálogo. */
  ofertas: string[];
  agrupadoPor: ChaveDeAgrupamento;
}

export interface CustoDoFull {
  itens: ItemFull[];
  /**
   * Soma dos subtotais CONHECIDOS. `null` quando nenhum item tem custo — aí não
   * é "R$ 0,00 parado no Full", é "ainda não dá para dizer".
   */
  total: number | null;
  moeda: string;
  unidades: number;
  unidadesComCusto: number;
  unidadesSemCusto: number;
  /** Quantos itens ficaram fora do total por falta de custo. */
  itensSemCusto: number;
}

const round2 = (valor: number) => +valor.toFixed(2);

function chaveDe(oferta: OfertaFull): { chave: string; tipo: ChaveDeAgrupamento } {
  if (oferta.userProductId) return { chave: `up:${oferta.userProductId}`, tipo: "user_product" };
  if (oferta.sku) return { chave: `sku:${oferta.sku}`, tipo: "sku" };
  return { chave: `item:${oferta.externalProductId}`, tipo: "oferta" };
}

/**
 * @param ofertas Anúncios com `fulfillment = platform` (Full) do canônico.
 * @param custoDe Custo unitário VIGENTE HOJE do SKU, ou `null` se não cadastrado.
 *                É foto do estoque atual: a vigência é a de hoje, não histórica.
 */
export function custoDoEstoqueNoFull(
  ofertas: OfertaFull[],
  custoDe: (oferta: OfertaFull) => number | null,
  moeda = "BRL"
): CustoDoFull {
  const grupos = new Map<string, { ofertas: OfertaFull[]; tipo: ChaveDeAgrupamento }>();
  // Estoque zerado não é capital parado: fica fora da lista inteira.
  for (const oferta of ofertas.filter((item) => item.availableQty > 0)) {
    const { chave, tipo } = chaveDe(oferta);
    const grupo = grupos.get(chave);
    if (grupo) grupo.ofertas.push(oferta);
    else grupos.set(chave, { ofertas: [oferta], tipo });
  }

  const itens: ItemFull[] = [...grupos.values()].map(({ ofertas: doGrupo, tipo }) => {
    // MÁXIMO, não soma: ver o cabeçalho deste arquivo.
    const qtyFull = Math.max(...doGrupo.map((oferta) => oferta.availableQty));
    // Basta uma oferta do grupo ter custo: é o mesmo produto.
    const custoUnitario = doGrupo.map(custoDe).find((custo) => custo != null) ?? null;
    const representante = doGrupo.find((oferta) => oferta.availableQty === qtyFull) ?? doGrupo[0];
    return {
      produto: representante.title,
      sku: representante.sku,
      qtyFull,
      custoUnitario,
      subtotal: custoUnitario == null ? null : round2(custoUnitario * qtyFull),
      ofertas: doGrupo.map((oferta) => oferta.externalProductId),
      agrupadoPor: tipo,
    };
  });

  // Maior capital primeiro; sem custo vai para o fim, onde a pendência explica.
  itens.sort((a, b) => (b.subtotal ?? -1) - (a.subtotal ?? -1) || b.qtyFull - a.qtyFull);

  const comCusto = itens.filter((item) => item.subtotal != null);
  return {
    itens,
    total: comCusto.length ? round2(comCusto.reduce((soma, item) => soma + item.subtotal!, 0)) : null,
    moeda,
    unidades: itens.reduce((soma, item) => soma + item.qtyFull, 0),
    unidadesComCusto: comCusto.reduce((soma, item) => soma + item.qtyFull, 0),
    unidadesSemCusto: itens.filter((item) => item.subtotal == null).reduce((soma, item) => soma + item.qtyFull, 0),
    itensSemCusto: itens.length - comCusto.length,
  };
}
