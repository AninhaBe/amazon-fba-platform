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
  /** `charges_details`: tarifas e frete debitados. */
  charges?: ReadonlyArray<{ type?: string; amounts?: { original?: number | null } | null }>;
  charges_details?: ReadonlyArray<{ type?: string; amounts?: { original?: number | null } | null }>;
  /** `senders[].cost` do envio: a parte do frete que é do VENDEDOR. */
  freteDoVendedor?: number | null;
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
  /** Total LÍQUIDO ainda retido — já sem tarifa e sem a parte do vendedor no frete. */
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
 * Líquido que a vendedora recebe por este pagamento.
 *
 * Fórmula derivada do **relatório de liberações** do Mercado Pago
 * (`POST /v1/account/release_report`, baixado em 16/08/2026), que traz por linha
 * `GROSS_AMOUNT`, `MP_FEE_AMOUNT` e `NET_CREDIT_AMOUNT`:
 *
 *   GROSS 35,90 · MP_FEE −4,13 · frete do vendedor 6,65 → NET_CREDIT 25,12 ✓
 *
 * Conferido contra a tela do próprio MP no pagamento 172276681179:
 *   36,90 − 4,24 (tarifas) − 6,65 (frete do vendedor) = 26,01 = "Total a receber"
 *
 * ⚠️ Duas armadilhas que esta função evita, ambas custaram erro hoje:
 *
 * 1. **Não usar `net_received_amount`.** É inconsistente: em alguns pagamentos
 *    já inclui o crédito do frete do comprador e em outros não, sem nada na
 *    resposta que distinga (36,90 − 22,43 = 14,47 mas o campo dizia 26,01).
 * 2. **Não descontar `shp_fulfillment`.** Esse é o frete CHEIO; o ML debita o
 *    cheio e credita de volta a parte do comprador. Descontá-lo inteiro
 *    subtrairia dinheiro que volta — foi o que gerou 8 falsos alertas de
 *    cobrança indevida.
 *
 * Sem o frete do vendedor conhecido, devolve `null`: o pagamento é omitido em
 * vez de entrar por um líquido inventado.
 */
function liquidoDe(pagamento: PagamentoMP): number | null {
  const bruto = pagamento.transaction_amount;
  if (typeof bruto !== "number" || !Number.isFinite(bruto)) return null;
  const frete = pagamento.freteDoVendedor;
  if (typeof frete !== "number" || !Number.isFinite(frete)) return null;
  // Só tarifa entra aqui; frete tem tratamento próprio (ver armadilha 2).
  const tarifas = (pagamento.charges ?? pagamento.charges_details ?? [])
    .filter((c) => c.type !== "shipping")
    .reduce((soma, c) => soma + (c.amounts?.original ?? 0), 0);
  return round(bruto - tarifas - frete);
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
    const valor = liquidoDe(pagamento);
    if (valor == null) continue;
    if (!pagamento.money_release_date) continue;

    const quando = new Date(pagamento.money_release_date).getTime();
    if (!Number.isFinite(quando)) continue;

    if (quando > agora) {
      retido += valor;
      pagamentosLidos += 1;
      const dia = diaDe(pagamento.money_release_date);
      const atual = porDia.get(dia) ?? { date: dia, amount: 0, pagamentos: 0 };
      atual.amount = round(atual.amount + valor);
      atual.pagamentos += 1;
      porDia.set(dia, atual);
    } else {
      liberadoNaJanela += valor;
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
