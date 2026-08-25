import { dbQuery } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { adsAccessToken, getAdsCredentials } from "./amazonAdsAuth";

/**
 * Ingestão de métricas de anúncio da Amazon.
 *
 * ⚠️ O RELATÓRIO É ASSÍNCRONO, E ISSO DEFINE TODO O DESENHO.
 *
 * Medido em 25/08/2026, no primeiro relatório desta conta: mais de 30 minutos
 * entre `PENDING` e `COMPLETED`. Nenhuma tela pode esperar por isso — se alguém
 * ligar "abrir a aba dispara o relatório", a pessoa olha um esqueleto por meia
 * hora.
 *
 * Então são DOIS passos, em ciclos diferentes do cron:
 *
 *   pedirRelatorio()   → cria na Amazon, grava o report_id em `workspace_ad_reports`
 *   colherRelatorios() → busca os pendentes; quando COMPLETED, grava as métricas
 *
 * A tela nunca chama nenhum dos dois: ela lê `workspace_ad_metrics`.
 *
 * 📌 É a mesma forma do extrato do TikTok, e pelo mesmo motivo. Lá, um passo que
 * pedia sem colher travou a fila por 85 rodadas — por isso a tabela de pedidos
 * existe antes de a primeira métrica ser gravada.
 */

const PROVIDER = "amazon";
const HOST = process.env.ADS_API_HOST ?? "https://advertising-api.amazon.com";

/** Um relatório em voo já basta: pedir de novo antes de colher é o defeito do TikTok. */
const MAX_PENDENTES = 1;

/** A Amazon não entrega relatório do dia corrente fechado — o último dia útil é ontem. */
function janela(dias: number): { inicio: string; fim: string } {
  const dia = (atras: number) => new Date(Date.now() - atras * 86_400_000).toISOString().slice(0, 10);
  return { inicio: dia(dias), fim: dia(1) };
}

interface LinhaDoRelatorio {
  date?: string;
  campaignId?: string | number;
  campaignName?: string;
  impressions?: number;
  clicks?: number;
  cost?: number;
  purchases30d?: number;
  sales30d?: number;
}

async function cabecalhos(): Promise<{ headers: Record<string, string>; connectionId: string } | null> {
  const cred = await getAdsCredentials();
  if (!cred?.refreshToken || !cred.profileId) return null;
  const token = await adsAccessToken(cred.refreshToken);
  return {
    connectionId: String(cred.profileId),
    headers: {
      authorization: `Bearer ${token}`,
      "Amazon-Advertising-API-ClientId": process.env.ADS_CLIENT_ID ?? "",
      "Amazon-Advertising-API-Scope": String(cred.profileId),
    },
  };
}

/**
 * Pede um relatório novo, se não houver nenhum em voo.
 * Devolve o `reportId` criado, ou `null` quando não havia o que fazer.
 */
export async function pedirRelatorioDeAnuncios(dias = 30): Promise<string | null> {
  const ctx = await cabecalhos();
  if (!ctx) return null;

  const pendentes = await dbQuery<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM workspace_ad_reports
      WHERE workspace_id=$1 AND provider=$2 AND status='pending'`,
    [currentWorkspaceId(), PROVIDER],
  );
  if (Number(pendentes[0]?.n ?? 0) >= MAX_PENDENTES) return null;

  const { inicio, fim } = janela(dias);
  const res = await fetch(`${HOST}/reporting/reports`, {
    method: "POST",
    headers: { ...ctx.headers, "content-type": "application/vnd.createasyncreportrequest.v3+json" },
    body: JSON.stringify({
      name: `nexo-${inicio}-${fim}`,
      startDate: inicio,
      endDate: fim,
      configuration: {
        adProduct: "SPONSORED_PRODUCTS",
        // `date` no groupBy é o que dá granularidade diária — sem ele o
        // relatório volta somado e a tela não consegue filtrar 7/15/30 dias.
        groupBy: ["campaign"],
        columns: ["date", "campaignId", "campaignName", "impressions", "clicks", "cost", "purchases30d", "sales30d"],
        reportTypeId: "spCampaigns",
        timeUnit: "DAILY",
        format: "GZIP_JSON",
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const corpo = (await res.json()) as { reportId?: string; detail?: string };
  if (!res.ok || !corpo.reportId) {
    throw new Error(`Pedido de relatório falhou (HTTP ${res.status}): ${corpo.detail ?? "sem detalhe"}`);
  }

  await dbQuery(
    `INSERT INTO workspace_ad_reports
       (workspace_id,provider,connection_id,report_id,start_date,end_date,status)
     VALUES ($1,$2,$3,$4,$5,$6,'pending')
     ON CONFLICT (workspace_id,provider,connection_id,report_id) DO NOTHING`,
    [currentWorkspaceId(), PROVIDER, ctx.connectionId, corpo.reportId, inicio, fim],
  );
  return corpo.reportId;
}

/**
 * Busca os relatórios pendentes. Grava as métricas dos que ficaram prontos.
 * Devolve quantas LINHAS foram gravadas.
 */
export async function colherRelatoriosDeAnuncios(): Promise<number> {
  const ctx = await cabecalhos();
  if (!ctx) return 0;

  const pendentes = await dbQuery<{ report_id: string; connection_id: string }>(
    `SELECT report_id, connection_id FROM workspace_ad_reports
      WHERE workspace_id=$1 AND provider=$2 AND status='pending'
      ORDER BY requested_at LIMIT 5`,
    [currentWorkspaceId(), PROVIDER],
  );

  let gravadas = 0;
  for (const p of pendentes) {
    const res = await fetch(`${HOST}/reporting/reports/${p.report_id}`, {
      headers: ctx.headers,
      signal: AbortSignal.timeout(20_000),
    });
    const st = (await res.json()) as { status?: string; url?: string; failureReason?: string };

    if (st.status === "FAILED") {
      await marcar(p.report_id, p.connection_id, "failed", st.failureReason ?? "sem motivo");
      continue;
    }
    // PENDING e PROCESSING não são erro: é o comportamento normal por ~30 min.
    if (st.status !== "COMPLETED" || !st.url) continue;

    const gz = Buffer.from(await (await fetch(st.url)).arrayBuffer());
    const { gunzipSync } = await import("node:zlib");
    const linhas = JSON.parse(gunzipSync(gz).toString("utf8")) as LinhaDoRelatorio[];

    for (const l of linhas) {
      if (!l.date || l.campaignId == null) continue;
      await dbQuery(
        `INSERT INTO workspace_ad_metrics
           (workspace_id,provider,connection_id,day,campaign_id,campaign_name,
            impressions,clicks,cost,purchases,sales,synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
         ON CONFLICT (workspace_id,provider,connection_id,day,campaign_id)
         DO UPDATE SET campaign_name=EXCLUDED.campaign_name,
                       impressions=EXCLUDED.impressions, clicks=EXCLUDED.clicks,
                       cost=EXCLUDED.cost, purchases=EXCLUDED.purchases,
                       sales=EXCLUDED.sales, synced_at=now()`,
        [
          currentWorkspaceId(), PROVIDER, p.connection_id, l.date, String(l.campaignId),
          l.campaignName ?? null, l.impressions ?? 0, l.clicks ?? 0,
          l.cost ?? 0, l.purchases30d ?? 0, l.sales30d ?? 0,
        ],
      );
      gravadas += 1;
    }
    await marcar(p.report_id, p.connection_id, "completed", null);
  }
  return gravadas;
}

async function marcar(reportId: string, connectionId: string, status: string, erro: string | null): Promise<void> {
  await dbQuery(
    `UPDATE workspace_ad_reports SET status=$5, last_error=$6, updated_at=now()
      WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3 AND report_id=$4`,
    [currentWorkspaceId(), PROVIDER, connectionId, reportId, status, erro],
  );
}

export interface ResumoDeAnuncios {
  /** Gasto com anúncio no período. */
  cost: number;
  /** Vendas ATRIBUÍDAS ao anúncio — não é o faturamento do canal. */
  sales: number;
  purchases: number;
  impressions: number;
  clicks: number;
  /** Dia mais recente com dado. `null` quando não há nada gravado. */
  ateDia: string | null;
}

/**
 * O que a tela consome. Lê só do banco — nunca chama a Amazon.
 *
 * Devolve `null` quando NÃO HÁ NENHUMA LINHA: isso é diferente de zero. Sem
 * anúncio sincronizado, os cards mostram "—" e não "R$ 0,00" — a regra do
 * `null ≠ 0` do AGENTS.md, a mesma que fez o card de custo da Amazon parar de
 * afirmar lucro zero quando a Amazon ainda não tinha postado repasse.
 */
export async function resumoDeAnuncios(dias: number): Promise<ResumoDeAnuncios | null> {
  const rows = await dbQuery<{
    cost: string; sales: string; purchases: string;
    impressions: string; clicks: string; ate: string | null; linhas: string;
  }>(
    `SELECT COALESCE(SUM(cost),0)::text        AS cost,
            COALESCE(SUM(sales),0)::text      AS sales,
            COALESCE(SUM(purchases),0)::text  AS purchases,
            COALESCE(SUM(impressions),0)::text AS impressions,
            COALESCE(SUM(clicks),0)::text     AS clicks,
            to_char(MAX(day),'YYYY-MM-DD')    AS ate,
            COUNT(*)::text                    AS linhas
       FROM workspace_ad_metrics
      WHERE workspace_id=$1 AND provider=$2
        AND day >= (now() AT TIME ZONE 'America/Sao_Paulo')::date - $3::int`,
    [currentWorkspaceId(), PROVIDER, dias],
  );
  const r = rows[0];
  if (!r || Number(r.linhas) === 0) return null;
  return {
    cost: Number(r.cost),
    sales: Number(r.sales),
    purchases: Number(r.purchases),
    impressions: Number(r.impressions),
    clicks: Number(r.clicks),
    ateDia: r.ate,
  };
}
