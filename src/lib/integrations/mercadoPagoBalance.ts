// Saldo e liberação do Mercado Livre, via API do Mercado Pago.
//
// Mesma pergunta que o bloco da Amazon responde — "o que eu tenho hoje e quando
// cai" — mas a fonte é outra e entrega mais: o MP informa o **líquido real**
// (`net_received_amount`), enquanto na Amazon o líquido é deduzido das tarifas
// postadas.
//
// Descoberto em 15/08/2026: a API do MP abre com o MESMO token do ML, só
// trocando o host para `api.mercadopago.com`. Detalhes e medições em
// `docs/api-mercado-livre.md`.
//
// Módulo puro, sem dependências, para ser testável.

export interface PagamentoMP {
  id?: number | string;
  status?: string;
  /** `pending` enquanto o dinheiro está retido. */
  money_release_status?: string | null;
  money_release_date?: string | null;
  transaction_amount?: number | null;
  transaction_details?: { net_received_amount?: number | null } | null;
  order?: { id?: number | string } | null;
}

export interface LiberacaoML {
  /** Dia da liberação (fuso de São Paulo). */
  date: string;
  amount: number;
  pagamentos: number;
}

export interface SaldoMercadoLivre {
  currency: string;
  /** Total ainda retido pelo Mercado Pago. */
  retido: number;
  /** Já liberado dentro da janela lida — NÃO é o saldo da conta. */
  liberadoNaJanela: number;
  liberacoes: LiberacaoML[];
  /** Pagamentos com liberação futura contabilizados. */
  pagamentosLidos: number;
  /**
   * Quantos existem no total segundo o `paging.total` da busca. Maior que
   * `pagamentosLidos` significa que a leitura parou no orçamento de páginas.
   */
  pagamentosTotais: number;
  /**
   * `true` quando não lemos tudo. O painel precisa DIZER isso: um total parcial
   * exibido como se fosse completo faz a pessoa planejar caixa com um número
   * menor que a realidade.
   */
  parcial: boolean;
}

const round = (v: number) => +v.toFixed(2);

function diaDe(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/**
 * O que entra no saldo é o **líquido**, não o valor pago pelo comprador: a
 * tarifa do ML e o frete já saem antes de o dinheiro cair. Sem
 * `net_received_amount`, o pagamento é ignorado em vez de entrar pelo bruto —
 * inflar o saldo é pior que omitir uma linha.
 */
function liquidoDe(pagamento: PagamentoMP): number | null {
  const liquido = pagamento.transaction_details?.net_received_amount;
  return typeof liquido === "number" && Number.isFinite(liquido) ? liquido : null;
}

export function calcularSaldoML(
  pagamentos: readonly PagamentoMP[],
  input: { agora: Date; totalDaBusca?: number; currency?: string }
): SaldoMercadoLivre {
  const agora = input.agora.getTime();
  let retido = 0;
  let liberadoNaJanela = 0;
  let pagamentosLidos = 0;
  const porDia = new Map<string, LiberacaoML>();

  for (const pagamento of pagamentos) {
    // Recusado nunca vira dinheiro. Ele chega com `money_release_date: null`, e
    // tratá-lo como retido inventaria um recebimento que não existe.
    if (pagamento.status !== "approved") continue;
    const liquido = liquidoDe(pagamento);
    if (liquido == null) continue;
    if (!pagamento.money_release_date) continue;

    const quando = new Date(pagamento.money_release_date).getTime();
    if (!Number.isFinite(quando)) continue;

    if (quando > agora) {
      retido += liquido;
      pagamentosLidos += 1;
      const dia = diaDe(pagamento.money_release_date);
      const atual = porDia.get(dia) ?? { date: dia, amount: 0, pagamentos: 0 };
      atual.amount = round(atual.amount + liquido);
      atual.pagamentos += 1;
      porDia.set(dia, atual);
    } else {
      liberadoNaJanela += liquido;
    }
  }

  const totalDaBusca = input.totalDaBusca ?? pagamentosLidos;
  return {
    currency: input.currency ?? "BRL",
    retido: round(retido),
    liberadoNaJanela: round(liberadoNaJanela),
    liberacoes: [...porDia.values()].sort((a, b) => a.date.localeCompare(b.date)),
    pagamentosLidos,
    pagamentosTotais: Math.max(totalDaBusca, pagamentosLidos),
    parcial: totalDaBusca > pagamentosLidos,
  };
}
