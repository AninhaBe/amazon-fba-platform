// Lógica pura da Visão geral (central multicanal), separada de page.tsx porque
// aquele arquivo é "use client" e não carrega em teste. Aqui não entra React:
// só o cálculo da tendência semanal, da margem e do alerta ("ele levanta a mão").

/** Ponto diário de faturamento — a forma que os canais já devolvem. */
export interface PontoDiario {
  date: string;
  revenue: number;
  orders: number;
  units: number;
}

/** O mínimo que o alerta e a margem precisam saber de um canal. */
export interface CanalParaAlerta {
  id: string;
  name: string;
  href: string;
  connected: boolean;
  error?: string;
  revenue: number | null;
  profit: number | null;
  profitPartial?: boolean;
  unitsWithoutCost?: number;
  currency: string;
  series?: PontoDiario[];
}

export function percent(value: number | null): string {
  if (value == null) return "—";
  return `${value >= 0 ? "" : "−"}${Math.abs(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function money(value: number | null, currency = "BRL"): string {
  if (value == null) return "Indisponível";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

/**
 * Tendência de 7 dias contra os 7 anteriores, a partir da própria série diária —
 * sem uma segunda consulta. Usa as datas presentes, não posições fixas: se um dia
 * não tem ponto, ele simplesmente não entra, em vez de deslocar a janela.
 *
 * `deltaPct` é `null` quando não há base anterior (canal novo, semana sem venda):
 * variação percentual sobre zero seria infinito, não "cresceu muito".
 */
export function tendenciaSemanal(points: PontoDiario[] | undefined): {
  ultimos7: number;
  anteriores7: number;
  deltaAbs: number;
  deltaPct: number | null;
} {
  const ordenados = [...(points ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const ultimos7 = ordenados.slice(-7).reduce((soma, p) => soma + p.revenue, 0);
  const anteriores7 = ordenados.slice(-14, -7).reduce((soma, p) => soma + p.revenue, 0);
  const deltaAbs = Math.round((ultimos7 - anteriores7) * 100) / 100;
  const deltaPct = anteriores7 > 0 ? Math.round(((ultimos7 - anteriores7) / anteriores7) * 1000) / 10 : null;
  return { ultimos7, anteriores7, deltaAbs, deltaPct };
}

/** Margem do canal: só existe quando lucro E faturamento são conhecidos e positivos. */
export function margemDoCanal(channel: { revenue: number | null; profit: number | null }): number | null {
  if (channel.profit == null || channel.revenue == null || channel.revenue <= 0) return null;
  return Math.round((channel.profit / channel.revenue) * 1000) / 10;
}

export interface AlertaCentral {
  tom: "atencao" | "positivo";
  texto: string;
  href?: string;
}

/**
 * O "ele levanta a mão" da central: UMA frase, a coisa mais importante entre todos
 * os canais agora. Ordem de prioridade — o que exige ação ganha do que é só
 * informação, e problema ganha de elogio.
 *
 * Só afirma o que os dados sustentam: canal sem leitura, custo faltando, queda ou
 * alta de faturamento medida na própria série. Nada de anomalia inventada.
 */
export function detectarAlerta(channels: CanalParaAlerta[]): AlertaCentral | null {
  // 1. Canal conectado que parou de responder — é o mais acionável.
  const semLeitura = channels.find((c) => c.connected && c.error);
  if (semLeitura) {
    return { tom: "atencao", texto: `${semLeitura.name}: conectado, mas sem leitura — revisar a integração.`, href: "/integracoes" };
  }
  // 2. Custo faltando: o lucro do canal está subestimado, e a pessoa não vê isso no número.
  const semCusto = channels
    .filter((c) => c.connected && (c.unitsWithoutCost ?? 0) > 0)
    .sort((a, b) => (b.unitsWithoutCost ?? 0) - (a.unitsWithoutCost ?? 0))[0];
  if (semCusto) {
    return { tom: "atencao", texto: `${semCusto.name}: ${semCusto.unitsWithoutCost} unidade(s) vendida(s) sem custo cadastrado — o lucro do canal está subestimado.`, href: semCusto.href };
  }
  // 3. Maior variação de faturamento na semana (queda antes de alta).
  const comTendencia = channels
    .filter((c) => c.connected && !c.error && c.series?.length)
    .map((c) => ({ canal: c, t: tendenciaSemanal(c.series) }))
    .filter((x) => x.t.deltaPct != null);
  const queda = comTendencia.filter((x) => (x.t.deltaPct ?? 0) <= -15).sort((a, b) => (a.t.deltaPct ?? 0) - (b.t.deltaPct ?? 0))[0];
  if (queda) {
    // "caiu" já é o sinal de negativo; percent() do valor absoluto evita o "−100%".
    return { tom: "atencao", texto: `${queda.canal.name}: faturamento caiu ${percent(Math.abs(queda.t.deltaPct ?? 0))} na semana (${money(queda.t.anteriores7, queda.canal.currency)} → ${money(queda.t.ultimos7, queda.canal.currency)}).`, href: queda.canal.href };
  }
  const alta = comTendencia.filter((x) => (x.t.deltaPct ?? 0) >= 15).sort((a, b) => (b.t.deltaPct ?? 0) - (a.t.deltaPct ?? 0))[0];
  if (alta) {
    return { tom: "positivo", texto: `${alta.canal.name} puxou a operação: +${percent(alta.t.deltaPct)} de faturamento na semana.`, href: alta.canal.href };
  }
  return null;
}
