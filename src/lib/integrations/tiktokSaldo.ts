// Saldo e retenção do TikTok Shop — "quanto está retido, quanto já liberou e em
// que data cada venda cai".
//
// Mesma pergunta que os blocos da Amazon e do Mercado Livre respondem. A fonte
// aqui são as duas leituras financeiras que o TikTok expõe e que o ledger já
// persiste (ver tiktokFinancialLedger.ts — nada é re-transportado aqui):
//
// - /finance/202507/orders/unsettled → workspace_financial_transactions com
//   settlement_state='unsettled'. Prova o valor que o TikTok estima repassar
//   por pedido ainda sem extrato. **Não traz data**: enquanto o extrato não
//   fecha, o payload não diz quando cai.
// - /finance/202309/payments → workspace_financial_payments. Traz expected_time
//   (quando cai) e paid_time (quando caiu), por repasse. É a ÚNICA data de
//   liberação que a API prova.
//
// Os dois conjuntos não se sobrepõem: o pedido sai de unsettled quando entra num
// extrato, e é o extrato que gera o pagamento. Somar retido com a liberar não
// conta o mesmo dinheiro duas vezes.
//
// Disciplina herdada do Mercado Livre (mercadoPagoBalance.ts): lá o endpoint de
// saldo da conta devolve 403 e por isso o painel NÃO afirma "disponível agora" —
// mostra só o que consegue provar. Aqui a regra equivalente é a data: ela só
// existe onde o TikTok emitiu expected_time. Para o que está retido sem extrato
// a data é desconhecida, e o resultado diz quantas vendas estão nesse estado,
// com número.
//
// O que este módulo deliberadamente NÃO faz: decompor o repasse em ads, imposto
// retido ou reembolso. settlement_amount chega como um número único e o payload
// observado não prova essa semântica — inventar a decomposição corromperia lucro
// e margem. Quando o próprio valor falta, isso vira pendência com número.
//
// Módulo puro, sem I/O: recebe as linhas já lidas e devolve o resultado.

export type Instante = string | Date;

/** Linha do ledger financeiro (workspace_financial_transactions). */
export interface LinhaLedgerTiktok {
  transactionId: string;
  orderId: string | null;
  statementId: string | null;
  occurredAt: Instante;
  currency: string;
  /** settlement_amount. `null` quando o TikTok não informou o valor. */
  settlementAmount: number | null;
  settlementState: "unsettled" | "settled" | "reversed";
}

/** Repasse (workspace_financial_payments). */
export interface PagamentoTiktok {
  paymentId: string;
  statementId: string | null;
  amount: number | null;
  currency: string;
  /** paid_time. Preenchido significa que o dinheiro já saiu do TikTok. */
  paidAt: Instante | null;
  /** expected_time. A única data de liberação que a API prova. */
  expectedAt: Instante | null;
}

export interface EntradaSaldoTiktok {
  ledger: readonly LinhaLedgerTiktok[];
  pagamentos: readonly PagamentoTiktok[];
  agora: Date;
  /** Linhas do ledger que existem no período e não couberam na leitura. */
  ledgerForaDaLeitura?: number;
  /** Repasses que existem no período e não couberam na leitura. */
  pagamentosForaDaLeitura?: number;
}

export interface LiberacaoTiktok {
  /** Dia da liberação no fuso de São Paulo (YYYY-MM-DD). */
  date: string;
  /** `null` quando nenhum repasse do dia informou valor. */
  amount: number | null;
  pagamentos: number;
  pagamentosSemValor: number;
  /** Vendas vinculadas pelo extrato. `null` quando nenhum extrato do dia foi lido. */
  vendas: number | null;
  /**
   * Estornos vinculados pelo mesmo extrato, contados à parte porque dinheiro
   * voltando não é venda. `null` sob a mesma regra de `vendas`.
   */
  estornos: number | null;
  /** Data prevista já passou e o repasse continua sem paid_time. */
  atrasada: boolean;
}

/** O que falta, com número — nunca um adjetivo que se desculpe. */
export interface PendenciaSaldoTiktok {
  codigo:
    | "RETENCAO_SEM_VALOR"
    | "LIBERACAO_SEM_VALOR"
    | "REPASSE_SEM_DATA_PREVISTA"
    | "MOVIMENTACOES_FORA_DA_LEITURA"
    | "REPASSES_FORA_DA_LEITURA";
  quantidade: number;
  texto: string;
}

export interface SaldoTiktok {
  /** `null` quando nada foi lido: não há moeda a afirmar. */
  currency: string | null;
  /** Estimativa do próprio TikTok para pedidos ainda sem extrato. */
  retido: number | null;
  retidoVendas: number;
  retidoSemValor: number;
  /** Soma dos repasses com data prevista e ainda não pagos. */
  aLiberar: number | null;
  liberacoes: LiberacaoTiktok[];
  proximaLiberacao: LiberacaoTiktok | null;
  /** Já pago dentro da janela lida — NÃO é o saldo da conta. */
  liberado: number | null;
  liberadoPagamentos: number;
  /** Repasse sem expected_time e sem paid_time: existe, sem data. */
  repassesSemDataPrevista: { pagamentos: number; valor: number | null };
  leitura: {
    movimentacoesLidas: number;
    movimentacoesForaDaLeitura: number;
    pagamentosLidos: number;
    pagamentosForaDaLeitura: number;
  };
  pendencias: PendenciaSaldoTiktok[];
}

const round = (valor: number) => +valor.toFixed(2);
const ISO_CURRENCY = /^[A-Z]{3}$/;
const FORMATO_DIA = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function instante(valor: Instante | null | undefined, campo: string): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const ms = valor instanceof Date ? valor.getTime() : new Date(valor).getTime();
  if (!Number.isFinite(ms)) throw new TypeError(`TikTok ${campo} sem timestamp válido.`);
  return ms;
}

// `null` é ausência; zero é fato. Número quebrado é defeito e não pode virar
// nenhum dos dois em silêncio.
function dinheiro(valor: number | null | undefined, campo: string): number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== "number" || !Number.isFinite(valor)) throw new TypeError(`TikTok ${campo} inválido.`);
  return valor;
}

function moeda(valor: string, campo: string): string {
  const currency = typeof valor === "string" ? valor.trim().toUpperCase() : "";
  if (!ISO_CURRENCY.test(currency)) throw new TypeError(`TikTok ${campo} sem moeda ISO válida.`);
  return currency;
}

/** Somatório que preserva o desconhecido: sem nenhuma parcela conhecida, `null`. */
class Soma {
  private total = 0;
  private conhecidas = 0;
  /** Devolve `true` quando a parcela era conhecida e entrou no total. */
  add(valor: number | null): boolean {
    if (valor === null) return false;
    this.total += valor;
    this.conhecidas += 1;
    return true;
  }
  get valor(): number | null {
    return this.conhecidas > 0 ? round(this.total) : null;
  }
}

function pendencia(
  codigo: PendenciaSaldoTiktok["codigo"],
  quantidade: number,
  texto: string,
): PendenciaSaldoTiktok | null {
  return quantidade > 0 ? { codigo, quantidade, texto } : null;
}

const plural = (n: number, um: string, muitos: string) =>
  `${n.toLocaleString("pt-BR")} ${n === 1 ? um : muitos}`;

export function calcularSaldoTiktok(entrada: EntradaSaldoTiktok): SaldoTiktok {
  const agora = entrada.agora.getTime();
  if (!Number.isFinite(agora)) throw new TypeError("TikTok saldo sem instante de referência válido.");
  const foraLedger = Math.max(0, Math.trunc(entrada.ledgerForaDaLeitura ?? 0));
  const foraPagamentos = Math.max(0, Math.trunc(entrada.pagamentosForaDaLeitura ?? 0));

  const moedas = new Set<string>();
  // Vendas por extrato: é o que permite dizer QUANTAS vendas caem em cada data.
  const vendasPorExtrato = new Map<string, number>();
  // Estorno por extrato, contado à parte. Ver o switch abaixo.
  const estornosPorExtrato = new Map<string, number>();
  // Extratos que apareceram no ledger lido — liquidados OU estornados. É o que
  // separa "o extrato não foi lido" (desconhecido) de "o extrato foi lido e não
  // tinha venda nenhuma" (fato).
  const extratosLidos = new Set<string>();
  const retidoSoma = new Soma();
  let retidoVendas = 0;
  let retidoSemValor = 0;

  const vincular = (destino: Map<string, number>, linha: LinhaLedgerTiktok) => {
    if (!linha.statementId) return;
    extratosLidos.add(linha.statementId);
    if (linha.orderId) destino.set(linha.statementId, (destino.get(linha.statementId) ?? 0) + 1);
  };

  for (const linha of entrada.ledger) {
    moedas.add(moeda(linha.currency, "transaction"));
    instante(linha.occurredAt, "transaction occurred_at");
    const valor = dinheiro(linha.settlementAmount, "settlement_amount");
    // Cada estado é tratado por nome. A versão anterior tinha um ramo implícito
    // ("tudo que não é unsettled") e, como a 0005 declara
    // settlement_state IN ('unsettled','settled','reversed'), um ESTORNO caía
    // ali e era contado como venda: a tela diria "3 vendas" numa data em que
    // caíram 2 vendas e 1 estorno. Nada no schema proíbe reversed com
    // statement_id e order_id (financial_transactions_statement_source_check
    // aceita os dois estados), então não dá para provar que o caso não ocorre —
    // ele é contado à parte. O default falha alto de propósito: um estado novo
    // amanhã não pode virar venda em silêncio.
    switch (linha.settlementState) {
      case "unsettled":
        if (retidoSoma.add(valor)) retidoVendas += 1;
        else retidoSemValor += 1;
        break;
      case "settled":
        // Liquidada: não entra no retido, mas amarra a venda ao extrato que a paga.
        vincular(vendasPorExtrato, linha);
        break;
      case "reversed":
        // Estorno não é venda: dinheiro voltando não vira mais uma unidade
        // vendida na data de liberação.
        vincular(estornosPorExtrato, linha);
        break;
      default: {
        const desconhecido: never = linha.settlementState;
        throw new TypeError(`TikTok settlement_state sem tratamento: ${String(desconhecido)}.`);
      }
    }
  }

  const liberadoSoma = new Soma();
  const semDataSoma = new Soma();
  let liberadoPagamentos = 0;
  let semDataPagamentos = 0;
  let liberacaoSemValor = 0;
  const porDia = new Map<
    string,
    { soma: Soma; pagamentos: number; semValor: number; extratos: Set<string>; atrasada: boolean }
  >();

  for (const pagamento of entrada.pagamentos) {
    moedas.add(moeda(pagamento.currency, "payment"));
    const valor = dinheiro(pagamento.amount, "payment amount");
    const pago = instante(pagamento.paidAt, "payment paid_time");
    if (pago !== null) {
      liberadoSoma.add(valor);
      liberadoPagamentos += 1;
      continue;
    }
    const previsto = instante(pagamento.expectedAt, "payment expected_time");
    if (previsto === null) {
      semDataSoma.add(valor);
      semDataPagamentos += 1;
      if (valor === null) liberacaoSemValor += 1;
      continue;
    }
    const dia = FORMATO_DIA.format(new Date(previsto));
    const grupo =
      porDia.get(dia) ??
      { soma: new Soma(), pagamentos: 0, semValor: 0, extratos: new Set<string>(), atrasada: false };
    grupo.pagamentos += 1;
    if (!grupo.soma.add(valor)) {
      grupo.semValor += 1;
      liberacaoSemValor += 1;
    }
    if (pagamento.statementId) grupo.extratos.add(pagamento.statementId);
    if (previsto < agora) grupo.atrasada = true;
    porDia.set(dia, grupo);
  }

  if (moedas.size > 1) throw new TypeError("Saldo TikTok contém moedas diferentes.");

  const aLiberarSoma = new Soma();
  const liberacoes: LiberacaoTiktok[] = [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, grupo]) => {
      aLiberarSoma.add(grupo.soma.valor);
      const conhecidos = [...grupo.extratos].filter((id) => extratosLidos.has(id));
      const somar = (origem: Map<string, number>) =>
        // Sem nenhum extrato do dia no ledger lido, a contagem é desconhecida —
        // e desconhecido não é zero. Com o extrato lido, zero é fato.
        conhecidos.length ? conhecidos.reduce((total, id) => total + (origem.get(id) ?? 0), 0) : null;
      return {
        date,
        amount: grupo.soma.valor,
        pagamentos: grupo.pagamentos,
        pagamentosSemValor: grupo.semValor,
        vendas: somar(vendasPorExtrato),
        estornos: somar(estornosPorExtrato),
        atrasada: grupo.atrasada,
      };
    });

  const pendencias = [
    pendencia(
      "RETENCAO_SEM_VALOR",
      retidoSemValor,
      `${plural(retidoSemValor, "venda retida", "vendas retidas")} sem valor de repasse informado pelo TikTok`,
    ),
    pendencia(
      "LIBERACAO_SEM_VALOR",
      liberacaoSemValor,
      `${plural(liberacaoSemValor, "repasse", "repasses")} sem valor informado pelo TikTok`,
    ),
    pendencia(
      "REPASSE_SEM_DATA_PREVISTA",
      semDataPagamentos,
      `${plural(semDataPagamentos, "repasse", "repasses")} sem data prevista pelo TikTok`,
    ),
    pendencia(
      "MOVIMENTACOES_FORA_DA_LEITURA",
      foraLedger,
      `${plural(foraLedger, "movimentação do período ficou", "movimentações do período ficaram")} fora deste total`,
    ),
    pendencia(
      "REPASSES_FORA_DA_LEITURA",
      foraPagamentos,
      `${plural(foraPagamentos, "repasse do período ficou", "repasses do período ficaram")} fora deste total`,
    ),
  ].filter((item): item is PendenciaSaldoTiktok => item !== null);

  return {
    currency: moedas.size === 1 ? [...moedas][0] : null,
    retido: retidoSoma.valor,
    retidoVendas,
    retidoSemValor,
    aLiberar: aLiberarSoma.valor,
    liberacoes,
    proximaLiberacao: liberacoes.find((item) => !item.atrasada) ?? liberacoes[0] ?? null,
    liberado: liberadoSoma.valor,
    liberadoPagamentos,
    repassesSemDataPrevista: { pagamentos: semDataPagamentos, valor: semDataSoma.valor },
    leitura: {
      movimentacoesLidas: entrada.ledger.length,
      movimentacoesForaDaLeitura: foraLedger,
      pagamentosLidos: entrada.pagamentos.length,
      pagamentosForaDaLeitura: foraPagamentos,
    },
    pendencias,
  };
}
