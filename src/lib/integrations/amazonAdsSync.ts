import { dbQuery } from "../db";
import { currentWorkspaceId, runWithWorkspace } from "../workspaceScope";
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

/**
 * A janela do relatório, terminando HOJE.
 *
 * ⚠️ Já foi `ontem`, por suposição minha de que a Amazon não entregava o dia
 * corrente. MEDIDO em 25/08/2026 e é falso: um relatório de 25/08 a 25/08 voltou
 * com 6 linhas, R$ 17,53 e 17 cliques, em 105 segundos.
 *
 * O dado de hoje é REAL, mas ainda está somando — cresce ao longo do dia, e a
 * atribuição de venda entra depois. Por isso a tela avisa que o dia não fechou,
 * em vez de esconder o gasto (que é o custo que ela já teve).
 */
function janela(dias: number): { inicio: string; fim: string } {
  const dia = (atras: number) => new Date(Date.now() - atras * 86_400_000).toISOString().slice(0, 10);
  return { inicio: dia(dias), fim: dia(0) };
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

/**
 * Relatório por PRODUTO ANUNCIADO (`spAdvertisedProduct`).
 *
 * ⚠️ A JANELA É OUTRA: aqui a Amazon entrega atribuição de 14 dias por clique
 * (`*Clicks14d`), enquanto o relatório de campanha usa 30 dias (`sales30d`).
 * Somar os dois, ou comparar produto com campanha, exige saber disso — está
 * registrado na migration 0016 e em docs/amazon-ads.md.
 *
 * ACOS e ROAS vêm PRONTOS da fonte e são gravados como vieram: recalcular a
 * partir de cost/sales daria um número diferente do painel da Amazon (janelas
 * distintas), e a vendedora veria dois ACOS para a mesma campanha.
 */
interface LinhaDoRelatorioDeProduto {
  date?: string;
  campaignId?: string | number;
  campaignName?: string;
  advertisedAsin?: string;
  advertisedSku?: string;
  impressions?: number;
  clicks?: number;
  cost?: number;
  purchases14d?: number;
  sales14d?: number;
  acosClicks14d?: number;
  roasClicks14d?: number;
}

/** Os dois relatórios do ciclo. `spCampaigns` já existia; produto entrou em 28/08/2026. */
export const TIPOS_DE_RELATORIO = ["spCampaigns", "spAdvertisedProduct"] as const;
export type TipoDeRelatorio = (typeof TIPOS_DE_RELATORIO)[number];

/** Colunas pedidas por tipo — o que a fonte precisa devolver para cada tabela. */
const COLUNAS: Record<TipoDeRelatorio, string[]> = {
  spCampaigns: ["date", "campaignId", "campaignName", "impressions", "clicks", "cost", "purchases30d", "sales30d"],
  spAdvertisedProduct: [
    "date", "campaignId", "campaignName", "advertisedAsin", "advertisedSku",
    "impressions", "clicks", "cost", "purchases14d", "sales14d",
    // As métricas da FONTE — o motivo desta entrega existir.
    "acosClicks14d", "roasClicks14d",
  ],
};

const GROUP_BY: Record<TipoDeRelatorio, string[]> = {
  spCampaigns: ["campaign"],
  spAdvertisedProduct: ["advertiser"],
};

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
export async function pedirRelatorioDeAnuncios(dias = 30, tipo: TipoDeRelatorio = "spCampaigns"): Promise<string | null> {
  const ctx = await cabecalhos();
  if (!ctx) return null;

  // A vaga de pendente é POR TIPO (migration 0016): sem isso, um relatório de
  // produto travado seguraria a fila do de campanha — e vice-versa.
  const pendentes = await dbQuery<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM workspace_ad_reports
      WHERE workspace_id=$1 AND provider=$2 AND report_type=$3 AND status='pending'`,
    [currentWorkspaceId(), PROVIDER, tipo],
  );
  if (Number(pendentes[0]?.n ?? 0) >= MAX_PENDENTES) return null;

  const { inicio, fim } = janela(dias);
  const res = await fetch(`${HOST}/reporting/reports`, {
    method: "POST",
    headers: { ...ctx.headers, "content-type": "application/vnd.createasyncreportrequest.v3+json" },
    body: JSON.stringify({
      name: `nexo-${tipo}-${inicio}-${fim}`,
      startDate: inicio,
      endDate: fim,
      configuration: {
        adProduct: "SPONSORED_PRODUCTS",
        // `date` no groupBy é o que dá granularidade diária — sem ele o
        // relatório volta somado e a tela não consegue filtrar 7/15/30 dias.
        groupBy: GROUP_BY[tipo],
        columns: COLUNAS[tipo],
        reportTypeId: tipo,
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
       (workspace_id,provider,connection_id,report_id,start_date,end_date,status,report_type)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)
     ON CONFLICT (workspace_id,provider,connection_id,report_id) DO NOTHING`,
    [currentWorkspaceId(), PROVIDER, ctx.connectionId, corpo.reportId, inicio, fim, tipo],
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

  const pendentes = await dbQuery<{ report_id: string; connection_id: string; report_type: TipoDeRelatorio }>(
    `SELECT report_id, connection_id, report_type FROM workspace_ad_reports
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
    const cru = JSON.parse(gunzipSync(gz).toString("utf8")) as unknown[];

    if (p.report_type === "spAdvertisedProduct") {
      gravadas += await gravarMetricasDeProduto(cru as LinhaDoRelatorioDeProduto[], p.connection_id);
      await marcar(p.report_id, p.connection_id, "completed", null);
      continue;
    }

    const linhas = cru as LinhaDoRelatorio[];
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

/**
 * Grava as linhas do relatório por produto anunciado.
 *
 * ⚠️ GUARDA ANTI-REGRAVAÇÃO (ADR-022, ponto 4 da revisão da migration 0016): o
 * relatório da Amazon REPETE os dias anteriores a cada colheita, e o dia
 * corrente é recolhido ~24×/dia. Sem o `WHERE ... IS DISTINCT FROM`, cada ciclo
 * reescreveria todas as linhas do período com valores idênticos — o defeito do
 * materializer legado (3 milhões de updates em 12 linhas) que a ADR-026 existe
 * para impedir.
 */
async function gravarMetricasDeProduto(linhas: LinhaDoRelatorioDeProduto[], connectionId: string): Promise<number> {
  let gravadas = 0;
  for (const l of linhas) {
    // Sem dia ou sem produto a linha não tem chave — descartar é mais honesto
    // que inventar um identificador.
    if (!l.date || l.campaignId == null || !l.advertisedAsin) continue;
    await dbQuery(
      `INSERT INTO workspace_ad_product_metrics
         (workspace_id,provider,connection_id,day,campaign_id,product_id,sku,product_title,
          impressions,clicks,cost,purchases,sales,acos,roas,currency,extra_metrics,synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now())
       ON CONFLICT (workspace_id,provider,connection_id,day,campaign_id,product_id,sku)
       DO UPDATE SET product_title=EXCLUDED.product_title,
                     impressions=EXCLUDED.impressions, clicks=EXCLUDED.clicks,
                     cost=EXCLUDED.cost, purchases=EXCLUDED.purchases,
                     sales=EXCLUDED.sales, acos=EXCLUDED.acos, roas=EXCLUDED.roas,
                     currency=EXCLUDED.currency, extra_metrics=EXCLUDED.extra_metrics,
                     synced_at=now()
        WHERE (workspace_ad_product_metrics.product_title, workspace_ad_product_metrics.impressions,
               workspace_ad_product_metrics.clicks, workspace_ad_product_metrics.cost,
               workspace_ad_product_metrics.purchases, workspace_ad_product_metrics.sales,
               workspace_ad_product_metrics.acos, workspace_ad_product_metrics.roas,
               workspace_ad_product_metrics.currency, workspace_ad_product_metrics.extra_metrics)
              IS DISTINCT FROM
              (EXCLUDED.product_title, EXCLUDED.impressions, EXCLUDED.clicks, EXCLUDED.cost,
               EXCLUDED.purchases, EXCLUDED.sales, EXCLUDED.acos, EXCLUDED.roas,
               EXCLUDED.currency, EXCLUDED.extra_metrics)`,
      [
        currentWorkspaceId(), PROVIDER, connectionId, l.date, String(l.campaignId),
        String(l.advertisedAsin), l.advertisedSku ?? "", l.campaignName ?? null,
        l.impressions ?? 0, l.clicks ?? 0, l.cost ?? 0, l.purchases14d ?? 0, l.sales14d ?? 0,
        // Métricas da FONTE: ausente vira null, nunca zero — "sem clique no dia"
        // não é "ACOS de 0%".
        l.acosClicks14d ?? null, l.roasClicks14d ?? null,
        // A conta do Ads é do perfil BR; se um dia houver perfil em outra moeda,
        // ela vem por linha e não some com esta.
        "BRL",
        // A janela que a fonte usou, para quem comparar canais depois saber.
        JSON.stringify({ attribution_window: "clicks14d" }),
      ],
    );
    gravadas += 1;
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
/**
 * Existe conta de anúncio conectada?
 *
 * É o que separa "não anuncia" de "não sei quanto gastou". Sem esta distinção,
 * uma conta com Ads conectado e sync atrasado exibiria o lucro SEM anúncio como
 * se fosse o lucro real — o defeito que esta entrega inteira corrige.
 *
 * Consulta a existência da credencial, sem decifrá-la: nada de token em memória
 * no caminho de uma tela.
 */
export async function adsEstaConectado(): Promise<boolean> {
  const rows = await dbQuery<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM workspace_settings
      WHERE workspace_id=$1 AND key='amazon_ads_oauth'`,
    [currentWorkspaceId()],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/**
 * O anúncio de um intervalo de datas — a forma que o dashboard usa.
 *
 * Recebe o MESMO período do resto do financeiro. Sem isso, gasto de 30 dias
 * dividiria faturamento de 7 e o TACOS sairia 4× maior.
 *
 * As bordas viram dia-calendário de Brasília, igual ao resto da apuração: a
 * Amazon reporta anúncio por dia do perfil, não em UTC.
 */
export async function anunciosNoPeriodo(inicioISO: string, fimISO: string): Promise<ResumoDeAnuncios | null> {
  return agregar(
    `AND day BETWEEN ($3::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
                 AND ($4::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date`,
    [inicioISO, fimISO],
  );
}

export async function resumoDeAnuncios(dias: number): Promise<ResumoDeAnuncios | null> {
  return agregar(
    `AND day >= (now() AT TIME ZONE 'America/Sao_Paulo')::date - $3::int`,
    [dias],
  );
}

/**
 * O SELECT único das duas leituras acima — só o recorte de data muda.
 *
 * ⚠️ `recorte` é concatenado no SQL, então é privado e só aceita literal escrito
 * aqui neste arquivo. Toda data entra por `extras`, como parâmetro ligado —
 * nunca interpolada.
 */
async function agregar(
  recorte: string,
  extras: (string | number)[],
): Promise<ResumoDeAnuncios | null> {
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
        ${recorte}`,
    [currentWorkspaceId(), PROVIDER, ...extras],
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

/**
 * Um ciclo de anúncio para TODOS os workspaces com Ads conectado.
 *
 * ⚠️ COLHER VEM ANTES DE PEDIR, e a ordem não é estética: colher primeiro libera
 * a vaga do `MAX_PENDENTES`, então o relatório pronto é gravado e o próximo é
 * pedido no MESMO ciclo. Invertido, cada rodada tentaria pedir com a vaga ainda
 * ocupada, desistiria, e só colheria na seguinte — metade da cadência, de graça.
 *
 * Devolve quantas linhas de métrica foram gravadas no total.
 *
 * 📌 É multi-inquilino de propósito. Curar dado só na conta de quem reportou o
 * problema já foi erro aqui antes: o app tem mais de um vendedor, e um deles
 * ficaria com o card de Lucro congelado sem ninguém perceber.
 */
export async function runScheduledAdsSync(): Promise<number> {
  const donos = await dbQuery<{ workspace_id: string }>(
    `SELECT workspace_id::text AS workspace_id FROM workspace_settings
      WHERE key='amazon_ads_oauth'`,
    [],
  );

  let gravadas = 0;
  for (const dono of donos) {
    // Falha de um workspace não pode calar os outros — mesmo princípio do
    // `passo()` do cron: erro aparece, mas não derruba o ciclo inteiro.
    try {
      gravadas += await runWithWorkspace(dono.workspace_id, async () => {
        const colhidas = await colherRelatoriosDeAnuncios();
        // Os DOIS relatórios do ciclo, cada um com sua vaga de pendente (0016):
        // campanha responde "quanto gastei", produto responde "em quê".
        for (const tipo of TIPOS_DE_RELATORIO) await pedirRelatorioDeAnuncios(30, tipo);
        return colhidas;
      });
    } catch (error) {
      console.error(`[ads-sync] workspace ${dono.workspace_id} falhou:`, error);
    }
  }
  return gravadas;
}
