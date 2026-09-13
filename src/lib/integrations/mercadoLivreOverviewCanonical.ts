import { dbQuery, hasDb } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { getCosts, costAt } from "../costStore";
import { allocateByWeight, calculateContribution, type ProfitabilityLine } from "../profitability";
import {
  brazilDateKey,
  getMercadoLivreOverview,
  mercadoLivreCostEntry,
  mercadoLivreTaxRate,
  type MercadoLivrePeriod,
  type MercadoLivreProduct,
} from "./mercadoLivre";
import { classificarCobertura, ORDEM_DO_RADAR, type StockStatus } from "../coberturaDeEstoque";
import type { IntegrationConnection } from "./types";
import { tacosDoPeriodo } from "./tacosDoCanal";
import { anuncioDoCanal } from "../anuncioDoCanal";
import { SQL_TARIFAS_QUE_CUSTAM } from "./canonical";

// Overview do Mercado Livre servido pelo modelo canônico (fase 4 da migração,
// docs/canonical-schema.md): agregados em SQL sobre colunas indexadas + linhas
// magras para o cálculo de lucro — nenhum payload jsonb sai do banco. Espelha
// a semântica do getMercadoLivreOverview (rateio por receita, custo por
// vigência, cobertura sem extrapolar); o tipo de retorno idêntico é garantido
// pelo compilador.

const PROVIDER = "mercado_livre";
const DETAILED_ORDER_LIMIT = 1_000;

/**
 * A PRÉVIA do dashboard (contrato com a Vitrine, 13/09/2026): o dashboard
 * renderiza 5 linhas (`ultimosPedidos`) e recebia as 1000 — 567 KB de 595 KB
 * do payload eram lista que ninguém lia (medição dela). O corte é POR LINHA,
 * na ordenação atual (occurred_at DESC, external_order_id, line_no): pedido de
 * 3 itens ocupa 3 vagas. O monitor segue com a lista inteira.
 */
export const LINHAS_DA_PREVIA = 5;
// Conciliado / receita real: SÓ vendas aprovadas (ADR-020).
const REVENUE_STATUSES = ["paid", "shipped", "delivered"];
// BRUTO: "Vendas brutas" do painel do ML = aprovadas + canceladas, só produto
// (sem frete). Confirmado ao centavo contra o Mercado Livre e o Mercado Turbo.
//
// ⚠️ Incluir canceladas aqui é DE PROPÓSITO e não é inconsistência com o
// conciliado: são duas perguntas diferentes (ADR-020). O bruto existe para a
// pessoa conferir contra o painel do marketplace, que é a visão que ela conhece;
// o conciliado é a que o marketplace não dá. Canceladas seguem exibidas à parte.
const GROSS_STATUSES = ["paid", "shipped", "delivered", "cancelled"];
const COVERAGE_TOLERANCE_MS = 15 * 60_000;

export type MercadoLivreOverview = Awaited<ReturnType<typeof getMercadoLivreOverview>>;

interface SyncMetaRow {
  covered_from: Date | string | null;
  covered_to: Date | string | null;
  products_synced_at: Date | string | null;
  products_total: number;
  active_products: number;
  products_complete: boolean;
}

interface TotalsRow {
  total_orders: number;
  paid_orders: number;
  paid_revenue: string | null;
  approved_revenue: string | null;
  /** A base do lucro: todo pedido não cancelado, pendente inclusive. */
  faturamento: string | null;
  pedidos_faturados: number;
  /** Pedidos que o ML ainda não valorizou: ficam FORA da base, nunca valem zero. */
  sem_valor: number;
  cancelled_revenue: string | null;
  cancelled_orders: number;
  pending_orders: number;
  pending_revenue: string | null;
  currency: string | null;
  last_sale_at: Date | string | null;
}

interface DailyRow { date: string; revenue: string; orders: number; units: number }

/**
 * Uma linha por DIA no universo da RECEITA PAGA — o mesmo da faixa do cockpit.
 *
 * ⚠️ NÃO reaproveita `DailyRow`: aquela usa `GROSS_STATUSES`, que inclui
 * CANCELADA de propósito (o faturamento do gráfico mostra o que foi pedido).
 * Lucro sobre pedido cancelado seria lucro de venda que não existiu.
 */
interface DiaDoLucroRow {
  date: string;
  receita: string | null;
  pedidos: number;
  /** Pedidos do dia que já têm tarifa registrada — o denominador da completude. */
  pedidos_com_tarifa: number;
  tarifa: string | null;
}

/** Unidades por dia e produto — para o custo respeitar a vigência de cada dia. */
interface UnidadeDoDiaRow {
  date: string;
  external_product_id: string;
  sku: string | null;
  occurred_at: Date | string;
  units: number;
}

// Agregado financeiro do período INTEIRO (sem o corte de detalhe): é o que
// alimenta o bloco "Do faturamento à margem". Antes ele saía do mesmo laço das
// linhas detalhadas e herdava o teto de 1000 pedidos, o que subestimava o
// resultado em contas grandes.
interface AggRow {
  orders_processed: number;
  processed_revenue: string | null;
  buyer_shipping: string | null;
  fees: string | null;
  seller_shipping: string | null;
  orders_with_shipping: number;
}

// Unidades por produto e por dia — granularidade suficiente para resolver o
// custo por vigência em JS sobre todas as vendas do período.
interface CogsRow {
  external_product_id: string;
  sku: string | null;
  occurred_at: Date | string;
  qty: number;
}

interface RecentRow {
  external_order_id: string;
  pack_id: string | null;
  provider_status: string;
  occurred_at: Date | string;
  gross: string;
  currency: string;
  units: number;
}

interface ProductTotalsRow {
  external_product_id: string;
  sku: string | null;
  title: string;
  units: number;
  revenue: string;
}

interface DetailedLineRow {
  external_order_id: string;
  occurred_at: Date | string;
  provider_status: string;
  currency: string;
  gross: string;
  buyer_shipping: string | null;
  fulfillment: string | null;
  line_no: number;
  external_product_id: string;
  sku: string | null;
  title: string;
  qty: number;
  unit_price: string;
  commission: string | null;
  seller_shipping: string | null;
}

interface PorProdutoRow {
  external_product_id: string;
  sku: string | null;
  receita_apurada: string | null;
  tarifa: string | null;
  frete: string | null;
  completo: boolean;
}

function scopeParams(connectionId: string, period: MercadoLivrePeriod): unknown[] {
  return [currentWorkspaceId(), PROVIDER, connectionId, period.from, period.to];
}

export async function getMercadoLivreOverviewFromCanonical(
  connection: IntegrationConnection,
  period: MercadoLivrePeriod,
  opcoes: {
    /**
     * "previa" busca só os pedidos das LINHAS_DA_PREVIA linhas (o ganho de
     * SERVIDOR: a LATERAL de tarifas deixa de rodar 1000 vezes no caminho do
     * dashboard) e corta por linha; o ESCOPO continua sobre o conjunto
     * inteiro, por um COUNT com a mesma forma da consulta completa — a frase
     * "Exibindo os N mais recentes" é o único aviso do recorte e não pode
     * mentir. "completo" é o caminho do monitor, intocado.
     */
    detalhe?: "completo" | "previa";
  } = {}
): Promise<MercadoLivreOverview | null> {
  if (!hasDb()) return null;
  const detalhe = opcoes.detalhe ?? "completo";
  const workspaceId = currentWorkspaceId();

  const [syncRows, totalsRows] = await Promise.all([
    dbQuery<SyncMetaRow>(
      `SELECT covered_from, covered_to, products_synced_at, products_total, active_products, products_complete
         FROM workspace_marketplace_syncs
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
      [workspaceId, PROVIDER, connection.id]
    ),
    dbQuery<TotalsRow>(
      `SELECT COUNT(*)::int AS total_orders,
              COUNT(*) FILTER (WHERE status = ANY($6::text[]))::int AS paid_orders,
              -- Faturamento = "Vendas brutas" do painel do ML = aprovadas +
              -- canceladas, só produto (sem frete).
              SUM(gross) FILTER (WHERE status = ANY($7::text[])) AS paid_revenue,
              SUM(gross) FILTER (WHERE status = ANY($6::text[])) AS approved_revenue,
              -- A BASE DO LUCRO: todo pedido NAO CANCELADO, pendente inclusive.
              -- Difere do paid_revenue acima DE PROPOSITO: aquele espelha as
              -- "Vendas brutas" do painel do ML e inclui canceladas (ADR-020);
              -- este e a base do lucro, e venda cancelada nao tem custo nem
              -- tarifa. Ver a nota longa em faturamentoDoLucro, na formula.
              -- (Sem crase neste bloco: ele mora dentro de um template literal.)
              SUM(gross) FILTER (WHERE status <> 'cancelled') AS faturamento,
              COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS pedidos_faturados,
              COUNT(*) FILTER (WHERE status <> 'cancelled' AND gross IS NULL)::int AS sem_valor,
              SUM(gross) FILTER (WHERE status = 'cancelled') AS cancelled_revenue,
              COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_orders,
              -- AGUARDANDO PAGAMENTO = o que não é aprovado nem cancelado.
              -- Definido por exclusão de propósito: o ML cria status novo sem
              -- avisar, e uma lista fixa faria o pedido novo sumir da legenda em
              -- vez de aparecer como pendente.
              COUNT(*) FILTER (WHERE status <> ALL($6::text[]) AND status <> 'cancelled')::int AS pending_orders,
              SUM(gross) FILTER (WHERE status <> ALL($6::text[]) AND status <> 'cancelled') AS pending_revenue,
              MAX(occurred_at) FILTER (WHERE status = ANY($6::text[])) AS last_sale_at,
              MAX(currency) AS currency
         FROM workspace_channel_orders
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND occurred_at >= $4 AND occurred_at <= $5`,
      [...scopeParams(connection.id, period), REVENUE_STATUSES, GROSS_STATUSES]
    ),
  ]);
  const syncRow = syncRows[0];
  const totals = totalsRows[0];
  if (!syncRow || (!syncRow.products_synced_at && totals.total_orders === 0)) return null;

  const [dailyRows, diasDoLucroRows, unidadesDoDiaRows, recentRows, productTotalsRows, lineRows, productRows, costs, aggRows, cogsRows, porProdutoRows, escopoRows] = await Promise.all([
    dbQuery<DailyRow>(
      `SELECT to_char(o.occurred_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS date,
              SUM(o.gross) AS revenue,
              COUNT(*)::int AS orders,
              COALESCE(SUM(u.units), 0)::int AS units
         FROM workspace_channel_orders o
         LEFT JOIN LATERAL (
           SELECT SUM(i.qty)::int AS units FROM workspace_channel_order_items i
            WHERE i.workspace_id = o.workspace_id AND i.provider = o.provider
              AND i.connection_id = o.connection_id AND i.external_order_id = o.external_order_id
         ) u ON true
        WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
          AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status = ANY($6::text[])
        GROUP BY 1`,
      [...scopeParams(connection.id, period), GROSS_STATUSES]
    ),
    // ═══ LUCRO POR DIA — receita, tarifa e cobertura, no universo PAGO ═══════
    //
    // ⚠️ Universo diferente do gráfico de faturamento acima, de propósito: ali
    // entra CANCELADA (o gráfico mostra o que foi pedido); aqui não, porque
    // lucro de venda cancelada é lucro que não existiu.
    dbQuery<DiaDoLucroRow>(
      `SELECT to_char(o.occurred_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS date,
              SUM(o.gross) AS receita,
              COUNT(*)::int AS pedidos,
              COUNT(*) FILTER (WHERE f.tarifa IS NOT NULL)::int AS pedidos_com_tarifa,
              SUM(f.tarifa) AS tarifa
         FROM workspace_channel_orders o
         -- ⚠️ LATERAL, e nao subconsulta no SELECT: a correlacionada
         -- referenciaria o.workspace_id fora do GROUP BY e o Postgres recusa
         -- ("subquery uses ungrouped column"). Medido ao rodar, nao previsto.
         LEFT JOIN LATERAL (
           SELECT SUM(f2.amount) AS tarifa
             FROM workspace_channel_order_fees f2
            WHERE f2.workspace_id = o.workspace_id AND f2.provider = o.provider
              AND f2.connection_id = o.connection_id
              AND f2.external_order_id = o.external_order_id
              AND f2.fee_type IN (${SQL_TARIFAS_QUE_CUSTAM})
         ) f ON true
        WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
          AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status = ANY($6::text[])
        GROUP BY 1`,
      [...scopeParams(connection.id, period), REVENUE_STATUSES]
    ),
    // Unidades por DIA e produto: o custo tem vigência, e somar o mês inteiro
    // com o preço de hoje daria um número que nunca existiu.
    dbQuery<UnidadeDoDiaRow>(
      `SELECT to_char(o.occurred_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS date,
              i.external_product_id, i.sku,
              MIN(o.occurred_at) AS occurred_at,
              SUM(i.qty)::int AS units
         FROM workspace_channel_order_items i
         JOIN workspace_channel_orders o
           ON o.workspace_id = i.workspace_id AND o.provider = i.provider
          AND o.connection_id = i.connection_id AND o.external_order_id = i.external_order_id
        WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
          AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status = ANY($6::text[])
        GROUP BY 1, 2, 3`,
      [...scopeParams(connection.id, period), REVENUE_STATUSES]
    ),
    dbQuery<RecentRow>(
      `SELECT o.external_order_id, o.pack_id, o.provider_status, o.occurred_at, o.gross, o.currency,
              COALESCE((SELECT SUM(i.qty)::int FROM workspace_channel_order_items i
                         WHERE i.workspace_id = o.workspace_id AND i.provider = o.provider
                           AND i.connection_id = o.connection_id AND i.external_order_id = o.external_order_id), 0) AS units
         FROM workspace_channel_orders o
        WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
          AND o.occurred_at >= $4 AND o.occurred_at <= $5
        ORDER BY o.occurred_at DESC
        LIMIT 10`,
      scopeParams(connection.id, period)
    ),
    dbQuery<ProductTotalsRow>(
      `SELECT i.external_product_id, i.sku, MIN(i.title) AS title,
              SUM(i.qty)::int AS units, SUM(i.qty * i.unit_price) AS revenue
         FROM workspace_channel_order_items i
         JOIN workspace_channel_orders o
           ON o.workspace_id = i.workspace_id AND o.provider = i.provider
          AND o.connection_id = i.connection_id AND o.external_order_id = i.external_order_id
        WHERE i.workspace_id = $1 AND i.provider = $2 AND i.connection_id = $3
          AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status = ANY($6::text[])
        GROUP BY i.external_product_id, i.sku`,
      [...scopeParams(connection.id, period), REVENUE_STATUSES]
    ),
    dbQuery<DetailedLineRow>(
      // Na PREVIA o teto cai para LINHAS_DA_PREVIA pedidos (5 pedidos rendem
      // >= 5 linhas; o corte final e por linha) e o desempate por
      // external_order_id entra no CTE para o limite pequeno escolher os
      // MESMOS pedidos que a ordenacao final das linhas escolheria num empate
      // de occurred_at. O caminho completo fica byte a byte como era.
      `WITH detailed AS (
         SELECT external_order_id, occurred_at, provider_status, currency, gross, buyer_shipping, fulfillment
           FROM workspace_channel_orders
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
            AND occurred_at >= $4 AND occurred_at <= $5 AND status = ANY($6::text[])
          ORDER BY occurred_at DESC${detalhe === "previa" ? ", external_order_id" : ""}
          LIMIT $7
       )
       SELECT d.external_order_id, d.occurred_at, d.provider_status, d.currency, d.gross,
              d.buyer_shipping, d.fulfillment,
              i.line_no, i.external_product_id, i.sku, i.title, i.qty, i.unit_price,
              fc.amount AS commission, fs.amount AS seller_shipping
         FROM detailed d
         JOIN workspace_channel_order_items i
           ON i.workspace_id = $1 AND i.provider = $2 AND i.connection_id = $3
          AND i.external_order_id = d.external_order_id
         LEFT JOIN LATERAL (
           SELECT SUM(amount) AS amount FROM workspace_channel_order_fees f
            WHERE f.workspace_id = $1 AND f.provider = $2 AND f.connection_id = $3
              AND f.external_order_id = d.external_order_id AND f.fee_type = 'commission'
         ) fc ON true
         LEFT JOIN LATERAL (
           SELECT SUM(amount) AS amount FROM workspace_channel_order_fees f
            WHERE f.workspace_id = $1 AND f.provider = $2 AND f.connection_id = $3
              AND f.external_order_id = d.external_order_id AND f.fee_type = 'shipping_seller'
         ) fs ON true
        ORDER BY d.occurred_at DESC, d.external_order_id, i.line_no`,
      [...scopeParams(connection.id, period), REVENUE_STATUSES,
       detalhe === "previa" ? LINHAS_DA_PREVIA : DETAILED_ORDER_LIMIT]
    ),
    dbQuery<{ payload: MercadoLivreProduct }>(
      `SELECT payload FROM workspace_marketplace_products
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
        ORDER BY synced_at DESC`,
      [workspaceId, PROVIDER, connection.id]
    ),
    getCosts(),
    // Agregado sobre TODOS os pedidos do período (não só os 1000 detalhados).
    dbQuery<AggRow>(
      `WITH scoped AS (
         SELECT o.gross, o.buyer_shipping,
                EXISTS (SELECT 1 FROM workspace_channel_order_items i
                         WHERE i.workspace_id = o.workspace_id AND i.provider = o.provider
                           AND i.connection_id = o.connection_id AND i.external_order_id = o.external_order_id) AS has_items,
                (SELECT SUM(f.amount) FROM workspace_channel_order_fees f
                  WHERE f.workspace_id = o.workspace_id AND f.provider = o.provider
                    AND f.connection_id = o.connection_id AND f.external_order_id = o.external_order_id
                    AND f.fee_type = 'commission') AS commission,
                (SELECT SUM(f.amount) FROM workspace_channel_order_fees f
                  WHERE f.workspace_id = o.workspace_id AND f.provider = o.provider
                    AND f.connection_id = o.connection_id AND f.external_order_id = o.external_order_id
                    AND f.fee_type = 'shipping_seller') AS seller_shipping
           FROM workspace_channel_orders o
          WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
            AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status = ANY($6::text[])
       )
       -- Tudo restrito aos pedidos com itens conciliados: é o conjunto para o
       -- qual sabemos receita, tarifa E custo. Incluir tarifa de pedido sem
       -- custo conhecido distorceria a margem nos dois sentidos.
       SELECT COUNT(*) FILTER (WHERE has_items)::int AS orders_processed,
              SUM(gross) FILTER (WHERE has_items) AS processed_revenue,
              SUM(buyer_shipping) FILTER (WHERE has_items) AS buyer_shipping,
              SUM(commission) FILTER (WHERE has_items) AS fees,
              SUM(seller_shipping) FILTER (WHERE has_items) AS seller_shipping,
              COUNT(*) FILTER (WHERE has_items AND seller_shipping IS NOT NULL)::int AS orders_with_shipping
         FROM scoped`,
      [...scopeParams(connection.id, period), REVENUE_STATUSES]
    ),
    // Unidades por produto/dia para o custo por vigência em todo o período.
    dbQuery<CogsRow>(
      `SELECT i.external_product_id, i.sku,
              MIN(o.occurred_at) AS occurred_at,
              SUM(i.qty)::int AS qty
         FROM workspace_channel_order_items i
         JOIN workspace_channel_orders o
           ON o.workspace_id = i.workspace_id AND o.provider = i.provider
          AND o.connection_id = i.connection_id AND o.external_order_id = i.external_order_id
        WHERE i.workspace_id = $1 AND i.provider = $2 AND i.connection_id = $3
          AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status = ANY($6::text[])
        GROUP BY i.external_product_id, i.sku,
                 to_char(o.occurred_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')`,
      [...scopeParams(connection.id, period), REVENUE_STATUSES]
    ),
    // ═══ TARIFA E FRETE POR PRODUTO, sobre TODOS os pedidos do periodo ════════
    //
    // ⚠️ A APURACAO POR PRODUTO NAO PASSA MAIS PELO TETO DE 1000 (13/09/2026).
    // Ela rodava em memoria sobre as linhas DETALHADAS (DETAILED_ORDER_LIMIT), e
    // quando a conta passou de 1000 pedidos por janela (medido: 1240 em 7d,
    // 5388 em 30d na conta real), processedRevenue por produto nunca mais
    // alcancava revenue e o portao `complete` nunca abria — Top 8 inteiro sem
    // margem, inclusive produto com custo cadastrado. O teto continua valendo
    // para a LISTA de pedidos (UI); a conta por produto agrega aqui, no SQL,
    // como o nivel de periodo ja fazia.
    //
    // O RECORTE E POR PEDIDO (licao do ABC da Delta, 12/09/2026): os pedidos do
    // periodo entram primeiro, e as linhas vem TODAS de cada pedido — por isso
    // o denominador do rateio (a janela por pedido) ve o pedido INTEIRO por
    // construcao, nunca so a fatia que casa com um filtro de item.
    //
    // Rateio identico ao allocateByWeight das linhas: por peso de receita; com
    // receita zerada no pedido, divide igual pelas linhas (o allocateByWeight
    // devolve zero nesse caso — aqui a divisao igual e mais honesta e o caso e
    // teorico; a diferenca maxima e o proprio valor da tarifa de um pedido de
    // R$ 0,00). SUM ignora pedido sem tarifa/frete: `completo` e quem decide se
    // o numero pode ser exibido — parcial nunca vaza como total.
    dbQuery<PorProdutoRow>(
      `WITH alvo AS (
         SELECT o.external_order_id
           FROM workspace_channel_orders o
          WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
            AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status = ANY($6::text[])
       ),
       -- LATERAL por pedido DE PROPOSITO (medido em 13/09/2026, EXPLAIN ANALYZE
       -- na conexao de 5.631 pedidos/30d): o join-agregado sobre a tabela de
       -- tarifas fazia o planner varrer a CONEXAO INTEIRA (81.697 linhas,
       -- 76k buffers so nesse ramo). A sonda por id derrubou o total de
       -- 100k para 53k buffers e de 224ms para 187ms no pior periodo.
       pedidos AS (
         SELECT a.external_order_id, t.commission, t.seller_shipping
           FROM alvo a
           CROSS JOIN LATERAL (
             SELECT SUM(f.amount) FILTER (WHERE f.fee_type = 'commission') AS commission,
                    SUM(f.amount) FILTER (WHERE f.fee_type = 'shipping_seller') AS seller_shipping
               FROM workspace_channel_order_fees f
              WHERE f.workspace_id = $1 AND f.provider = $2 AND f.connection_id = $3
                AND f.external_order_id = a.external_order_id
           ) t
       ),
       linhas AS (
         SELECT i.external_product_id, i.sku,
                i.qty * i.unit_price AS receita_linha,
                p.commission, p.seller_shipping,
                SUM(i.qty * i.unit_price) OVER (PARTITION BY i.external_order_id) AS receita_pedido,
                COUNT(*) OVER (PARTITION BY i.external_order_id) AS linhas_pedido
           FROM workspace_channel_order_items i
           JOIN pedidos p ON p.external_order_id = i.external_order_id
          WHERE i.workspace_id = $1 AND i.provider = $2 AND i.connection_id = $3
       )
       SELECT external_product_id, sku,
              SUM(receita_linha) AS receita_apurada,
              SUM(CASE WHEN commission IS NULL THEN NULL
                       WHEN receita_pedido > 0 THEN commission * receita_linha / receita_pedido
                       ELSE commission / linhas_pedido END) AS tarifa,
              SUM(CASE WHEN seller_shipping IS NULL THEN NULL
                       WHEN receita_pedido > 0 THEN seller_shipping * receita_linha / receita_pedido
                       ELSE seller_shipping / linhas_pedido END) AS frete,
              BOOL_AND(commission IS NOT NULL AND seller_shipping IS NOT NULL) AS completo
         FROM linhas
        GROUP BY external_product_id, sku`,
      [...scopeParams(connection.id, period), REVENUE_STATUSES]
    ),
    // ═══ O ESCOPO DA PRÉVIA SAI DO CONJUNTO INTEIRO (contrato de 13/09) ════════
    //
    // Na prévia a lista detalhada só tem os pedidos das 5 linhas, mas a frase
    // "Exibindo os N mais recentes…" descreve o RECORTE COMPLETO — se ela
    // refletisse 5, mentiria. Este COUNT tem a MESMA forma da consulta
    // detalhada completa (top-N por data, só pedidos com item), então devolve
    // exatamente o `linesByOrder.size` que o caminho completo devolveria — uma
    // verdade, duas granularidades. Sem a LATERAL de tarifas, que é onde o
    // caminho completo gasta.
    detalhe === "previa"
      ? dbQuery<{ pedidos_detalhados: number }>(
          `WITH detailed AS (
             SELECT external_order_id
               FROM workspace_channel_orders
              WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
                AND occurred_at >= $4 AND occurred_at <= $5 AND status = ANY($6::text[])
              ORDER BY occurred_at DESC
              LIMIT $7
           )
           SELECT COUNT(DISTINCT d.external_order_id)::int AS pedidos_detalhados
             FROM detailed d
             JOIN workspace_channel_order_items i
               ON i.workspace_id = $1 AND i.provider = $2 AND i.connection_id = $3
              AND i.external_order_id = d.external_order_id`,
          [...scopeParams(connection.id, period), REVENUE_STATUSES, DETAILED_ORDER_LIMIT]
        )
      : Promise.resolve(null),
  ]);

  const taxRate = mercadoLivreTaxRate(connection);
  const currency = totals.currency ?? "BRL";
  const revenue = Number(totals.paid_revenue ?? 0);

  // Produtos ainda vêm da tabela legada (payload pequeno, tem activeSince);
  // o peso da migração estava nos pedidos.
  const products = productRows.map((row) => row.payload);
  for (const product of products) {
    const entry = mercadoLivreCostEntry(costs, connection.id, product.id, product.sku);
    product.cost = entry?.cost && entry.cost > 0 ? entry.cost : null;
  }

  // Totais por produto (todas as vendas do período, sem o corte de detalhe).
  const productTotals = new Map<string, { id: string; sku: string | null; title: string; units: number; revenue: number; processedRevenue: number; cost: number; contribution: number; calculationsComplete: boolean }>();
  const unitsByItem = new Map<string, number>();
  for (const row of productTotalsRows) {
    const key = row.sku || row.external_product_id;
    const current = productTotals.get(key) ?? { id: row.external_product_id, sku: row.sku, title: row.title, units: 0, revenue: 0, processedRevenue: 0, cost: 0, contribution: 0, calculationsComplete: true };
    current.units += row.units;
    current.revenue += Number(row.revenue);
    productTotals.set(key, current);
    unitsByItem.set(row.external_product_id, (unitsByItem.get(row.external_product_id) ?? 0) + row.units);
  }

  // Detalhe por linha: rateia comissão/frete do pedido pelas linhas por peso
  // de receita (mesma regra do overview antigo) e resolve custo por vigência.
  const linesByOrder = new Map<string, DetailedLineRow[]>();
  for (const row of lineRows) {
    const group = linesByOrder.get(row.external_order_id) ?? [];
    group.push(row);
    linesByOrder.set(row.external_order_id, group);
  }

  // Agregado financeiro do período inteiro, vindo do SQL — não depende mais do
  // teto de DETAILED_ORDER_LIMIT, que só limita a lista detalhada abaixo.
  const agg = aggRows[0];
  const fees = Number(agg?.fees ?? 0);
  const sellerShipping = +Number(agg?.seller_shipping ?? 0).toFixed(2);
  const buyerShipping = +Number(agg?.buyer_shipping ?? 0).toFixed(2);
  const processedRevenue = Number(agg?.processed_revenue ?? 0);
  const ordersProcessed = agg?.orders_processed ?? 0;
  const ordersWithShippingKnown = agg?.orders_with_shipping ?? 0;

  // Custo das mercadorias por vigência, sobre TODAS as vendas do período —
  // e, no MESMO laço, o custo POR PRODUTO que a apuração do Top usa (13/09/2026:
  // a apuração por produto saiu do teto de 1000 e passou a cobrir o período
  // inteiro, então o custo dela vem daqui, não das linhas detalhadas).
  let cogs = 0;
  let unitsWithoutCost = 0;
  // SKU e a unidade de ACAO (ver oQueFaltaNoResultado.ts).
  const skusSemCusto = new Set<string>();
  const custoPorProduto = new Map<string, { custo: number; temUnidadeSemCusto: boolean }>();
  for (const row of cogsRows) {
    const entry = mercadoLivreCostEntry(costs, connection.id, row.external_product_id, row.sku);
    const unitCost = entry ? costAt(entry, new Date(row.occurred_at).toISOString()) : 0;
    const chave = row.sku || row.external_product_id;
    const doProduto = custoPorProduto.get(chave) ?? { custo: 0, temUnidadeSemCusto: false };
    if (unitCost > 0) { cogs += unitCost * row.qty; doProduto.custo += unitCost * row.qty; }
    else {
      unitsWithoutCost += row.qty;
      skusSemCusto.add(row.sku ?? row.external_product_id ?? "");
      doProduto.temUnidadeSemCusto = true;
    }
    custoPorProduto.set(chave, doProduto);
  }

  // ═══ A APURAÇÃO POR PRODUTO VEM DO SQL DO PERÍODO INTEIRO (13/09/2026) ══════
  //
  // Antes ela acumulava dentro do laço das linhas DETALHADAS (teto de 1000
  // pedidos): acima do teto, processedRevenue por produto ficava menor que
  // revenue e o portão `complete` do Top nunca abria — margem em travessão para
  // todos, inclusive produto com custo cadastrado. Agora o mesmo portão compara
  // dois números do MESMO universo (todas as vendas do período) e volta a poder
  // fechar. Imposto pela regra do canal (ADR-038): sem alíquota, zero — o rastro
  // fica na pendência, não no número.
  for (const row of porProdutoRows) {
    const chave = row.sku || row.external_product_id;
    const alvo = productTotals.get(chave);
    if (!alvo) continue; // produto sem linha em productTotalsRows não existe no Top
    const custoDoProduto = custoPorProduto.get(chave) ?? { custo: 0, temUnidadeSemCusto: true };
    const receitaApurada = Number(row.receita_apurada ?? 0);
    alvo.processedRevenue = receitaApurada;
    alvo.cost = +custoDoProduto.custo.toFixed(2);
    // Completo = tarifa E frete de todos os pedidos que tocam o produto, E
    // custo de todas as unidades — o mesmo E lógico que as linhas aplicavam.
    const completo = row.completo && !custoDoProduto.temUnidadeSemCusto;
    alvo.calculationsComplete = completo;
    const imposto = taxRate == null ? 0 : receitaApurada * taxRate / 100;
    alvo.contribution = completo
      ? +(receitaApurada - Number(row.tarifa ?? 0) - Number(row.frete ?? 0) - custoDoProduto.custo - imposto).toFixed(2)
      : 0;
    productTotals.set(chave, alvo);
  }

  const profitabilityLines: ProfitabilityLine[] = [];

  for (const [orderId, lines] of linesByOrder) {
    const order = lines[0];
    const commissionKnown = order.commission != null;
    const shippingKnown = order.seller_shipping != null;
    const orderCommission = Number(order.commission ?? 0);
    const orderSellerShipping = Number(order.seller_shipping ?? 0);
    const orderBuyerShipping = order.buyer_shipping == null ? null : Number(order.buyer_shipping);

    const weights = lines.map((line) => line.qty * Number(line.unit_price));
    const commissionShares = allocateByWeight(orderCommission, weights);
    const sellerShares = allocateByWeight(orderSellerShipping, weights);
    const buyerShares = allocateByWeight(orderBuyerShipping ?? 0, weights);

    lines.forEach((line, index) => {
      const lineRevenue = line.qty * Number(line.unit_price);
      const entry = mercadoLivreCostEntry(costs, connection.id, line.external_product_id, line.sku);
      const occurredAt = new Date(line.occurred_at).toISOString();
      const unitCost = entry ? costAt(entry, occurredAt) : 0;
      const lineFees = commissionKnown ? commissionShares[index] : null;
      const lineSellerShipping = shippingKnown ? sellerShares[index] : null;
      const lineBuyerShipping = orderBuyerShipping == null ? null : buyerShares[index];
      // Mesmo contrato do caminho legado: sem alíquota, imposto é desconhecido.
      // ADR-038: sem aliquota, o imposto da LINHA e zero — nao desconhecido.
      const lineTax = taxRate == null ? 0 : lineRevenue * taxRate / 100;
      const lineProductCost = unitCost > 0 ? unitCost * line.qty : null;
      const complete = lineFees != null && lineSellerShipping != null;
      const lineResult = complete
        ? calculateContribution({ revenue: lineRevenue, productCost: lineProductCost, marketplaceFees: lineFees, sellerShipping: lineSellerShipping, tax: lineTax })
        : { contribution: null, marginPct: null, complete: false };
      // ⚠️ A apuração POR PRODUTO não acumula mais aqui (13/09/2026): este laço
      // enxerga só os 1000 pedidos detalhados, e foi por acumular nele que o
      // Top 8 perdeu a margem quando a conta cresceu. Ela vem do SQL do
      // período inteiro (porProdutoRows), acima. Este laço produz só as LINHAS.
      profitabilityLines.push({
        id: `${orderId}:${line.external_product_id}:${line.line_no}`,
        orderId,
        product: line.title,
        sku: line.sku,
        date: occurredAt,
        status: order.provider_status,
        fulfillment: order.fulfillment === "platform" ? "Full" : null,
        unitPrice: Number(line.unit_price),
        quantity: line.qty,
        revenue: lineRevenue,
        currency: line.currency,
        productCost: lineProductCost,
        marketplaceFees: lineFees,
        buyerShipping: lineBuyerShipping,
        buyerShippingIsRevenue: false,
        sellerShipping: lineSellerShipping,
        netReceived: lineSellerShipping != null && lineFees != null ? +(lineRevenue - lineFees - lineSellerShipping).toFixed(2) : null,
        tax: lineTax,
        contribution: lineResult.contribution,
        marginPct: lineResult.marginPct,
        complete: lineResult.complete,
      });
    });
  }

  // `taxes ?? 0`: sem alíquota o lucro sai sem imposto, exatamente como saía
  // antes. Quem avisa é a tela — mudar o número aqui seria alterar o resultado
  // exibido sem a vendedora ter pedido.
  // ⚠️ O ANÚNCIO NÃO ENTRA NO LUCRO DO MERCADO LIVRE — e já entrou, por algumas
  // horas em 30/08/2026. Removido no mesmo dia, por DOIS motivos independentes,
  // cada um suficiente sozinho:
  //
  // 1) DECISÃO DA VENDEDORA: *"nem era pra puxar ads. O ads o seller desconta
  //    depois no mercado livre, quando fizer seu próprio fechamento."* No ML a
  //    conciliação do anúncio é dela, por fora — descontar aqui subtrai duas
  //    vezes. Ver a regra POR CANAL em `financialMath.ts`.
  //
  // 2) O NÚMERO NÃO ERA DEFENSÁVEL: o console de Ads do ML mostrava R$ 44 de
  //    investimento e 71 cliques em 30/08; nós tínhamos gravado R$ 768,86 e
  //    1.228 cliques no mesmo dia. Deixar na tela um desconto que a gente não
  //    consegue explicar é pior que não ter o desconto.
  //
  // A causa da divergência está sendo investigada em `mercadoLivreAdsScheduler.ts`
  // (a janela pedida ao PADS é de 7 dias e o resultado é carimbado como UM dia).
  // A coleta continua rodando — o dado segue sendo gravado e a aba de Anúncios
  // continua lendo. O que saiu daqui é o LUCRO.
  // ═══ A BASE É O FATURAMENTO, E NO ML ELA NÃO É O CARD (01/09/2026) ═════════
  //
  // A decisão dela, repetida quatro vezes: *"TEM QUE ESQUECER O APURADO E LEVAR
  // EM CONSIDERAÇÃO SOMENTE O FATURAMENTO."* O ML dividia por `processedRevenue`
  // — a receita já conciliada — como a Amazon e a Shopee faziam.
  //
  // ⚠️ MAS AQUI HÁ UMA DIFERENÇA QUE OS OUTROS TRÊS CANAIS NÃO TÊM, E ELA É
  // DELIBERADA. O card de Faturamento do ML mostra "Vendas brutas" do painel
  // deles: aprovadas **+ canceladas**, sem frete (ADR-020, e é assim que ela
  // confere contra o ML). A base do LUCRO não pode incluir cancelada: venda
  // cancelada não tem custo nem tarifa, e somá-la à receita inflaria o
  // resultado com dinheiro que não entrou.
  //
  // Então, no ML, card e base divergem pelo valor das canceladas — e é o único
  // canal onde a DECLARAÇÃO DE BASE continua aparecendo depois desta mudança.
  // Isso não é o defeito de 31/08 voltando: lá as duas bases descreviam a mesma
  // pergunta e uma estava errada; aqui são duas perguntas diferentes, e a tela
  // diz qual é qual com número.
  //
  // Pendente ENTRA (é o que ela pediu), cancelada FICA FORA (é o que a conta
  // exige), e o que falta é sinalizado sem encolher a base.
  const faturamentoDoLucro = Number(totals.faturamento ?? 0);
  // Gasto com anuncio do periodo, para o TACOS. Uma ida a mais, e ela e a mesma
  // que a Amazon ja faz — o helper cai em `workspace_ad_product_metrics` quando
  // nao ha linha por campanha, que e exatamente onde o ML grava.
  const anuncio = await anuncioDoCanal(PROVIDER, period.from.toISOString(), period.to.toISOString());
  /**
   * ⚠️ O IMPOSTO INCIDE SOBRE A MESMA BASE DO LUCRO (01/09/2026).
   *
   * Ele incidia sobre `processedRevenue` enquanto o lucro partia do
   * FATURAMENTO — numerador de um universo, subtracao de outro. E a SEGUNDA
   * forma da familia, a mesma que a Amazon teve em 31/08, e chegou aqui por
   * REPLICACAO INCOMPLETA: quando a base do lucro passou a ser o faturamento,
   * o numerador se moveu e o imposto ficou.
   *
   * Achado pela vendedora em 01/09/2026, no Shopee: ela somou os tres cards da
   * tela (15.734,08 - 4.306,24 - 7.020,48 = 4.407,36) e o lucro exibido era
   * 4.266,39. A diferenca de R$ 140,97 era o imposto — e o imposto estava
   * calculado sobre R$ 14.097,09 (pagos + enviados) em vez de R$ 15.734,08
   * (com os pendentes), subestimado em ~R$ 16,37.
   *
   * 📌 A regra, que vale para TODO componente do lucro: quem subtrai tem de
   * cobrir o mesmo universo de quem soma. Se a base mudar de novo, ESTE calculo
   * muda junto — e e por isso que os dois leem a mesma variavel, em vez de duas
   * variaveis que por acaso coincidem hoje.
   */
  // ADR-038: aliquota ausente vale zero; `taxRateKnown` carrega a pendencia.
  const taxes = taxRate == null ? 0 : faturamentoDoLucro * taxRate / 100;
  const pedidosSemValor = totals.sem_valor ?? 0;
  const estimatedProfit = faturamentoDoLucro - fees - cogs - (taxes ?? 0) - sellerShipping;

  /**
   * ⚠️ AS FATIAS DO PAINEL, TODAS NO UNIVERSO QUE ELE DECLARA (02/09/2026).
   *
   * O painel de composicao do ML mostra no centro a RECEITA PROCESSADA e, ate
   * aqui, exibia embaixo o `estimatedProfit` e a `marginPct` — que sao do
   * periodo INTEIRO, calculados sobre o faturamento. Centro de um universo,
   * resultado de outro: a mesma familia que produziu margem de 5673% no painel
   * da Amazon e o widget da Shopee estourando o proprio todo.
   *
   * Aqui o resultado e o RESIDUO do proprio bloco, e a margem sai sobre o
   * proprio centro — [ADR-028]. O imposto tambem: ele incide sobre a receita
   * DESTE bloco, nao sobre o faturamento, senao a subtracao cobre um universo
   * maior que a soma.
   *
   * 📌 O LUCRO DO PERIODO CONTINUA EXISTINDO e continua sendo `estimatedProfit`,
   * nos cards. Sao dois numeros legitimos e diferentes — e e o NOME que impede a
   * confusao, nao a supressao de um deles.
   */
  const impostoDaReceitaPaga = taxRate == null ? 0 : +(processedRevenue * taxRate / 100).toFixed(2);
  const composicaoDaReceitaPaga = {
    receita: processedRevenue,
    fees,
    sellerShipping,
    cogs,
    taxes: impostoDaReceitaPaga,
    lucro: +(processedRevenue - fees - sellerShipping - cogs - (impostoDaReceitaPaga ?? 0)).toFixed(2),
    margemPct: processedRevenue > 0
      ? +(((processedRevenue - fees - sellerShipping - cogs - (impostoDaReceitaPaga ?? 0)) / processedRevenue) * 100).toFixed(2)
      : null,
  };

  // Cobertura: mesmo critério do loadMercadoLivreSource.
  const coveredFrom = syncRow.covered_from ? new Date(syncRow.covered_from).getTime() : Number.POSITIVE_INFINITY;
  const coveredTo = syncRow.covered_to ? new Date(syncRow.covered_to).getTime() : 0;
  const periodCovered = coveredFrom <= period.from.getTime()
    && coveredTo + COVERAGE_TOLERANCE_MS >= period.to.getTime()
    && !!syncRow.products_synced_at;

  // ═══ LUCRO POR DIA — e a semântica do `null` é o coração deste bloco ═══════
  //
  // ⚠️ DOIS SILÊNCIOS DIFERENTES, e dar zero aos dois seria mentir num deles:
  //
  //   dia SEM venda ................ lucro 0. É FATO: não vendeu, não lucrou.
  //   dia COM venda e custo/tarifa
  //   ainda desconhecidos .......... lucro `null`. É DESCONHECIDO — e zero ali
  //                                  desenharia uma queda que não aconteceu.
  //
  // 📌 É a regra `null ≠ 0` da casa aplicada a uma série temporal, onde ela é
  // ainda mais traiçoeira: um zero no gráfico não parece ausência, parece
  // NOTÍCIA RUIM. A tela desenha ausência como ausência de coluna.
  //
  // ⚠️ E o preenchimento de dia vazio com zeros — correto para o faturamento,
  // logo abaixo — **não pode ser copiado para cá**. Lá o dia sem venda é zero de
  // verdade; aqui só é zero quando não houve venda.
  const custoPorDia = new Map<string, { custo: number; temUnidadeSemCusto: boolean }>();
  for (const linha of unidadesDoDiaRows) {
    const entrada = mercadoLivreCostEntry(costs, connection.id, linha.external_product_id, linha.sku);
    // Custo POR VIGÊNCIA da data daquele dia: o mesmo `costAt` do resto.
    const unitario = entrada ? costAt(entrada, new Date(linha.occurred_at).toISOString()) : 0;
    const atual = custoPorDia.get(linha.date) ?? { custo: 0, temUnidadeSemCusto: false };
    if (unitario > 0) atual.custo += unitario * linha.units;
    else atual.temUnidadeSemCusto = true;
    custoPorDia.set(linha.date, atual);
  }

  const lucroPorDia = new Map<string, number | null>();
  for (const linha of diasDoLucroRows) {
    const receita = Number(linha.receita ?? 0);
    const custoDoDia = custoPorDia.get(linha.date);
    // COMPLETUDE, o mesmo critério da faixa aplicado ao recorte do dia:
    // tarifa de TODOS os pedidos do dia, custo de TODAS as unidades, e alíquota
    // cadastrada. Faltando qualquer uma, o lucro daquele dia é desconhecido.
    const tarifaCompleta = linha.pedidos_com_tarifa >= linha.pedidos;
    const custoCompleto = !!custoDoDia && !custoDoDia.temUnidadeSemCusto;
    if (!tarifaCompleta || !custoCompleto || taxRate == null) {
      lucroPorDia.set(linha.date, null);
      continue;
    }
    const imposto = receita * taxRate / 100;
    lucroPorDia.set(linha.date, +(receita - Number(linha.tarifa ?? 0) - custoDoDia.custo - imposto).toFixed(2));
  }

  // Série diária contínua, com dias sem venda zerados.
  const daily = new Map(dailyRows.map((row) => [row.date, { date: row.date, revenue: Number(row.revenue), orders: row.orders, units: row.units }]));
  const dailySales: Array<{ date: string; revenue: number; orders: number; units: number; profit: number | null }> = [];
  const cursor = new Date(`${brazilDateKey(period.from)}T12:00:00Z`);
  const lastDate = brazilDateKey(period.to);
  while (cursor.toISOString().slice(0, 10) <= lastDate) {
    const date = cursor.toISOString().slice(0, 10);
    const doDia = daily.get(date);
    // Dia sem linha nenhuma = dia sem venda: faturamento 0 (fato) e lucro 0
    // (fato — não vendeu, não lucrou). Dia COM venda usa o mapa, que já traz
    // `null` quando algum componente do lucro é desconhecido.
    dailySales.push(doDia
      ? { ...doDia, profit: lucroPorDia.has(date) ? lucroPorDia.get(date)! : null }
      : { date, revenue: 0, orders: 0, units: 0, profit: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const periodDays = Math.max(1, Math.ceil((period.to.getTime() - period.from.getTime()) / 86_400_000));
  // ⚠️ Anúncio PAUSADO sem estoque não é ruptura — é anúncio desligado.
  //
  // Antes o radar incluía todo "active ou paused", e como pausado costuma estar
  // zerado, ele virava "out" e entrava na contagem de estoque crítico. Na conta
  // medida em 23/08/2026: 301 produtos alertados, dos quais **294 eram anúncios
  // pausados com estoque zero**. Os 29 anúncios ativos tinham todos estoque
  // positivo — ou seja, o alerta inteiro era ruído e escondia o que importa.
  //
  // A regra passa a ser: anúncio ATIVO sempre entra (zerado nele é ruptura de
  // verdade); anúncio pausado só entra se ainda tem estoque parado, que é a
  // informação útil ("tem mercadoria presa num anúncio desligado").
  const stockRadar = products
    .filter((product) => product.status === "active" || (product.status === "paused" && product.availableQuantity > 0))
    .map((product) => {
    const unitsSold = unitsByItem.get(product.id) ?? 0;
    const listingStart = product.activeSince ? new Date(product.activeSince).getTime() : Number.NaN;
    const effectiveStart = Number.isFinite(listingStart) ? Math.max(period.from.getTime(), listingStart) : period.from.getTime();
    const calculationDays = Math.max(1, Math.min(periodDays, Math.ceil((period.to.getTime() - effectiveStart) / 86_400_000)));
    const perDay = unitsSold / calculationDays;
    const daysRemaining = perDay > 0 ? Math.floor(product.availableQuantity / perDay) : null;
    // Mesma regra da Amazon, do mesmo lugar (`src/lib/radar.ts`). Antes havia uma
    // cópia de três status aqui, e nela anúncio com estoque e ZERO venda saía
    // como "Saudável" — ver `classificarCobertura`.
    const status = classificarCobertura({ disponivel: product.availableQuantity, porDia: perDay, diasRestantes: daysRemaining });
    // A foto já vinha no payload do anúncio e nunca chegava à tela: quem olha
    // ruptura reconhece o produto pela imagem antes de ler o SKU.
    return { id: product.id, sku: product.sku, title: product.title, thumbnail: product.thumbnail, availableQuantity: product.availableQuantity, unitsSold, calculationDays, daysRemaining, status };
  }).sort((a, b) => {
    const rank = (status: StockStatus) => ORDEM_DO_RADAR[status];
    return rank(a.status) - rank(b.status) || (a.daysRemaining ?? Infinity) - (b.daysRemaining ?? Infinity);
  });

  return {
    account: {
      id: connection.externalAccountId,
      nickname: String(connection.metadata.nickname ?? connection.displayName ?? "Mercado Livre"),
      siteId: String(connection.metadata.siteId ?? connection.region ?? "MLB"),
    },
    period: { from: period.from.toISOString(), to: period.to.toISOString(), label: period.label ?? "Últimos 30 dias" },
    metrics: {
      activeListings: syncRow.active_products,
      productsWithoutCost: products.filter((product) => product.cost == null || product.cost <= 0).length,
      orders30d: totals.total_orders,
      paidOrders: totals.paid_orders,
      revenue30d: revenue,
      approvedRevenue: Number(totals.approved_revenue ?? 0),
      cancelledRevenue: Number(totals.cancelled_revenue ?? 0),
      cancelledOrders: totals.cancelled_orders,
      pendingOrders: totals.pending_orders,
      pendingRevenue: totals.pending_revenue == null ? null : Number(totals.pending_revenue),
      lastSaleAt: totals.last_sale_at ? new Date(totals.last_sale_at).toISOString() : null,
      currency,
      // ⚠️ `capturedOrders` e `totalOrders` são o MESMO valor, e sempre foram —
      // por isso a tela comparava um número com ele mesmo e caía numa mensagem
      // que sugeria pedido faltando. Cobertura aqui NÃO é sobre contagem de
      // pedidos: é sobre a JANELA que o sync já importou. Quem diz isso são as
      // datas, e é o que a tela precisa mostrar.
      revenueCoverage: {
        capturedOrders: totals.total_orders,
        totalOrders: totals.total_orders,
        complete: periodCovered,
        sincronizadoAte: syncRow?.covered_to ? new Date(syncRow.covered_to).toISOString() : null,
        historicoDesde: syncRow?.covered_from ? new Date(syncRow.covered_from).toISOString() : null,
      },
    },
    profit: {
      fees,
      cogs,
      taxes,
      taxRate,
      /**
       * ⚠️ O RASTRO DA EXCECAO (ADR-038). `false` = zero porque ninguem
       * cadastrou aliquota; `true` = zero porque ela declarou 0%. As duas
       * contas sao IDENTICAS, e este booleano e a unica diferenca — a tela nao
       * pode derivar a pendencia de `taxRate == null`, que se apaga sozinho no
       * dia em que alguem cadastrar 0 de verdade.
       */
      taxRateKnown: taxRate != null,
      sellerShipping,
      buyerShipping,
      shippingCostsComplete: periodCovered && ordersWithShippingKnown >= ordersProcessed,
      revenueProcessed: processedRevenue,
      composicaoDaReceitaPaga,
      coverage: { processedOrders: ordersProcessed, paidOrders: totals.paid_orders, complete: periodCovered && ordersProcessed >= totals.paid_orders },
      estimatedProfit,
      /**
       * ⚠️ TACOS EXISTE AQUI SEM O ANUNCIO ENTRAR NO LUCRO — e os dois fatos
       * convivem de proposito. A decisao dela de 30/08 tirou o anuncio do LUCRO
       * do ML ("o ads o seller desconta depois, no seu proprio fechamento");
       * TACOS nao desconta nada, so DIVIDE. Sao perguntas diferentes.
       *
       * 📌 E o dado voltou a ser confiavel, medido em 06/09/2026: em 30/08 —
       * o dia do defeito — gravamos R$ 46,55 / 84 cliques contra R$ 44,00 / 71
       * do console do ML. Antes da correcao do agendador eram R$ 768,86 e 1.228
       * cliques. Sem essa medicao eu teria publicado um TACOS 17x inflado.
       */
      // `ads: null` = "este canal não desconta anúncio", não "não sei quanto foi".
      // O gasto existe e a aba de Anúncios o mostra; ele só não entra no lucro.
      ads: null,
      adsDesconhecido: false,
      adsAteDia: null,
      /**
       * TACOS do periodo. A base e `faturamentoDoLucro` (todo pedido NAO
       * cancelado), nunca `paid_revenue` — cancelada no denominador o infla, e
       * denominador inflado e o "mentir para baixo" que a garantia proibe.
       */
      tacos: tacosDoPeriodo({
        gasto: anuncio.gasto,
        faturamento: faturamentoDoLucro,
        pedidosSemValor: totals.sem_valor ?? 0,
      }),
      /** Ultimo dia com gasto coletado — o dia corrente ainda soma. */
      tacosAteDia: anuncio.ateDia,
      // Numerador e denominador saem da MESMA base — trocar só um dos dois é o
      // que produziu −90,5% e +120,9% na Amazon em 31/08/2026.
      marginPct: faturamentoDoLucro > 0 ? estimatedProfit / faturamentoDoLucro * 100 : null,
      // O contrato que a tela do ML já espera (a Vitrine deixou pronto): com
      // estes dois campos ela declara a base e aponta o que falta, com número.
      revenueDoLucro: +faturamentoDoLucro.toFixed(2),
      pedidosSemApuracao: pedidosSemValor,
      unitsWithoutCost,
      skusWithoutCost: skusSemCusto.size,
    },
    dailySales,
    stockRadar,
    topProducts: [...productTotals.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8)
      .map((product) => {
        const complete = product.calculationsComplete && Math.abs(product.processedRevenue - product.revenue) < 0.01;
        return {
          id: product.id,
          sku: product.sku,
          title: product.title,
          units: product.units,
          revenue: product.revenue,
          cost: product.cost,
          contribution: product.contribution,
          complete,
          marginPct: complete && product.revenue > 0 ? product.contribution / product.revenue * 100 : null,
        };
      }),
    // O corte da prévia é POR LINHA, na ordenação que a consulta já entrega
    // (occurred_at DESC, external_order_id, line_no) — pedido de 3 itens ocupa
    // 3 vagas, contrato de 13/09/2026.
    profitabilityLines: detalhe === "previa" ? profitabilityLines.slice(0, LINHAS_DA_PREVIA) : profitabilityLines,
    // Lista cheia no teto = houve corte (os N mais recentes); abaixo do teto,
    // tudo que existia entrou e não há o que avisar.
    //
    // ⚠️ NA PRÉVIA o escopo NUNCA sai da lista cortada: sai do COUNT sobre o
    // conjunto inteiro (escopoRows) — a frase de escopo é o único aviso do
    // recorte e não pode refletir 5.
    profitabilityScope: (() => {
      const pedidosDetalhados = detalhe === "previa"
        ? (escopoRows?.[0]?.pedidos_detalhados ?? 0)
        : linesByOrder.size;
      return {
        detailedOrders: pedidosDetalhados,
        completePeriod: pedidosDetalhados < DETAILED_ORDER_LIMIT,
      };
    })(),
    recentOrders: recentRows.map((row) => ({
      id: row.external_order_id,
      packId: row.pack_id,
      status: row.provider_status,
      createdAt: new Date(row.occurred_at).toISOString(),
      total: Number(row.gross),
      currency: row.currency,
      items: row.units,
    })),
  };
}
