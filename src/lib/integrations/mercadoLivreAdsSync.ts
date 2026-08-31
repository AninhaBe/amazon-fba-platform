import { dbQuery, hasDb } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { mercadoLivreFetch } from "./mercadoLivre";
import type { IntegrationConnection } from "./types";

/**
 * Ingestão de métricas de Product Ads (PADS) do Mercado Livre.
 *
 * ⚠️ NADA DO VAIVÉM DA AMAZON AQUI. O PADS é SÍNCRONO: um GET devolve as
 * métricas na hora. Não há relatório para pedir e colher depois, então o ciclo
 * é um passo só no cron — o desenho assíncrono do `amazonAdsSync` existe porque
 * a Amazon leva ~30 min para gerar, não porque seja o jeito certo por padrão.
 *
 * ⚠️ OS CAMINHOS SÃO CONTRAINTUITIVOS, e custaram várias tentativas ao Delta em
 * 28/08/2026 — começar por aqui evita repetir os 404:
 *   - `/advertising/advertisers?product_id=PADS` com header `Api-Version: 1`
 *   - `/marketplace/advertising/{SITE}/advertisers/{ADV}/product_ads/ads/search`
 *     com header `api-version: 2` — o prefixo `/marketplace/` E o `/search` no
 *     fim são obrigatórios; sem eles a resposta é 404 de corpo vazio.
 *
 * ⚠️ A ARMADILHA QUE DUPLICA DINHEIRO: o mesmo `item_id` volta MAIS DE UMA VEZ,
 * com `status` diferentes (`hold` e `deleted`) e MÉTRICAS IDÊNTICAS. Somar as
 * linhas cruas inflou o gasto em 23% na medição real (116 cliques/R$ 36,50 cru
 * contra 92/R$ 29,62 verdadeiros). Depois de deduplicar por item, o nível
 * anúncio bate AO CENTAVO com o nível campanha. Por isso:
 *   1. deduplicamos por (campaign_id, item_id) ANTES de qualquer conta;
 *   2. gravamos linha a linha — a PK da migration 0016 não inclui `status`,
 *      então a segunda linha do par sobrescreve a primeira com valor idêntico e
 *      o resultado fica certo. Isso só vale se ninguém somar antes de gravar;
 *   3. conferimos contra o total de campanha que a própria fonte devolve, e
 *      divergência vira LOG, não gravação torta.
 */

const PROVIDER = "mercado_livre";

interface AnuncioPads {
  item_id?: string;
  campaign_id?: number | string;
  title?: string;
  status?: string;
  metrics?: {
    clicks?: number;
    prints?: number;
    cost?: number;
    acos?: number;
    roas?: number;
    cvr?: number;
    sov?: number;
    units_quantity?: number;
    direct_amount?: number;
    indirect_amount?: number;
    organic_units_quantity?: number;
  };
}

/** Deduplica por (campanha, item) preservando a primeira ocorrência. */
export function deduplicarAnuncios(anuncios: AnuncioPads[]): AnuncioPads[] {
  const vistos = new Map<string, AnuncioPads>();
  for (const anuncio of anuncios) {
    if (!anuncio.item_id) continue;
    const chave = `${anuncio.campaign_id ?? ""}:${anuncio.item_id}`;
    if (!vistos.has(chave)) vistos.set(chave, anuncio);
  }
  return [...vistos.values()];
}

/**
 * A verificação de sanidade que a própria fonte oferece: a soma dos anúncios
 * TEM que bater com o total das campanhas. Divergência grande = duplicata que
 * escapou. Nunca corrige silenciosamente um número de dinheiro — quem chama
 * decide o que fazer.
 *
 * ⚠️ POR QUE A TOLERÂNCIA NÃO É ZERO, e por que apertá-la NÃO melhora a
 * qualidade (medido em produção em 28/08/2026):
 *
 * As duas listas vêm de DUAS CHAMADAS a uma fonte VIVA. Um clique que entra
 * entre elas já produz diferença — foi exatamente o que aconteceu no primeiro
 * ciclo real: +2 cliques e +R$ 0,52 sobre 1.364 cliques e R$ 814,87, ou seja
 * 0,06%. Com igualdade exata, o alarme dispararia quase todo ciclo, e alarme
 * que grita sempre vira ruído ignorado — o oposto do que ele existe para fazer.
 *
 * A faixa continua pegando o caso REAL com folga enorme: a duplicata que o
 * Delta mediu inflava o gasto em 23%, quatrocentas vezes acima deste limite.
 * Chamar os endpoints em sequência foi descartado: custa latência e não garante
 * nada, porque a fonte não para de se mover.
 */
export const TOLERANCIA_PERCENTUAL = 0.01;
export const TOLERANCIA_CLIQUES = 3;

export interface Conferencia {
  /** Dentro da faixa aceitável? */
  confere: boolean;
  cliquesDiferenca: number;
  gastoDiferenca: number;
  /** Divergência do gasto em % do total — é o número que revela TENDÊNCIA. */
  gastoDiferencaPct: number;
  /** Houve diferença, mesmo dentro da faixa? Decide o registro em nível baixo. */
  houveDivergencia: boolean;
}

export function conferirContraCampanha(
  anuncios: AnuncioPads[],
  totalDeCampanhas: { clicks: number; cost: number },
): Conferencia {
  const cliques = anuncios.reduce((soma, a) => soma + (a.metrics?.clicks ?? 0), 0);
  const gasto = anuncios.reduce((soma, a) => soma + (a.metrics?.cost ?? 0), 0);
  const cliquesDiferenca = cliques - totalDeCampanhas.clicks;
  // `+ 0` normaliza o `-0` que a subtração de floats produz: "menos zero" num
  // relatório de dinheiro confunde quem lê e quebra comparação com `0`.
  const gastoDiferenca = +(gasto - totalDeCampanhas.cost).toFixed(2) + 0;
  const gastoDiferencaPct = totalDeCampanhas.cost > 0
    ? +((Math.abs(gastoDiferenca) / totalDeCampanhas.cost) * 100).toFixed(3)
    : 0;

  const limiteDeCliques = Math.max(TOLERANCIA_CLIQUES, Math.ceil(totalDeCampanhas.clicks * TOLERANCIA_PERCENTUAL));
  const limiteDeGasto = Math.max(0.01, +(totalDeCampanhas.cost * TOLERANCIA_PERCENTUAL).toFixed(2));

  return {
    confere: Math.abs(cliquesDiferenca) <= limiteDeCliques && Math.abs(gastoDiferenca) <= limiteDeGasto,
    cliquesDiferenca,
    gastoDiferenca,
    gastoDiferencaPct,
    // ⚠️ Diferente de `confere`: existe para o registro em nível baixo. Tolerância
    // SILENCIOSA esconde tendência — se a divergência sair de 0,06% para 0,7% e
    // ficar lá, é um defeito nascendo DENTRO da faixa aceita, e ninguém veria.
    // Com o registro, a pergunta "está piorando?" tem resposta.
    houveDivergencia: cliquesDiferenca !== 0 || Math.abs(gastoDiferenca) > 0.01,
  };
}

/**
 * Grava uma linha por anúncio, no dia informado.
 *
 * ⚠️ `acos = 0` COM GASTO E SEM VENDA é o que o ML devolve quando a campanha
 * não converteu (medido). Gravamos como a fonte manda — a leitura é que
 * distingue, olhando `purchases` junto. O que NÃO pode acontecer é a gravação
 * "consertar" o zero para null: aí perderíamos o que a fonte disse.
 */
async function gravarAnuncio(
  connectionId: string,
  dia: string,
  anuncio: AnuncioPads,
  procedencia: { janelaEmDias: number; consolidando: boolean },
): Promise<void> {
  const m = anuncio.metrics ?? {};
  await dbQuery(
    `INSERT INTO workspace_ad_product_metrics
       (workspace_id,provider,connection_id,day,campaign_id,product_id,sku,product_title,
        impressions,clicks,cost,purchases,sales,acos,roas,currency,extra_metrics,synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,'',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())
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
      currentWorkspaceId(), PROVIDER, connectionId, dia,
      String(anuncio.campaign_id ?? ""), String(anuncio.item_id ?? ""),
      anuncio.title ?? null,
      m.prints ?? 0, m.clicks ?? 0, m.cost ?? 0,
      m.units_quantity ?? 0,
      // Receita ATRIBUÍDA direta: é a que corresponde ao que a Amazon chama de
      // `sales`. A indireta e a orgânica vão para extra_metrics — são conceitos
      // que a Amazon não tem e somar tudo aqui mudaria o significado da coluna.
      m.direct_amount ?? 0,
      m.acos ?? null, m.roas ?? null,
      "BRL",
      JSON.stringify({
        attribution_window: "pads",
        // ⚠️ PROCEDÊNCIA GRAVADA POR QUEM SABE, LIDA POR QUEM EXIBE (31/08/2026).
        //
        // `janela_em_dias` responde "esta linha é de UM dia?" sem que ninguém
        // precise confiar em acordo verbal. Era a proposta da Vitrine e ela está
        // certa: o defeito de 17× existiu porque a leitura somava linhas de oito
        // dias achando que somava dias, e nada no dado dizia o contrário.
        //
        // `consolidando` responde "este número ainda vai mudar?". A tela PRECISA
        // dizer isso — número que muda sozinho vira "está errado" mesmo estando
        // certo, e foi o que aconteceu duas vezes em 30/08 (o ads e a margem).
        //
        // ⚠️ E ELE NÃO É REGRA DE DATA NA TELA, DE PROPÓSITO. Inferir "hoje ou
        // ontem" na renderização é a tela adivinhando um fato que quem gravou
        // sabia — mesma família da janela que vinha por parâmetro. Pior ainda
        // porque a tela lê payload cacheado: o "agora" dela pode estar horas
        // depois do "agora" da coleta, e a resposta muda com isso.
        janela_em_dias: procedencia.janelaEmDias,
        consolidando: procedencia.consolidando,
        status: anuncio.status ?? null,
        cvr: m.cvr ?? null,
        sov: m.sov ?? null,
        indirect_amount: m.indirect_amount ?? null,
        organic_units_quantity: m.organic_units_quantity ?? null,
      }),
    ],
  );
}

export interface ResultadoDaColeta {
  gravadas: number;
  duplicadasIgnoradas: number;
  sanidade: { confere: boolean; cliquesDiferenca: number; gastoDiferenca: number } | null;
}

/**
 * Um passo de coleta para UMA conexão. Síncrono do começo ao fim.
 *
 * `dia` é o dia-calendário de Brasília a que as métricas se referem; a janela do
 * PADS aceita 90 dias para trás.
 */
/** Dia-calendário de Brasília, com deslocamento em dias. */
function diaEmBrasiliaAgora(deslocamentoDias = 0): string {
  return new Date(Date.now() - 3 * 60 * 60_000 - deslocamentoDias * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export async function coletarAdsDoMercadoLivre(
  connection: IntegrationConnection,
  dia: string,
): Promise<ResultadoDaColeta> {
  // ⚠️ A JANELA É O PRÓPRIO DIA, E ELA DEIXOU DE SER PARÂMETRO (31/08/2026).
  //
  // Antes o chamador passava `janela` separado de `dia`, e o agendador pedia
  // OITO DIAS (`de: hoje-7, ate: hoje`) enquanto gravava tudo carimbado como UM
  // dia. O PADS devolve o agregado do intervalo, então cada linha "diária" da
  // nossa tabela era a soma de oito — 17× o valor real.
  //
  // Provado contra a fonte em 31/08/2026, na mesma conta e no mesmo minuto:
  //   date_from = date_to = 30/08 →  R$  46,78 e    80 cliques  (console: R$ 44, 71)
  //   date_from = 23/08 … 30/08   →  R$ 771,93 e 1.237 cliques  (gravado: R$ 768,86, 1.228)
  //
  // O que denunciou não foi o dinheiro: foi o CLIQUE errar pelo MESMO fator.
  // Clique não tem moeda, então câmbio e centavos morreram sem outra medição —
  // quando duas grandezas de naturezas diferentes erram pelo mesmo fator, a
  // causa está no que elas COMPARTILHAM, e o que elas compartilhavam era a
  // janela.
  //
  // Por isso a janela sumiu da assinatura em vez de virar "passe o dia nos dois
  // campos": enquanto o chamador puder informar um intervalo diferente do dia,
  // alguém vai informar. Agora `dia` é a única entrada e o descasamento não tem
  // por onde nascer.
  const janela = { de: dia, ate: dia };
  if (!hasDb()) return { gravadas: 0, duplicadasIgnoradas: 0, sanidade: null };

  const advertisers = await mercadoLivreFetch<{ advertisers?: Array<{ advertiser_id?: number; site_id?: string }> }>(
    connection,
    "/advertising/advertisers?product_id=PADS",
    { "Api-Version": "1" },
  );
  const advertiser = advertisers.advertisers?.[0];
  if (!advertiser?.advertiser_id || !advertiser.site_id) return { gravadas: 0, duplicadasIgnoradas: 0, sanidade: null };

  const METRICAS = "clicks,prints,cost,acos,roas,cvr,sov,units_quantity,direct_amount,indirect_amount,organic_units_quantity";
  const base = `/marketplace/advertising/${advertiser.site_id}/advertisers/${advertiser.advertiser_id}/product_ads`;
  const filtro = `date_from=${janela.de}&date_to=${janela.ate}&metrics=${METRICAS}`;

  const [ads, campanhas] = await Promise.all([
    mercadoLivreFetch<{ results?: AnuncioPads[] }>(connection, `${base}/ads/search?limit=100&offset=0&${filtro}`, { "api-version": "2" }),
    mercadoLivreFetch<{ results?: Array<{ metrics?: { clicks?: number; cost?: number } }> }>(
      connection, `${base}/campaigns/search?limit=100&offset=0&${filtro}`, { "api-version": "2" },
    ),
  ]);

  const crus = ads.results ?? [];
  const unicos = deduplicarAnuncios(crus);

  const totalDeCampanhas = (campanhas.results ?? []).reduce(
    (soma, campanha) => ({
      clicks: soma.clicks + (campanha.metrics?.clicks ?? 0),
      cost: +(soma.cost + (campanha.metrics?.cost ?? 0)).toFixed(2),
    }),
    { clicks: 0, cost: 0 },
  );
  const sanidade = conferirContraCampanha(unicos, totalDeCampanhas);
  const desvio =
    `cliques ${sanidade.cliquesDiferenca >= 0 ? "+" : ""}${sanidade.cliquesDiferenca}, ` +
    `gasto ${sanidade.gastoDiferenca >= 0 ? "+" : ""}${sanidade.gastoDiferenca} (${sanidade.gastoDiferencaPct}%)`;
  if (!sanidade.confere) {
    // Log, não conserto: um número de dinheiro que não fecha precisa de gente
    // olhando, e gravar torto é pior que gravar e avisar.
    console.error(
      `[ml-ads] conexao=${connection.id} dia=${dia}: soma dos anuncios NAO bate com as campanhas ` +
      `(${desvio}) — acima da tolerancia, provavel duplicata nao tratada`,
    );
  } else if (sanidade.houveDivergencia) {
    // ⚠️ DENTRO DA TOLERÂNCIA, MAS NÃO EM SILÊNCIO (exigência do cérebro,
    // 28/08/2026): tolerância silenciosa esconde TENDÊNCIA. Se a divergência
    // subir de 0,06% para 0,7% e ficar lá, é defeito nascendo dentro da faixa
    // aceita — e sem este registro ninguém veria. Nível baixo de propósito: é
    // material para a pergunta "está piorando?", não um alarme.
    console.info(`[ml-ads] conexao=${connection.id} dia=${dia}: divergencia dentro da tolerancia (${desvio})`);
  }

  // A moeda é fixa em BRL dentro do gravador: o PADS que consumimos é do site
  // MLB. Se um dia houver conta em outro site, ela entra por parâmetro — e a
  // coluna `currency` da 0016 já existe justamente para isso.
  // ⚠️ "AINDA CONSOLIDANDO" É MEDIDO, NÃO SUPOSTO — e por isso precisa dos dois.
  //
  // A EVIDÊNCIA: as duas visões do PADS (por anúncio e por campanha) discordam
  // enquanto o dia está fresco. Medido em 31/08/2026: 29/08 fechou na vírgula
  // (R$ 69,66 nas duas), 30/08 não (R$ 53,05 contra R$ 46,55). Divergência entre
  // as visões da própria fonte é a melhor prova de que ela não terminou.
  //
  // A JANELA DE RECÊNCIA: divergência num dia ANTIGO significa OUTRA coisa — é
  // problema de verdade, e é o que o `console.error` abaixo continua reportando.
  // Sem esta segunda condição, um defeito real em dado velho seria rotulado como
  // "consolidando" e desapareceria da vista. É a diferença entre "não terminou"
  // e "está errado", que o mesmo silêncio no banco produziria.
  const hoje = diaEmBrasiliaAgora();
  const ontem = diaEmBrasiliaAgora(1);
  const consolidando = !sanidade.confere && (dia === hoje || dia === ontem);

  for (const anuncio of unicos) {
    await gravarAnuncio(connection.id, dia, anuncio, { janelaEmDias: 1, consolidando });
  }

  return { gravadas: unicos.length, duplicadasIgnoradas: crus.length - unicos.length, sanidade };
}
