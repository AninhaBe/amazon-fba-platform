// Saldo e liberação da Amazon — responde "o que eu tenho hoje e o que vai ser
// descontado", que é a pergunta que o dashboard não respondia.
//
// A confusão que isto resolve: o painel mostrava lucro de R$ 20,04 enquanto o
// app da Amazon dizia "Fundos disponíveis: −R$ 6,12" e anunciava uma cobrança.
// Não é contradição — a Amazon RETÉM o dinheiro das vendas até depois da
// entrega, então o saldo disponível só enxerga a despesa. Sem essa tela, o
// número certo assusta.
//
// Fontes (medidas na SP-API em 15/08/2026, conta AO62LVXJMX3AA):
//
//   /finances/v0/financialEventGroups  → `OriginalTotal` do grupo `Open` é
//     exatamente o "Fundos disponíveis agora" do Seller Central (−6,12), e
//     `FinancialEventGroupStart` é o "Seu extrato para 5 de jul. – Presente".
//     A conta tem DOIS grupos abertos (accountType "Mastercard Credit & Other"
//     e "Boleto"): a Amazon Brasil separa extrato por meio de pagamento do
//     comprador, então o saldo é a SOMA deles.
//
//   /finances/2024-06-19/transactions  → `transactionStatus` DEFERRED/RELEASED
//     e, nos diferidos, `contexts[].DeferredContext.maturityDate` com a data
//     exata de liberação. `deferralReason: "DD7"` é a reserva padrão da Amazon
//     (entrega + 7 dias).
//
// Módulo puro, sem dependências, para ser testável.

export interface GrupoDeExtrato {
  processingStatus?: string;
  originalTotal?: { currencyAmount?: number; currencyCode?: string } | null;
  startDate?: string | null;
}

export interface TransacaoDeSaldo {
  status?: string;
  amount: number;
  currency?: string;
  orderId?: string;
  postedDate?: string;
  /** Data em que a Amazon libera o valor retido. */
  maturityDate?: string | null;
  deferralReason?: string | null;
}

export interface LiberacaoFutura {
  /** ISO da data de liberação. */
  date: string;
  amount: number;
  orderIds: string[];
}

export interface SaldoAmazon {
  currency: string;
  /**
   * Saldo do extrato aberto. `null` quando a Amazon não devolveu nenhum grupo —
   * "não sei" e "zero" são fatos diferentes, e um zero falso aqui diria que não
   * há nada a receber nem a pagar.
   */
  disponivel: number | null;
  /** Total ainda retido pela Amazon (soma das transações DEFERRED). */
  retido: number;
  /** Quando cada bloco retido cai, da data mais próxima para a mais distante. */
  liberacoes: LiberacaoFutura[];
  /** Início do extrato aberto mais antigo. */
  extratoDesde: string | null;
  /**
   * `true` quando o saldo disponível é negativo: não há repasse a receber, e a
   * Amazon vai COBRAR essa diferença no fechamento.
   */
  seraCobrado: boolean;
}

const round = (v: number) => +v.toFixed(2);

/** Só o dia importa para agrupar liberações; o horário vem em UTC e confunde. */
function diaDe(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function calcularSaldo(grupos: GrupoDeExtrato[], transacoes: TransacaoDeSaldo[]): SaldoAmazon {
  const abertos = grupos.filter((g) => g.processingStatus === "Open");
  // Sem grupo aberto não dá para afirmar saldo — a Amazon pode simplesmente não
  // ter devolvido o extrato, e exibir R$ 0,00 seria inventar um fato.
  const disponivel = abertos.length
    ? round(abertos.reduce((soma, g) => soma + (g.originalTotal?.currencyAmount ?? 0), 0))
    : null;

  const diferidas = transacoes.filter((t) => t.status === "DEFERRED");
  const retido = round(diferidas.reduce((soma, t) => soma + t.amount, 0));

  // Várias vendas podem cair no mesmo dia; a pessoa quer ver "dia 18 entram
  // R$ 39,80", não duas linhas de R$ 19,90.
  const porDia = new Map<string, LiberacaoFutura>();
  for (const t of diferidas) {
    if (!t.maturityDate) continue;
    const dia = diaDe(t.maturityDate);
    const atual = porDia.get(dia) ?? { date: dia, amount: 0, orderIds: [] };
    atual.amount = round(atual.amount + t.amount);
    if (t.orderId && !atual.orderIds.includes(t.orderId)) atual.orderIds.push(t.orderId);
    porDia.set(dia, atual);
  }

  const inicios = abertos.map((g) => g.startDate).filter((d): d is string => !!d).sort();

  return {
    currency: transacoes.find((t) => t.currency)?.currency ?? abertos[0]?.originalTotal?.currencyCode ?? "BRL",
    disponivel,
    retido,
    liberacoes: [...porDia.values()].sort((a, b) => a.date.localeCompare(b.date)),
    extratoDesde: inicios[0] ?? null,
    seraCobrado: disponivel != null && disponivel < 0,
  };
}
