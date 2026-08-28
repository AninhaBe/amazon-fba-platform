import { dbQuery, hasDb } from "../db";
import { cached } from "../cache";
import type { IntegrationConnection } from "./types";
import { currentWorkspaceId } from "../workspaceScope";
import { shopeeFetch } from "./shopee";
import { PUNICAO_ENCERRADA, PUNICAO_VIGENTE, situacaoDaMetrica, type SituacaoDaMetrica } from "./shopeeAccountHealthMapa";

// Saúde da conta Shopee (decisão da Ana, 28/08/2026; sondado na loja real antes
// de desenhar): leitura de ESTADO, não histórico — não entra no sync engine nem
// persiste canônico. Cache de 30 min com o instante da leitura exposto na tela
// ("lido há X min" — cache honesto, adição do cérebro).
//
// Veredito de categoria registrado: shop_penalty responde api_suspended ao
// nosso app (ERP). O total consolidado de pontos vigentes NÃO é afirmável;
// mostramos a lista do penalty_point_history e as punições por status, que são
// o que a API entrega de fato.

const PROVIDER = "shopee";
const CACHE_TTL_MS = 30 * 60_000;

interface PerformanceResponse {
  overall_performance?: {
    rating?: number;
    fulfillment_failed?: number;
    listing_failed?: number;
    custom_service_failed?: number;
  };
  metric_list?: Array<{
    metric_type?: number;
    metric_id?: number;
    parent_metric_id?: number;
    metric_name?: string;
    current_period?: number | null;
    last_period?: number | null;
    unit?: number;
    target?: { value?: number; comparator?: string };
  }>;
}

interface PunicaoCrua {
  issue_time?: number;
  punishment_type?: number;
  reason?: number;
  start_time?: number;
  end_time?: number;
  order_limit?: string;
  listing_limit?: number;
}

export interface MetricaDeSaude {
  nome: string;
  grupo: number;
  valorAtual: number | null;
  valorAnterior: number | null;
  unidade: number | null;
  alvo: number | null;
  comparador: string | null;
  /** Calculada pelo comparador da PRÓPRIA API; null = sem julgamento. */
  situacao: SituacaoDaMetrica;
}

export interface ShopeeSaudeDaConta {
  /** Instante REAL da leitura na API — congela junto com o cache, de propósito. */
  lidoEm: string;
  nota: {
    rating: number | null;
    enviosReprovados: number;
    anunciosReprovados: number;
    atendimentoReprovado: number;
  };
  metricas: MetricaDeSaude[];
  punicoesVigentes: Array<{ tipo: number | null; motivo: number | null; inicio: string | null; fim: string | null; limiteDePedidos: string | null }>;
  punicoesEncerradas: { total: number; recentes: Array<{ tipo: number | null; motivo: number | null; inicio: string | null; fim: string | null; limiteDePedidos: string | null }> };
  pontosDePenalidade: Array<{ emitidoEm: string | null; tipoDeViolacao: number | null; pontos: number | null }>;
  pedidosAtrasados: number;
  anunciosComProblema: Array<{ itemId: string; motivo: number | null; titulo: string | null; sku: string | null }>;
}

function epochIso(value?: number): string | null {
  return value ? new Date(value * 1000).toISOString() : null;
}

function punicao(row: PunicaoCrua) {
  return {
    tipo: row.punishment_type ?? null,
    motivo: row.reason ?? null,
    inicio: epochIso(row.start_time),
    fim: epochIso(row.end_time),
    // "95" = teto de pedidos em 95% — campo autodescritivo; vazio vira null.
    limiteDePedidos: row.order_limit ? String(row.order_limit) : null,
  };
}

async function lerSaude(connection: IntegrationConnection): Promise<ShopeeSaudeDaConta> {
  const [performance, vigentes, encerradas, pontos, atrasados, comProblema] = await Promise.all([
    shopeeFetch<PerformanceResponse>(connection, "/api/v2/account_health/get_shop_performance"),
    shopeeFetch<{ total_count?: number; punishment_list?: PunicaoCrua[] }>(
      connection, "/api/v2/account_health/get_punishment_history",
      { page_no: "1", page_size: "20", punishment_status: String(PUNICAO_VIGENTE) }
    ),
    shopeeFetch<{ total_count?: number; punishment_list?: PunicaoCrua[] }>(
      connection, "/api/v2/account_health/get_punishment_history",
      { page_no: "1", page_size: "20", punishment_status: String(PUNICAO_ENCERRADA) }
    ),
    shopeeFetch<{ total_count?: number; penalty_point_list?: Array<{ issue_time?: number; violation_type?: number; latest_point_num?: number }> }>(
      connection, "/api/v2/account_health/get_penalty_point_history", { page_no: "1", page_size: "20" }
    ),
    shopeeFetch<{ total_count?: number }>(
      connection, "/api/v2/account_health/get_late_orders", { page_no: "1", page_size: "20" }
    ),
    shopeeFetch<{ total_count?: number; listing_list?: Array<{ item_id?: number; reason?: number }> }>(
      connection, "/api/v2/account_health/get_listings_with_issues", { page_no: "1", page_size: "20" }
    ),
  ]);

  const metricas: MetricaDeSaude[] = (performance.metric_list ?? []).map((metrica) => ({
    nome: metrica.metric_name ?? "",
    grupo: metrica.metric_type ?? 0,
    valorAtual: metrica.current_period ?? null,
    valorAnterior: metrica.last_period ?? null,
    unidade: metrica.unit ?? null,
    alvo: metrica.target?.value ?? null,
    comparador: metrica.target?.comparator ?? null,
    situacao: metrica.target?.value == null || !metrica.target?.comparator
      ? null
      : situacaoDaMetrica({
          valorAtual: metrica.current_period ?? null,
          alvo: metrica.target.value,
          comparador: metrica.target.comparator,
        }),
  }));

  // Título/SKU dos anúncios com problema vêm do catálogo canônico (a API só dá
  // o item_id). Item fora do catálogo fica com título null — a tela mostra o id.
  const ids = (comProblema.listing_list ?? []).map((item) => String(item.item_id ?? "")).filter(Boolean);
  const porItem = new Map<string, { titulo: string | null; sku: string | null }>();
  if (ids.length && hasDb()) {
    const rows = await dbQuery<{ external_product_id: string; title: string | null; sku: string | null }>(
      `SELECT external_product_id, title, sku FROM workspace_channel_products
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND external_product_id = ANY($4::text[])`,
      [currentWorkspaceId(), PROVIDER, connection.id, ids]
    );
    for (const row of rows) porItem.set(row.external_product_id, { titulo: row.title, sku: row.sku });
  }

  return {
    lidoEm: new Date().toISOString(),
    nota: {
      rating: performance.overall_performance?.rating ?? null,
      enviosReprovados: performance.overall_performance?.fulfillment_failed ?? 0,
      anunciosReprovados: performance.overall_performance?.listing_failed ?? 0,
      atendimentoReprovado: performance.overall_performance?.custom_service_failed ?? 0,
    },
    metricas,
    punicoesVigentes: (vigentes.punishment_list ?? []).map(punicao),
    punicoesEncerradas: {
      total: encerradas.total_count ?? (encerradas.punishment_list ?? []).length,
      recentes: (encerradas.punishment_list ?? []).map(punicao),
    },
    pontosDePenalidade: (pontos.penalty_point_list ?? []).map((row) => ({
      emitidoEm: epochIso(row.issue_time),
      tipoDeViolacao: row.violation_type ?? null,
      pontos: row.latest_point_num ?? null,
    })),
    pedidosAtrasados: atrasados.total_count ?? 0,
    anunciosComProblema: (comProblema.listing_list ?? []).map((item) => ({
      itemId: String(item.item_id ?? ""),
      motivo: item.reason ?? null,
      titulo: porItem.get(String(item.item_id ?? ""))?.titulo ?? null,
      sku: porItem.get(String(item.item_id ?? ""))?.sku ?? null,
    })),
  };
}

/** Leitura com cache de 30 min por conexão; `lidoEm` diz a verdade do cache. */
export async function getShopeeSaudeDaConta(connection: IntegrationConnection): Promise<ShopeeSaudeDaConta> {
  return cached(`shopee-saude:${connection.id}`, CACHE_TTL_MS, () => lerSaude(connection));
}
