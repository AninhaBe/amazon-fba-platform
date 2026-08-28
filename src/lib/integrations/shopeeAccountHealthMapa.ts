/**
 * Mapa de códigos e rótulos do account_health da Shopee — o ÚNICO lugar que
 * traduz código numérico em texto (regra do cérebro, 28/08/2026: a tela lê do
 * mapa, nada de hardcode espalhado). Cada mapa declara a FONTE; código sem
 * fonte NÃO entra aqui e a tela o exibe como "código N da Shopee" via
 * `rotuloDeCodigo` — nunca texto inventado. O espelho documentado (com as
 * fontes) vive em docs/api-shopee.md → "Account Health: códigos observados".
 */

/**
 * Nota geral 1–4. Fonte: os 4 tiers do Account Health do Seller Centre
 * (Poor / Improvement Needed / Good / Excellent); rating 2 conferido contra a
 * loja real em 28/08/2026 (3 métricas reprovadas = "Precisa melhorar").
 */
export const NOTA_GERAL: Record<number, string> = {
  1: "Ruim",
  2: "Precisa melhorar",
  3: "Boa",
  4: "Excelente",
};

/**
 * Grupo da métrica (`metric_type`). Fonte: observado na sonda de 28/08/2026 —
 * o tipo 1 agrupa as métricas de envio (late_shipment, non_fulfillment...),
 * o 2 as de anúncio (violations, pre_order) e o 3 as de atendimento
 * (response_rate, shop_rating); bate com os grupos failed do
 * overall_performance (fulfillment/listing/custom_service).
 */
export const GRUPO_DA_METRICA: Record<number, string> = {
  1: "Envio",
  2: "Anúncios",
  3: "Atendimento",
};

/**
 * Nome da métrica em português. Fonte: `metric_name` da própria API (sonda de
 * 28/08/2026); a tradução é apresentação nossa. Métrica fora do mapa exibe o
 * `metric_name` cru — legível, nunca inventado.
 */
export const NOME_DA_METRICA: Record<string, string> = {
  late_shipment_rate: "Taxa de envio atrasado",
  non_fulfillment_rate: "Taxa de não conclusão",
  cancellation_rate: "Taxa de cancelamento",
  return_refund_rate: "Taxa de devolução/reembolso",
  response_rate: "Taxa de resposta ao comprador",
  shop_rating: "Avaliação da loja",
  pre_order_listing_rate: "Taxa de anúncios sob encomenda",
  the_amount_of_pre_order_listing: "Anúncios sob encomenda",
  severe_listing_violations: "Violações graves de anúncio",
  other_listing_violations: "Outras violações de anúncio",
  prohibited_listings: "Anúncios proibidos",
  counterfeit_ip_infringement: "Falsificação/violação de marca",
  spam_listings: "Anúncios com spam",
  pqr_products: "Produtos com problema de qualidade",
  saturday_shipment_rate: "Taxa de envio aos sábados",
  avg_preparation_time_ps: "Tempo médio de preparo",
};

/**
 * Unidade do valor (`unit`). Fonte: observado na sonda — 2 acompanha as taxas
 * percentuais, 1 os números puros (avaliação, contagens), 4 o tempo de preparo
 * em dias. Unidade fora do mapa não formata: exibe o número cru.
 */
export const UNIDADE: Record<number, (valor: number) => string> = {
  1: (valor) => String(valor),
  2: (valor) => `${valor}%`,
  4: (valor) => `${valor} dia(s)`,
};

/**
 * Situação vigente/encerrada de punição (`punishment_status`, parâmetro
 * OBRIGATÓRIO do get_punishment_history). Fonte: observado na sonda —
 * status=1 devolveu as vigentes (0 na loja real), status=2 o histórico (12).
 */
export const PUNICAO_VIGENTE = 1;
export const PUNICAO_ENCERRADA = 2;

// ⚠️ SEM FONTE (a doc oficial não é acessível fora do console): os códigos de
// punishment_type (107/108/2008...), reason, violation_type e o reason de
// get_listings_with_issues ficam SEM mapa de propósito — a tela mostra
// "código N da Shopee". Ao conseguir a doc oficial, o mapa entra aqui e no
// espelho do docs/api-shopee.md com a fonte datada.

/** Rótulo de um código: o mapeado, ou a forma honesta de dizer que não sabemos. */
export function rotuloDeCodigo(mapa: Record<number, string>, codigo: number): string {
  return mapa[codigo] ?? `código ${codigo} da Shopee`;
}

export type SituacaoDaMetrica = "ok" | "reprovada" | null;

/**
 * Situação calculada pelo comparador da PRÓPRIA API — nunca alvo chutado por
 * nós. Valor null = situação null (a tela mostra "—" sem julgar).
 */
export function situacaoDaMetrica(entrada: {
  valorAtual: number | null;
  alvo: number;
  comparador: string;
}): SituacaoDaMetrica {
  const { valorAtual, alvo, comparador } = entrada;
  if (valorAtual == null) return null;
  switch (comparador) {
    case "<": return valorAtual < alvo ? "ok" : "reprovada";
    case "<=": return valorAtual <= alvo ? "ok" : "reprovada";
    case ">": return valorAtual > alvo ? "ok" : "reprovada";
    case ">=": return valorAtual >= alvo ? "ok" : "reprovada";
    // Comparador desconhecido: não julga (melhor "—" que veredito errado).
    default: return null;
  }
}

/**
 * Ações de saúde da conta para o BriefingLead (adição do cérebro, 28/08/2026):
 * a chamada carrega o NÚMERO e o que fazer — a métrica mais distante do alvo,
 * com valor e alvo da própria Shopee —, nunca um rótulo genérico. Sem dado de
 * saúde (fetch falhou, demo), devolve vazio: degradação limpa, nada inventado.
 * Vive aqui (e não no WorkspaceModel) porque este módulo não importa nada — o
 * harness de teste do model transpila o fonte e não resolve import de runtime.
 */
export function acoesDeSaude(saude?: {
  metricas: Array<{ nome: string; valorAtual: number | null; alvo: number | null; comparador: string | null; unidade: number | null; situacao: SituacaoDaMetrica }>;
  punicoesVigentes: unknown[];
  anunciosComProblema: unknown[];
} | null): Array<{ label: string; href: string; tone: "pendencia" | "alerta" }> {
  if (!saude) return [];
  const acoes: Array<{ label: string; href: string; tone: "pendencia" | "alerta" }> = [];
  const reprovadas = saude.metricas.filter((metrica) => metrica.situacao === "reprovada");
  if (reprovadas.length > 0) {
    // A mais distante do alvo, em termos relativos — é a que merece o texto.
    const pior = [...reprovadas].sort((a, b) => distanciaDoAlvo(b) - distanciaDoAlvo(a))[0];
    const detalhe = pior.valorAtual != null && pior.alvo != null
      ? ` — ${NOME_DA_METRICA[pior.nome] ?? pior.nome} está em ${formatoDeSaude(pior.valorAtual, pior.unidade)} (alvo ${formatoDeSaude(pior.alvo, pior.unidade)})`
      : "";
    acoes.push({ label: `${reprovadas.length} métrica(s) reprovada(s) na Shopee${detalhe}`, href: "/shopee/saude", tone: "alerta" });
  }
  if (saude.punicoesVigentes.length > 0) {
    acoes.push({ label: `${saude.punicoesVigentes.length} punição(ões) vigente(s) na Shopee`, href: "/shopee/saude", tone: "alerta" });
  }
  if (saude.anunciosComProblema.length > 0) {
    acoes.push({ label: `${saude.anunciosComProblema.length} anúncio(s) com problema na Shopee`, href: "/shopee/saude", tone: "pendencia" });
  }
  return acoes;
}

function distanciaDoAlvo(metrica: { valorAtual: number | null; alvo: number | null }): number {
  if (metrica.valorAtual == null || metrica.alvo == null || metrica.alvo === 0) return 0;
  return Math.abs(metrica.valorAtual - metrica.alvo) / Math.abs(metrica.alvo);
}

/** Valor com a unidade da API quando mapeada; número cru quando não. */
export function formatoDeSaude(valor: number, unidade: number | null): string {
  const formatar = unidade != null ? UNIDADE[unidade] : undefined;
  return formatar ? formatar(valor) : String(valor);
}
