// A REGRA DE COBERTURA DE ESTOQUE — sem canal, sem API, sem banco.
//
// Mora sozinha de propósito. Antes vivia dentro de `radar.ts`, que importa
// inventário, anúncios e velocidade da SP-API: qualquer canal que quisesse a
// mesma classificação arrastaria a Amazon junto. O Mercado Livre, por isso,
// escreveu uma cópia própria — e a cópia estava errada.
//
// ⚠️ O defeito que isto corrige (24/08/2026): a versão do ML tinha três status
// (`out` / `critical` / `ok`) e **tudo que não era esgotado nem crítico caía em
// "Saudável" — inclusive o que não dava para calcular**. Um anúncio com 1
// unidade e zero venda no período aparecia como saudável. É o `null ≠ 0` do
// AGENTS.md invertido: ausência de velocidade virando atestado de saúde.
//
// Ela viu na tela: *"tenho 1 em estoque e é saudável? caraca"*.

export type StockStatus = "out" | "critical" | "low" | "ok" | "overstock" | "idle" | "desconhecido";

// Limiares de dias para classificar a urgência.
//
// Exportados porque o TikTok filtra em SQL e precisa dos MESMOS números: ele
// usava 15 dias para "low" — um terceiro limiar, além dos 10 e 21 daqui — e um
// produto classificado de um jeito na consulta e de outro na tela é pior que
// não classificar.
export const CRITICAL_DAYS = 10; // repor já (menos que o lead time típico do FBA)
export const LOW_DAYS = 21; // repor em breve
export const OVERSTOCK_DAYS = 120; // parado demais, pagando armazenagem

/** Urgência do radar: quem acaba antes primeiro, sem venda no fim. */
export const ORDEM_DO_RADAR: Record<StockStatus, number> = {
  out: 0,
  critical: 1,
  low: 2,
  ok: 3,
  overstock: 4,
  idle: 5,
  // Último de propósito: desconhecido NÃO É URGÊNCIA, é lacuna. Colocá-lo entre
  // os urgentes faria a lista de reposição começar por itens sobre os quais não
  // se sabe nada.
  desconhecido: 6,
};

/** O mesmo nome para o mesmo estado, em todo canal. */
export const ROTULO_DE_COBERTURA: Record<StockStatus, string> = {
  out: "Esgotado",
  critical: "Repor já",
  low: "Repor em breve",
  ok: "Saudável",
  overstock: "Excesso",
  idle: "Sem venda",
  // Diz o que É, não pede desculpa. "Parcial" e "incompleto" são proibidos: a
  // pessoa já sabe que falta algo — ela precisa saber O QUÊ.
  desconhecido: "Estoque não informado",
};

/**
 * `aCaminho` é opcional porque nem todo canal tem reposição em trânsito — o FBA
 * tem, o anúncio do Mercado Livre não.
 */
export function classificarCobertura(input: {
  /**
   * `null` = A FONTE NÃO INFORMOU. Nunca converta para 0 antes de chamar aqui:
   * `disponivel ?? 0` transforma ignorância em fato e é exatamente o defeito que
   * a ADR-033 fecha — 435 dos 747 anúncios da Shopee estavam nesse estado.
   */
  disponivel: number | null;
  aCaminho?: number;
  porDia: number;
  diasRestantes: number | null;
}): StockStatus {
  const { disponivel, aCaminho = 0, porDia, diasRestantes } = input;
  // ⚠️ ANTES DE QUALQUER OUTRA CLASSIFICAÇÃO (ADR-033). Sem estoque conhecido não
  // dá para dizer "esgotado" nem "saudável" — as duas seriam afirmação sobre o
  // que ninguém informou. E "esgotado" é a pior das duas: vira alarme de
  // reposição para produto que talvez esteja cheio.
  if (disponivel == null) return "desconhecido";
  if (disponivel <= 0 && aCaminho <= 0) return "out";
  // Sem venda no período não é "saudável": é desconhecido. Sem velocidade não
  // existe previsão de ruptura, e afirmar cobertura seria inventar.
  if (porDia <= 0) return disponivel > 0 ? "idle" : "out";
  if (diasRestantes == null) return "idle";
  if (diasRestantes <= CRITICAL_DAYS) return "critical";
  if (diasRestantes <= LOW_DAYS) return "low";
  if (diasRestantes >= OVERSTOCK_DAYS) return "overstock";
  return "ok";
}
