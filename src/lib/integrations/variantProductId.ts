/**
 * O identificador da VARIAÇÃO no canônico — um dialeto só, para todos os canais.
 *
 * ## Por que existe
 *
 * O TikTok já gravava `<anúncio>::sku:<variação>` (`tiktokVariantProductId`), e
 * é o único canal cujo catálogo casa com as vendas: medido em 28/08/2026, 43 de
 * 43 linhas casando, porque **os dois lados** gravam o composto. A Shopee vai
 * passar a fazer o mesmo (ADR-029), e o Mercado Livre no dia em que a dona usar
 * variação lá.
 *
 * Sem uma função única, nasceria um terceiro formato — e o dia em que dois
 * lugares montarem o mesmo id de jeitos diferentes, a junção catálogo × venda
 * cai para zero sem ninguém perceber, porque nenhum dos lados está "errado".
 *
 * ## ⚠️ A condição de atomicidade (achado do Delta)
 *
 * Hoje, na Shopee, o join catálogo × venda casa **41 de 41** porque os dois
 * lados usam o `item_id` base. Se só o catálogo virar composto, **41/41 vira
 * 0/41** — e o radar de estoque, que já casa mal, para de casar qualquer coisa.
 * Catálogo, item de pedido e backfill vão no MESMO lote.
 */

/** O separador. Igual ao que o TikTok já gravou em produção — não mude. */
const SEPARADOR = "::sku:";

/**
 * Monta o id composto do catálogo/venda para uma variação.
 *
 * Devolve o id do anúncio **intacto** quando não há variação — anúncio simples
 * continua exatamente como está hoje, e isso é o que mantém o histórico casando.
 */
export function variantProductId(base: string, variantId?: string | null): string {
  const anuncio = String(base).trim();
  if (!anuncio) throw new TypeError("variantProductId: id do anúncio vazio.");
  const variacao = variantId == null ? "" : String(variantId).trim();
  if (!variacao) return anuncio;
  // ⚠️ Nunca compor duas vezes: se o id já vem composto, montar de novo geraria
  // `a::sku:b::sku:b` e nenhum dos dois lados casaria com o outro.
  if (anuncio.includes(SEPARADOR)) return anuncio;
  return `${anuncio}${SEPARADOR}${variacao}`;
}

/** O anúncio pai de um id composto. Id simples devolve ele mesmo. */
export function baseDoVariantProductId(id: string): string {
  const posicao = id.indexOf(SEPARADOR);
  return posicao === -1 ? id : id.slice(0, posicao);
}

/** A variação de um id composto, ou `null` quando o id é de anúncio simples. */
export function variacaoDoProductId(id: string): string | null {
  const posicao = id.indexOf(SEPARADOR);
  return posicao === -1 ? null : id.slice(posicao + SEPARADOR.length) || null;
}

/**
 * O título da linha da variação, legível para quem vai cadastrar custo.
 *
 * Condição do cérebro (29/08/2026): *"'Papel de Parede 10 Metros - Madeira
 * Preta' é útil; 'Papel de Parede 10 Metros - 8271639' não é"*. E o pior caso é
 * repetir o título do anúncio: a dona veria N linhas idênticas e não saberia
 * qual é qual.
 *
 * Ordem: nome da variação → SKU da variação → "variação sem nome".
 */
export function tituloDaVariacao(
  tituloDoAnuncio: string,
  nomeDaVariacao?: string | null,
  skuDaVariacao?: string | null,
  totalDeVariacoes = 2,
): string {
  // Anúncio de variação única não ganha sufixo — não há o que distinguir.
  if (totalDeVariacoes <= 1) return tituloDoAnuncio;
  const nome = (nomeDaVariacao ?? "").trim();
  const sku = (skuDaVariacao ?? "").trim();
  const sufixo = nome || sku || "variação sem nome";
  return `${tituloDoAnuncio} · ${sufixo}`;
}
