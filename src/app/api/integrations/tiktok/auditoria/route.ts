import { dbQuery, ensureFinancialLedgerSchema, hasDb } from "@/lib/db";
import { currentWorkspaceId } from "@/lib/workspaceScope";
import { tiktokGet } from "@/lib/integrations/tiktokRoute";
import { periodRequest } from "@/lib/integrations/tiktokModuleContract";
import { isFinancialSchemaMissing } from "@/lib/integrations/tiktokFinancialLedger";
import type { IntegrationConnection } from "@/lib/integrations/types";
import {
  auditarFreteTiktok,
  BASE_CUSTO_DO_EXTRATO,
  type PedidoAuditavelTiktok,
} from "@/lib/integrations/tiktokAuditoria";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDER = "tiktok_shop";

/**
 * Status que geram cobrança de frete. Mesmo conjunto que o resto da leitura
 * canônica do canal usa (`readTiktokLedgerSnapshot`, `readAbc`), para a auditoria
 * não contar um universo de pedidos diferente do dashboard.
 */
const STATUS_AUDITAVEIS = ["paid", "shipped", "delivered"];

/**
 * Teto de pedidos lidos por requisição. Sem teto, um período aberto varre a
 * tabela inteira numa chamada de tela e a lista trava o navegador — o problema já
 * medido no monitor. Estourou, a resposta diz o número e a tela pede um período
 * menor, em vez de mostrar meia conta sem avisar.
 */
const LIMITE_DE_PEDIDOS = 500;

interface LinhaAuditoria {
  external_order_id: string;
  occurred_at: Date | string;
  order_currency: string | null;
  buyer_shipping: string | number | null;
  extrato_liquidado: boolean;
  declarado: string | number | null;
  declarado_currency: string | null;
  cobrado: string | number | null;
  cobrado_currency: string | null;
  liquidados: number;
  estimados: number;
  statement_id: string | null;
}

const numero = (valor: string | number | null | undefined): number | null => {
  if (valor == null || valor === "") return null;
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : null;
};

/**
 * Um lado vem de `workspace_channel_order_fees` (extrato POR PEDIDO) e o outro de
 * `workspace_financial_transactions` (feed de demonstrativos). Os dois guardam o
 * mesmo `shipping_cost_amount` do TikTok, com o mesmo `Math.abs()` aplicado na
 * ingestão — a evidência está no cabeçalho de `tiktokAuditoria.ts`.
 *
 * Só lançamento liquidado (`NOT is_estimated`) e do tipo `ORDER` entra em
 * `cobrado`: estimativa não é cobrança, e `LOGISTICS_REIMBURSEMENT` é evento de
 * reembolso, não o débito do frete do pedido.
 */
const CONSULTA = `WITH pedido AS (
  SELECT o.external_order_id,
         o.occurred_at,
         o.currency AS order_currency,
         o.buyer_shipping,
         (o.financial_settled OR COALESCE((o.raw #>> '{_sellercore,statementSettled}')::boolean, false)) AS extrato_liquidado
    FROM workspace_channel_orders o
   WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
     AND o.occurred_at BETWEEN $4 AND $5
     AND o.status = ANY($6::text[])
   ORDER BY o.occurred_at DESC, o.external_order_id DESC
   LIMIT $7
)
SELECT p.external_order_id,
       p.occurred_at,
       p.order_currency,
       p.buyer_shipping,
       p.extrato_liquidado,
       f.declarado,
       f.declarado_currency,
       c.cobrado,
       c.cobrado_currency,
       COALESCE(c.liquidados, 0) AS liquidados,
       COALESCE(c.estimados, 0) AS estimados,
       c.statement_id
  FROM pedido p
  LEFT JOIN LATERAL (
    SELECT SUM(x.amount) AS declarado,
           MIN(x.currency) AS declarado_currency
      FROM workspace_channel_order_fees x
     WHERE x.workspace_id = $1 AND x.provider = $2 AND x.connection_id = $3
       AND x.external_order_id = p.external_order_id
       AND x.fee_type = 'shipping_seller'
  ) f ON true
  LEFT JOIN LATERAL (
    SELECT SUM(t.seller_shipping) FILTER (WHERE NOT t.is_estimated AND t.transaction_type = 'ORDER') AS cobrado,
           (COUNT(*) FILTER (WHERE NOT t.is_estimated AND t.transaction_type = 'ORDER' AND t.seller_shipping IS NOT NULL))::int AS liquidados,
           (COUNT(*) FILTER (WHERE t.is_estimated))::int AS estimados,
           MIN(t.currency) FILTER (WHERE NOT t.is_estimated AND t.transaction_type = 'ORDER') AS cobrado_currency,
           MIN(t.statement_id) FILTER (WHERE NOT t.is_estimated AND t.transaction_type = 'ORDER') AS statement_id
      FROM workspace_financial_transactions t
     WHERE t.workspace_id = $1 AND t.provider = $2 AND t.connection_id = $3
       AND t.order_id = p.external_order_id
  ) c ON true
 ORDER BY p.occurred_at DESC, p.external_order_id DESC`;

function vazio(periodo: { from: Date; to: Date }) {
  return {
    base: BASE_CUSTO_DO_EXTRATO,
    currency: null,
    pedidos: [],
    // Nada lido é "não sei", não "não há divergência": null, nunca zero.
    totalAContestar: null,
    comparados: 0,
    pendencias: [],
    pendenciasPorMotivo: null,
    periodo: { from: periodo.from.toISOString(), to: periodo.to.toISOString() },
    lidos: 0,
    limite: LIMITE_DE_PEDIDOS,
    excedeuLimite: false,
  };
}

async function readAuditoria(connection: IntegrationConnection, params: URLSearchParams) {
  const periodo = periodRequest(params);
  if (!hasDb()) return { ...vazio(periodo), availability: "NOT_AVAILABLE" as const };
  const bloqueado = {
    ...vazio(periodo),
    availability: "BLOCKED" as const,
    code: "FINANCIAL_SCHEMA_UNAVAILABLE",
    message: "O ledger financeiro ainda não está disponível neste ambiente.",
  };

  try {
    await ensureFinancialLedgerSchema();
  } catch (error) {
    if (isFinancialSchemaMissing(error)) return bloqueado;
    throw error;
  }

  let linhas: LinhaAuditoria[];
  try {
    linhas = await dbQuery<LinhaAuditoria>(CONSULTA, [
      currentWorkspaceId(),
      PROVIDER,
      connection.id,
      periodo.from,
      periodo.to,
      STATUS_AUDITAVEIS,
      LIMITE_DE_PEDIDOS + 1,
    ]);
  } catch (error) {
    if (isFinancialSchemaMissing(error)) return bloqueado;
    throw error;
  }

  const excedeuLimite = linhas.length > LIMITE_DE_PEDIDOS;
  const consideradas = excedeuLimite ? linhas.slice(0, LIMITE_DE_PEDIDOS) : linhas;

  const pedidos: PedidoAuditavelTiktok[] = consideradas.map((linha) => ({
    orderId: linha.external_order_id,
    ocorridoEm: new Date(linha.occurred_at).toISOString(),
    // Os dois lados declaram a MESMA base de propósito: é a única combinação que
    // o repositório consegue provar hoje. Trocar um deles por outra base derruba
    // o pedido para pendência, em vez de gerar divergência inventada.
    declarado: {
      base: BASE_CUSTO_DO_EXTRATO,
      valor: numero(linha.declarado),
      currency: linha.declarado_currency ?? linha.order_currency,
    },
    cobrado: {
      base: BASE_CUSTO_DO_EXTRATO,
      valor: numero(linha.cobrado),
      currency: linha.cobrado_currency ?? linha.order_currency,
    },
    extratoLiquidado: linha.extrato_liquidado === true,
    lancamentosLiquidados: Number(linha.liquidados ?? 0),
    lancamentosEstimados: Number(linha.estimados ?? 0),
    // Contexto para a tela. Não entra na subtração: base diferente.
    freteDoComprador: numero(linha.buyer_shipping),
    statementId: linha.statement_id,
  }));

  return {
    ...auditarFreteTiktok(pedidos),
    availability: "AVAILABLE" as const,
    periodo: { from: periodo.from.toISOString(), to: periodo.to.toISOString() },
    lidos: pedidos.length,
    limite: LIMITE_DE_PEDIDOS,
    excedeuLimite,
  };
}

export async function GET(request: Request) {
  return tiktokGet(request, readAuditoria);
}
