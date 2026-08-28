/**
 * Anúncio contra MARGEM REAL — a peça que transforma relatório em decisão.
 *
 * O canal sabe o que a campanha vendeu; ele NÃO sabe o custo do produto nem as
 * tarifas que cobrou depois. Só o NEXO tem os dois lados, e é por isso que só
 * aqui cabe a frase que a vendedora precisa: *"esta campanha vende com ACOS de
 * 18% num produto de margem 14% — você paga para vender"*.
 *
 * ⚠️ ACOS E ROAS VÊM DA FONTE, e são gravados como vieram (migration 0016).
 * Este módulo NÃO recalcula: a janela de atribuição do canal (14 dias por clique
 * na Amazon, própria no ML) não é a mesma dos totais da tela, e um ACOS
 * recalculado divergiria do painel do próprio canal — a vendedora veria dois
 * números para a mesma campanha e não confiaria em nenhum.
 *
 * ⚠️ ZERO DA FONTE NÃO É ZERO DE VERDADE (medido pelo Delta em 28/08/2026, na
 * sonda do PADS: campanha com R$ 0,52 gastos, 1 clique e NENHUMA venda voltou
 * com `acos: 0`). Exibir "ACOS 0%" leria como desempenho excelente sendo o pior
 * caso possível: dinheiro saindo sem retorno. É o `null ≠ 0` do AGENTS.md
 * aparecendo DENTRO da fonte — por isso a decisão nunca olha `acos` sozinho, e
 * sim `cost` e `purchases` juntos.
 */

export type SituacaoDoAnuncio =
  /** Sem gasto e sem venda: a campanha não rodou neste período. */
  | "sem-atividade"
  /** Gastou e NÃO vendeu nada. O pior caso — e o mais fácil de esconder. */
  | "gasto-sem-venda"
  /** Vendeu, mas o anúncio come mais que a margem: paga para vender. */
  | "paga-para-vender"
  /** Vendeu com o anúncio cabendo na margem. */
  | "lucra"
  /** Vendeu, mas a margem real do SKU não é conhecida — sem veredito. */
  | "margem-desconhecida";

export interface LinhaDeAnuncio {
  /** Gasto do período, sempre conhecido (a fonte entrega o que já saiu do bolso). */
  cost: number;
  /** Vendas ATRIBUÍDAS pela fonte, na janela dela. */
  sales: number;
  /** Pedidos atribuídos pela fonte. É o que distingue "0% ótimo" de "não vendeu". */
  purchases: number;
  /** ACOS como a FONTE mandou, em percentual. `null` = a fonte não informou. */
  acos: number | null;
  /**
   * Margem real do SKU em percentual, calculada pelo NEXO (custo + tarifas).
   * `null` quando falta custo cadastrado ou repasse — e aí NÃO há veredito.
   */
  margemRealPct: number | null;
}

export interface VereditoDoAnuncio {
  situacao: SituacaoDoAnuncio;
  /** Frase curta e concreta. Nunca um adjetivo que se desculpa. */
  frase: string;
  /** O que fazer, quando há o que fazer. */
  acao: string | null;
}

/**
 * O veredito de UMA linha (SKU anunciado num período).
 *
 * A ordem das perguntas é deliberada: primeiro "houve gasto?", depois "houve
 * venda?", e só então "a margem é conhecida?". Inverter faria uma campanha que
 * torrou dinheiro sem vender cair no caminho de "margem desconhecida" e sumir
 * atrás de uma pendência de cadastro.
 */
export function avaliarAnuncio(linha: LinhaDeAnuncio): VereditoDoAnuncio {
  const { cost, purchases, acos, margemRealPct } = linha;

  if (cost <= 0 && purchases <= 0) {
    return { situacao: "sem-atividade", frase: "Sem gasto e sem venda no período", acao: null };
  }

  if (purchases <= 0) {
    // O caso que o `acos: 0` da fonte esconderia.
    return {
      situacao: "gasto-sem-venda",
      frase: `Gastou ${dinheiro(cost)} e não teve venda atribuída`,
      acao: "Revise o anúncio ou pause a campanha",
    };
  }

  if (margemRealPct == null) {
    return {
      situacao: "margem-desconhecida",
      frase: acos == null
        ? "Vendeu, mas falta a margem real deste produto"
        : `ACOS de ${pct(acos)} — falta a margem real para saber se compensa`,
      acao: "Cadastre o custo deste produto",
    };
  }

  // Sem ACOS da fonte não afirmamos veredito: recalcular por conta própria é o
  // que este módulo existe para não fazer.
  if (acos == null) {
    return {
      situacao: "margem-desconhecida",
      frase: `Margem real de ${pct(margemRealPct)}, mas o canal não informou o ACOS`,
      acao: null,
    };
  }

  if (acos >= margemRealPct) {
    return {
      situacao: "paga-para-vender",
      frase: `ACOS de ${pct(acos)} num produto de margem ${pct(margemRealPct)} — você paga para vender`,
      acao: "Reduza o lance ou ajuste o preço",
    };
  }

  return {
    situacao: "lucra",
    frase: `ACOS de ${pct(acos)} cabe na margem de ${pct(margemRealPct)}`,
    acao: null,
  };
}

/** Quantas linhas merecem atenção — o número que vai para a chamada do briefing. */
export function contarAlertas(linhas: LinhaDeAnuncio[]): { pagaParaVender: number; gastoSemVenda: number } {
  let pagaParaVender = 0;
  let gastoSemVenda = 0;
  for (const linha of linhas) {
    const { situacao } = avaliarAnuncio(linha);
    if (situacao === "paga-para-vender") pagaParaVender += 1;
    if (situacao === "gasto-sem-venda") gastoSemVenda += 1;
  }
  return { pagaParaVender, gastoSemVenda };
}

function pct(valor: number): string {
  return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function dinheiro(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
