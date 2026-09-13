/**
 * O CONTRATO DO CANAL — o que o esqueleto v3 precisa saber e não pode adivinhar.
 *
 * ⚠️ POR QUE ISTO EXISTE (12/09/2026). O dashboard da Amazon ficou
 * semanas exibindo a coluna **"Tarifa ML"**, porque `OrderProfitabilityTableV3`
 * nasceu no Mercado Livre e foi reaproveitado inteiro — com o rótulo do canal
 * de origem preso dentro. Ninguém errou uma decisão: a peça estava certa para o
 * canal em que nasceu, e nada ficou vermelho, porque `<span>Tarifa ML</span>` é
 * texto válido em qualquer tela.
 *
 * A regra que isto materializa: **a peça do esqueleto é cega ao canal.** Toda
 * palavra que muda de um marketplace para outro entra por aqui, e entra como
 * campo OBRIGATÓRIO — não `?:`. Campo opcional deixa o segundo sítio esquecer
 * em silêncio; obrigatório faz o compilador apontar os dois (a lição de
 * 11/09/2026 com `app?:`, medida em 5 erros e zero colateral).
 *
 * ⚠️ E ISTO NÃO É "ONDE FICAM AS STRINGS". Só entra aqui o que o
 * esqueleto precisa e o canal decide. Cálculo, endpoint e semântica de dado
 * continuam no canal — replicar é reimplementar com a API de cada um, nunca
 * copiar o mecanismo (AGENTS.md → "APIs dos marketplaces").
 */
export interface CanalV3 {
  /** O mesmo identificador que `workspaceFromPath` devolve. */
  readonly id: "amazon" | "mercado_livre" | "shopee" | "tiktok_shop";
  /** Como a vendedora chama o canal na conversa — vai para título e frase. */
  readonly nome: string;
  /**
   * O nome que ESTE canal dá ao que ele cobra da venda.
   *
   * Não é enfeite: no Mercado Livre é uma tarifa só ("Tarifa ML"); na Amazon
   * são várias somadas — comissão, FBA, armazenagem —, e por isso o plural
   * ("Taxas da Amazon") é o que casa com o cartão da faixa logo acima.
   */
  readonly rotuloDaTarifa: string;
  /**
   * O nome que ESTE canal da ao estoque que ele mesmo guarda.
   *
   * ⚠️ NASCEU DO MESMO DEFEITO, uma hora depois (13/09/2026):
   * assim que a Amazon passou a renderizar `PainelV3Baixo`, a tela dela exibiu
   * **"Radar do FULL"** — FULL e a logistica do Mercado Livre. A peca era
   * "do Mercado Livre" enquanto so um canal a renderizava; virou compartilhada
   * no instante em que o segundo entrou, e a palavra do primeiro veio junto.
   * E a prova de que o contrato nao e burocracia: e o unico lugar onde essa
   * troca acontece uma vez so.
   */
  readonly rotuloDoRadar: string;
}

export const CANAL_MERCADO_LIVRE: CanalV3 = {
  id: "mercado_livre",
  nome: "Mercado Livre",
  rotuloDaTarifa: "Tarifa ML",
  rotuloDoRadar: "Radar do FULL",
};

export const CANAL_AMAZON: CanalV3 = {
  id: "amazon",
  nome: "Amazon",
  // Plural e com o nome do canal: é a MESMA frase do cartão "Taxas da Amazon"
  // na faixa do dashboard. Duas palavras para a mesma coisa, na mesma tela,
  // fazem a vendedora procurar a diferença que não existe.
  rotuloDaTarifa: "Taxas da Amazon",
  // FBA e o nome que a Amazon usa, e o mesmo que aparece na coluna Logistica.
  rotuloDoRadar: "Radar do FBA",
};
