import { dbQuery, ensureFinancialLedgerSchema, hasDb } from "@/lib/db";
import { currentWorkspaceId } from "@/lib/workspaceScope";
import type { IntegrationConnection } from "@/lib/integrations/types";
import { isFinancialSchemaMissing, TIKTOK_FINANCIAL_PROVIDER } from "@/lib/integrations/tiktokFinancialLedger";
import { calcularSaldoTiktok, type LinhaLedgerTiktok, type PagamentoTiktok } from "@/lib/integrations/tiktokSaldo";
import { tiktokGet } from "@/lib/integrations/tiktokRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sem period: saldo é o estado de AGORA. Filtrar por período esconderia uma
 * liberação fora da janela e diria que não há nada a receber — mesma decisão já
 * tomada na rota de saldo do Mercado Livre.
 */
const JANELA_LIBERADO_DIAS = 30;

/**
 * Orçamento de leitura. Passar disso não vira "aproximadamente": a resposta diz
 * quantas linhas ficaram fora, com número, e o painel repete esse número.
 */
const LIMITE_LEITURA = 2000;

type LinhaPagamento = {
  payment_id: string;
  statement_id: string | null;
  amount: string | null;
  currency: string;
  paid_at: Date | null;
  expected_at: Date | null;
  total: number;
};

type LinhaTransacao = {
  transaction_id: string;
  order_id: string | null;
  statement_id: string | null;
  occurred_at: Date;
  currency: string;
  settlement_amount: string | null;
  settlement_state: LinhaLedgerTiktok["settlementState"];
  total: number;
};

const numero = (valor: string | null): number | null => (valor === null ? null : Number(valor));
const bloqueado = (message: string) => ({
  saldo: null,
  availability: "BLOCKED" as const,
  code: "FINANCIAL_SCHEMA_UNAVAILABLE",
  message,
});

async function readSaldo(connection: IntegrationConnection) {
  if (!hasDb()) return bloqueado("O ledger financeiro ainda não está disponível neste ambiente.");
  try {
    await ensureFinancialLedgerSchema();
  } catch (error) {
    if (isFinancialSchemaMissing(error)) {
      return bloqueado("O ledger financeiro ainda não está disponível neste ambiente.");
    }
    throw error;
  }

  const workspaceId = currentWorkspaceId();
  const agora = new Date();
  const liberadoDesde = new Date(agora.getTime() - JANELA_LIBERADO_DIAS * 86_400_000);

  try {
    // Repasses: todos os pendentes, mais os já pagos da janela recente. Pendente
    // primeiro porque é ele que responde "em que data cada venda cai".
    const pagamentos = await dbQuery<LinhaPagamento>(
      `SELECT payment_id,statement_id,amount,currency,paid_at,expected_at,COUNT(*) OVER()::int total
         FROM workspace_financial_payments
        WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3
          AND (paid_at IS NULL OR paid_at >= $4)
        ORDER BY (paid_at IS NULL) DESC, COALESCE(expected_at,paid_at) ASC NULLS LAST, payment_id
        LIMIT $5`,
      [workspaceId, TIKTOK_FINANCIAL_PROVIDER, connection.id, liberadoDesde, LIMITE_LEITURA],
    );

    // Extratos que ainda vão pagar. Só as vendas ligadas a eles precisam ser
    // lidas do ledger liquidado — é o que permite contar quantas vendas caem em
    // cada data sem varrer o histórico inteiro.
    const extratosAPagar = [
      ...new Set(
        pagamentos.filter((linha) => linha.paid_at === null && linha.statement_id).map((linha) => linha.statement_id as string),
      ),
    ];

    const ledger = await dbQuery<LinhaTransacao>(
      `SELECT transaction_id,order_id,statement_id,occurred_at,currency,settlement_amount,settlement_state,COUNT(*) OVER()::int total
         FROM workspace_financial_transactions
        WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3
          AND (settlement_state='unsettled' OR (statement_id IS NOT NULL AND statement_id=ANY($4::text[])))
        ORDER BY occurred_at DESC, transaction_id
        LIMIT $5`,
      [workspaceId, TIKTOK_FINANCIAL_PROVIDER, connection.id, extratosAPagar, LIMITE_LEITURA],
    );

    const saldo = calcularSaldoTiktok({
      agora,
      ledger: ledger.map<LinhaLedgerTiktok>((linha) => ({
        transactionId: linha.transaction_id,
        orderId: linha.order_id,
        statementId: linha.statement_id,
        occurredAt: linha.occurred_at,
        currency: linha.currency,
        settlementAmount: numero(linha.settlement_amount),
        settlementState: linha.settlement_state,
      })),
      pagamentos: pagamentos.map<PagamentoTiktok>((linha) => ({
        paymentId: linha.payment_id,
        statementId: linha.statement_id,
        amount: numero(linha.amount),
        currency: linha.currency,
        paidAt: linha.paid_at,
        expectedAt: linha.expected_at,
      })),
      ledgerForaDaLeitura: Math.max(0, (ledger[0]?.total ?? 0) - ledger.length),
      pagamentosForaDaLeitura: Math.max(0, (pagamentos[0]?.total ?? 0) - pagamentos.length),
    });

    // Zero identificador na resposta: o painel precisa de valores, datas e
    // contagens — nunca de pedido, extrato ou repasse nominal.
    return {
      saldo,
      liberadoDesde: liberadoDesde.toISOString(),
      availability: "AVAILABLE" as const,
    };
  } catch (error) {
    if (isFinancialSchemaMissing(error)) {
      return bloqueado("O ledger financeiro ainda não está disponível neste ambiente.");
    }
    throw error;
  }
}

export async function GET(request: Request) {
  return tiktokGet(request, readSaldo);
}
