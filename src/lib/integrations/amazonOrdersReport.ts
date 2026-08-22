import { gunzipSync } from "node:zlib";

import { dbQuery } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { spapiFetch, defaultMarketplaceId } from "../spapi";
import { saveOrderedGross } from "./canonicalStore";
import {
  somarValorPorPedido,
  pedidosSemValor,
  type PedidoSemValor,
  type OrderedGrossEntry,
} from "./amazonOrdersReportParse";

export { somarValorPorPedido, pedidosSemValor };

/**
 * Captura o valor de tabela dos pedidos pelo relatório ALL_ORDERS.
 *
 * Existe por um motivo só, medido em 22/08/2026: **a Amazon zera o pedido
 * cancelado em todas as APIs de pedido.** getOrders devolve sem OrderTotal,
 * getOrderItems devolve QuantityOrdered 0, orderMetrics nem cria a linha do dia,
 * e o próprio relatório passa a trazer quantity 0 e item-price vazio. O valor
 * existiu e some — não há endpoint que o recupere depois.
 *
 * O que este relatório tem de diferente é que ele **precifica pedido pendente**
 * (medido: R$ 72,12 em 3 pendentes que o getOrders entregava sem valor algum).
 * Então a saída não é procurar o dado depois do cancelamento, é gravá-lo antes.
 *
 * ⚠️ O valor daqui é preço de TABELA, antes do cupom resgatado — por isso vai
 * para `ordered_gross` e nunca para `gross`. Os dois divergiram em R$ 16,83 nos
 * 14 pedidos enviados da janela. Ver migrations/0010 e docs/api-amazon-sp-api.md.
 */

const TIPO = "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL";
const DIA = 86_400_000;
/** Janela coberta a cada ingestão. Curta de propósito: o alvo é pedido vivo, não histórico. */
const JANELA_DIAS = 14;
/** O createReport tem limite de ~1/min e o processamento leva minutos — não cabe no ciclo de 2 min. */
const INTERVALO_MS = 3 * 60 * 60_000;
const ESPERA_MS = 5_000;
const TENTATIVAS = 24;

interface ReportCriado {
  reportId: string;
}
interface ReportStatus {
  processingStatus: string;
  reportDocumentId?: string;
}
interface ReportDoc {
  url: string;
  compressionAlgorithm?: string;
}

/** Baixa o documento do relatório. Não passa pelo spapiFetch: é URL pré-assinada e TSV, não JSON. */
async function baixarDocumento(documentId: string): Promise<string> {
  const doc = await spapiFetch<ReportDoc>(`/reports/2021-06-30/documents/${documentId}`);
  const resposta = await fetch(doc.url, { cache: "no-store" });
  if (!resposta.ok) {
    throw new Error(`documento do relatório respondeu ${resposta.status}`);
  }
  const bruto = Buffer.from(await resposta.arrayBuffer());
  return (doc.compressionAlgorithm === "GZIP" ? gunzipSync(bruto) : bruto).toString("utf8");
}

/** true se já passou o intervalo desde a última ingestão desta conexão. */
async function estaNaHora(connectionId: string, forcar: boolean): Promise<boolean> {
  if (forcar) return true;
  const linhas = await dbQuery<{ vencido: boolean }>(
    `SELECT (orders_report_at IS NULL
             OR orders_report_at < now() - ($4 || ' milliseconds')::interval) AS vencido
       FROM workspace_marketplace_syncs
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
    [currentWorkspaceId(), "amazon", connectionId, String(INTERVALO_MS)]
  );
  // Sem linha de sync ainda: deixa o sync normal criar antes de gastar um relatório.
  return linhas[0]?.vencido === true;
}

async function marcarIngestao(connectionId: string): Promise<void> {
  await dbQuery(
    `UPDATE workspace_marketplace_syncs
        SET orders_report_at = now(), updated_at = now()
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
    [currentWorkspaceId(), "amazon", connectionId]
  );
}

export interface ResultadoRelatorio {
  executou: boolean;
  pedidosLidos: number;
  pedidosAtualizados: number;
  /** Pedidos zerados pela origem que ganharam valor estimado pelo preço do SKU. */
  pedidosEstimados: number;
  motivo?: string;
}

/**
 * Estima o valor dos pedidos que a origem zerou, pelo preço de tabela que o SKU
 * praticava na data da compra — tirado dos nossos próprios pedidos reais.
 *
 * ⚠️ É estimativa e vai marcada como tal (migrations/0011). Duas escolhas
 * conservadoras, ambas errando para BAIXO de propósito:
 *
 * — **Quantidade presumida 1.** A Amazon zera a quantidade junto com o preço.
 *   Um pedido que existiu tem no mínimo 1 unidade, então 1 é piso, não chute.
 * — **Preço de tabela, não o pago.** Cupom só desconta quando resgatado, e num
 *   pedido cancelado não há como saber se foi. O de tabela é o que a Amazon
 *   também usa para compor o número do Seller Central.
 *
 * SKU sem histórico de preço não vira zero: fica de fora e o pedido segue nulo.
 */
async function estimarPorPrecoDoSku(pedidos: PedidoSemValor[]): Promise<OrderedGrossEntry[]> {
  if (!pedidos.length) return [];
  const chaves = pedidos.flatMap((pedido) =>
    pedido.skus.map((sku) => ({
      external_order_id: pedido.externalOrderId,
      sku,
      purchase_date: pedido.purchaseDate,
    }))
  );
  // O preço vale por dia: o mesmo SKU custou 19,90 em 08/08 e 22,11 em 21/08.
  // LATERAL com ORDER BY na distância da data pega o preço mais próximo do
  // pedido, e não uma média que não existiu em dia nenhum.
  const linhas = await dbQuery<{ external_order_id: string; valor: string }>(
    `SELECT k.external_order_id, SUM(preco.valor) AS valor
       FROM jsonb_to_recordset($2::jsonb) AS k(external_order_id text, sku text, purchase_date timestamptz)
       CROSS JOIN LATERAL (
         SELECT COALESCE(i.list_price, i.unit_price) AS valor
           FROM workspace_channel_order_items i
           JOIN workspace_channel_orders o
             USING (workspace_id, provider, connection_id, external_order_id)
          WHERE i.workspace_id = $1 AND i.provider = 'amazon' AND i.sku = k.sku
            AND COALESCE(i.list_price, i.unit_price) > 0
          ORDER BY abs(EXTRACT(EPOCH FROM (o.occurred_at - COALESCE(k.purchase_date, now()))))
          LIMIT 1
       ) AS preco
      WHERE k.sku IS NOT NULL
      GROUP BY k.external_order_id`,
    [currentWorkspaceId(), JSON.stringify(chaves)]
  );
  return linhas
    .map((linha) => ({
      externalOrderId: linha.external_order_id,
      orderedGross: Math.round(Number(linha.valor) * 100) / 100,
    }))
    .filter((entrada) => Number.isFinite(entrada.orderedGross) && entrada.orderedGross > 0);
}

/**
 * Puxa o relatório e grava `ordered_gross`. Espaçado por `orders_report_at`.
 *
 * Falha aqui é ruído, não quebra: sem o relatório o pedido cancelado continua sem
 * valor na tela — que é exatamente o estado anterior. Por isso o chamador trata
 * como melhor-esforço.
 */
export async function ingerirRelatorioDePedidos(
  connectionId: string,
  forcar = false
): Promise<ResultadoRelatorio> {
  if (!(await estaNaHora(connectionId, forcar))) {
    return {
      executou: false,
      pedidosLidos: 0,
      pedidosAtualizados: 0,
      pedidosEstimados: 0,
      motivo: "ainda no intervalo",
    };
  }

  const fim = new Date();
  const inicio = new Date(fim.getTime() - JANELA_DIAS * DIA);
  const { reportId } = await spapiFetch<ReportCriado>("/reports/2021-06-30/reports", {
    method: "POST",
    body: {
      reportType: TIPO,
      marketplaceIds: [defaultMarketplaceId()],
      dataStartTime: inicio.toISOString(),
      dataEndTime: fim.toISOString(),
    },
  });

  let documentId: string | undefined;
  let ultimoStatus = "";
  for (let i = 0; i < TENTATIVAS; i++) {
    await new Promise((r) => setTimeout(r, ESPERA_MS));
    const status = await spapiFetch<ReportStatus>(`/reports/2021-06-30/reports/${reportId}`);
    ultimoStatus = status.processingStatus;
    if (ultimoStatus === "DONE") {
      documentId = status.reportDocumentId;
      break;
    }
    if (ultimoStatus === "CANCELLED" || ultimoStatus === "FATAL") break;
  }
  if (!documentId) {
    // Sem marcar `orders_report_at`: não conseguir o dado não deve custar 3h de espera.
    return {
      executou: false,
      pedidosLidos: 0,
      pedidosAtualizados: 0,
      pedidosEstimados: 0,
      motivo: `relatório terminou em ${ultimoStatus || "sem resposta"}`,
    };
  }

  const tsv = await baixarDocumento(documentId);
  const escopo = { provider: "amazon" as const, connectionId };

  const entradas = somarValorPorPedido(tsv);
  const atualizados = await saveOrderedGross(escopo, entradas, "relatorio");

  // Segunda passada: o que a origem zerou, mas cujo SKU sobreviveu.
  const estimativas = await estimarPorPrecoDoSku(pedidosSemValor(tsv));
  const estimados = await saveOrderedGross(escopo, estimativas, "estimado");

  await marcarIngestao(connectionId);
  return {
    executou: true,
    pedidosLidos: entradas.length,
    pedidosAtualizados: atualizados,
    pedidosEstimados: estimados,
  };
}
