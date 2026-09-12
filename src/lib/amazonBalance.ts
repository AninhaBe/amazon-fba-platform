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
  /** Quando o extrato fechou — a API só o publica em grupo Closed. */
  endDate?: string | null;
  /** Desfecho da transferencia bancaria: Succeeded, Failed, Processing... */
  fundTransferStatus?: string | null;
  fundTransferDate?: string | null;
  /** Codigo de rastreio bancario. Vem em POUCOS grupos — 1 de 12 na medicao. */
  traceId?: string | null;
  /** Ultimos digitos da conta de destino. */
  accountTail?: string | null;
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
  /**
   * ⚠️ O QUE JÁ FECHOU E ESPERA TRANSFERÊNCIA (grupos `Pending`).
   *
   * É dinheiro que saiu do "em maturação" e ainda não virou depósito. Na conta
   * da vendedora eram R$ 382,44 em 05/09/2026, represados porque **todas as
   * transferências estavam falhando** — e isso não aparecia em lugar nenhum da
   * tela. `null` = a Amazon não devolveu grupo fechado; zero seria afirmar que
   * não há nada esperando.
   */
  aguardandoTransferencia: number | null;
  /**
   * ⚠️ O DESFECHO DA ÚLTIMA TRANSFERÊNCIA — o campo que teria respondido "os
   * saques estão indo pra onde?" semanas antes de ela perguntar.
   *
   * O painel da Amazon mostra a TENTATIVA; só a API mostra se ela deu certo.
   * `null` = nunca houve transferência no período lido.
   */
  ultimaTransferencia: UltimaTransferencia | null;
  /**
   * ⚠️ COBRANÇAS FECHADAS — extrato que FECHOU NEGATIVO e nunca vira depósito:
   * a Amazon desconta do próximo fechamento (ou cobra). Aprovado pela Ana em
   * 12/09/2026 para o bloco de repasses do v3.
   *
   * `valor` é SEMPRE POSITIVO e significa "quanto SERÁ cobrado" — contrato com
   * a Vitrine: sinal cru exigiria Math.abs na tela, que é onde sinal se perde
   * em silêncio. `fechadaEm` `null` = fechou e a API não disse quando (a tela
   * escreve "fechada", sem data). A ORIGEM da cobrança não vem no grupo — a
   * tela afirma só a aritmética do extrato, nunca composição.
   */
  cobrancasFechadas: CobrancaFechada[];
}

export interface CobrancaFechada {
  /** Sempre positivo: quanto será cobrado. */
  valor: number;
  fechadaEm: string | null;
}

export interface UltimaTransferencia {
  /** Verbatim da Amazon: Succeeded, Failed, Processing, Unknown. */
  status: string;
  data: string;
  valor: number;
  /**
   * Rastreio bancário para casar com o extrato. `null` na maioria — medido em
   * 06/09/2026: **1 de 12** transferências tinha. Ausência é ausência; traço
   * vazio fingindo rastreio seria pior.
   */
  traceId: string | null;
  /** Últimos dígitos da conta de destino, quando a Amazon informa. */
  contaFinal: string | null;
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

  // O que ja fechou e espera transferencia. Grupo `Pending` = periodo fechado,
  // dinheiro apurado, deposito ainda nao tentado.
  const pendentes = grupos.filter((g) => g.processingStatus === "Pending");
  const aguardandoTransferencia = pendentes.length
    ? round(pendentes.reduce((soma, g) => soma + (g.originalTotal?.currencyAmount ?? 0), 0))
    : null;

  // ═══ COBRANÇA NÃO É TRANSFERÊNCIA (12/09/2026) ═══════════════════════════
  //
  // Grupo fechado NEGATIVO vem da API com FundTransferStatus "Unknown" e uma
  // data — mas nenhum dinheiro se moveu: extrato que fecha devendo vira
  // desconto no próximo fechamento, não depósito. Deixá-lo na lista fazia
  // `ultimaTransferencia` mostrar uma transferência que NUNCA EXISTIU sempre
  // que a cobrança fosse o grupo mais recente — o card existe justamente
  // porque a tela mostrava tentativa como se fosse pagamento. A cobrança tem
  // casa própria (`cobrancasFechadas`); um grupo, UM significado.
  const eCobrancaFechada = (g: GrupoDeExtrato) =>
    g.processingStatus === "Closed" && (g.originalTotal?.currencyAmount ?? 0) < 0;

  const cobrancasFechadas: CobrancaFechada[] = grupos
    .filter(eCobrancaFechada)
    .map((g) => ({
      // Positivo por contrato: "quanto SERÁ cobrado". Ver a nota no tipo.
      valor: round(-(g.originalTotal?.currencyAmount ?? 0)),
      fechadaEm: g.endDate ?? null,
    }))
    .sort((a, b) => (b.fechadaEm ?? "").localeCompare(a.fechadaEm ?? ""));

  // A transferencia mais recente, seja qual for o desfecho. ⚠️ NAO filtra por
  // Succeeded: era exatamente o `Failed` que precisava aparecer.
  const transferencias = grupos
    .filter((g): g is GrupoDeExtrato & { fundTransferStatus: string } => !!g.fundTransferStatus && !eCobrancaFechada(g))
    .sort((a, b) => (b.fundTransferDate ?? "").localeCompare(a.fundTransferDate ?? ""));
  const recente = transferencias[0];
  const ultimaTransferencia: UltimaTransferencia | null = recente
    ? {
        status: recente.fundTransferStatus,
        data: recente.fundTransferDate ?? "",
        valor: round(recente.originalTotal?.currencyAmount ?? 0),
        traceId: recente.traceId ?? null,
        contaFinal: recente.accountTail ?? null,
      }
    : null;

  const inicios = abertos.map((g) => g.startDate).filter((d): d is string => !!d).sort();

  return {
    currency: transacoes.find((t) => t.currency)?.currency ?? abertos[0]?.originalTotal?.currencyCode ?? "BRL",
    disponivel,
    aguardandoTransferencia,
    ultimaTransferencia,
    retido,
    liberacoes: [...porDia.values()].sort((a, b) => a.date.localeCompare(b.date)),
    extratoDesde: inicios[0] ?? null,
    seraCobrado: disponivel != null && disponivel < 0,
    cobrancasFechadas,
  };
}
