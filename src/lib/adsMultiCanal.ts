import { dbQuery } from "./db";
import { currentWorkspaceId } from "./workspaceScope";
import type { ProdutoAnunciado } from "./margemPosAds";

/**
 * A leitura da aba de Anúncios — os quatro canais numa consulta só.
 *
 * ⚠️ O QUE ESTE MÓDULO NÃO FAZ: não calcula lucro de canal. Ele lê métrica de
 * anúncio (migrations 0012 e 0016), receita/tarifa do canônico e custo
 * cadastrado, e entrega os componentes SEPARADOS. A subtração é do
 * `margemPosAds`, num arquivo só, e a fórmula de lucro dos canais não é tocada
 * aqui — quem mexe nela é o dono dela.
 *
 * ⚠️ A CHAVE DE CRUZAMENTO É DIFERENTE POR CANAL, e isso é problema desta
 * camada, não da tela:
 *   - Amazon devolve `sku` preenchido (117/117 linhas em 30/08/2026);
 *   - Mercado Livre devolve `sku` VAZIO em 282/282 e só o `product_id` (MLB…).
 * A tela recebe receita, tarifa e custo já resolvidos e não sabe qual chave foi
 * usada — no dia em que o ML passar a mandar SKU, nada muda lá.
 */

/**
 * ⚠️ CONTRATO COM O COLETOR: **UMA LINHA = UM DIA.**
 *
 * Toda leitura daqui soma `cost` sobre um intervalo de `day`. Isso só significa
 * o que parece significar se cada linha cobrir exatamente um dia. Linha que
 * carregue uma janela acumulada faz o SUM contar o mesmo dinheiro várias vezes,
 * e o erro CRESCE com o tamanho do período pedido.
 *
 * Não é hipótese: em 30/08/2026 o coletor do Mercado Livre pedia 8 dias ao PADS
 * e carimbava o resultado como UM dia. O gasto gravado ficou até **16,7× maior**
 * que a fonte (R$ 778,20 contra R$ 46,55 em 30/08), e a tela não teria parecido
 * errada — ela mostraria "3 dias · 28/08–30/08" ao lado de três janelas de 8
 * dias sobrepostas. Consertado na raiz: a janela deixou de ser parâmetro do
 * coletor e passou a ser derivada do dia.
 *
 * Esta premissa não estava escrita em lugar nenhum, e por isso ninguém esbarrou
 * nela. Agora está.
 */

export const CANAIS_DE_ADS = ["amazon", "mercado_livre", "shopee", "tiktok_shop"] as const;
export type CanalDeAds = (typeof CANAIS_DE_ADS)[number];

export type EstadoDoCanal =
  | "com-dado"
  | "aguardando-terceiro"
  | "aguardando-voce"
  | "sem-campanha"
  /**
   * A coleta gravou linha que cobre MAIS DE UM DIA. Somar isso conta o mesmo
   * dinheiro várias vezes — o defeito de 30/08/2026, que chegou a 16,7×. A tela
   * NÃO exibe número neste estado: diz o que está errado e quem está consertando.
   */
  | "dado-em-recoleta";

export interface PendenciaDoCanal {
  /** O que falta, em uma frase. Sem adjetivo que se desculpa. */
  texto: string;
  /** De quem a bola depende — a tela mostra isso, não "indisponível". */
  dono: "shopee" | "voce" | "nexo";
  href?: string;
}

/**
 * ESTADO DE PROGRAMA, não estado de banco.
 *
 * Shopee e TikTok não têm linha nenhuma de anúncio — e "sem linha" tem CAUSAS
 * DIFERENTES que só um humano sabe. Deixar o código adivinhar produziria o
 * mesmo "indisponível" genérico que a gente passou dois dias removendo.
 *
 * 📌 Fonte de verdade: `docs/estado-atual.md`. Quando o Go Live da Shopee for
 * aprovado ou a Ana criar a conta de Ads do TikTok, o texto muda AQUI.
 * (Estado de 30/08/2026.)
 */
export const PENDENCIA_POR_CANAL: Partial<Record<CanalDeAds, PendenciaDoCanal>> = {
  shopee: {
    texto: "App de Ads submetido ao Go Live — aguardando a aprovação da Shopee.",
    dono: "shopee",
  },
  tiktok_shop: {
    texto: "Os anúncios do TikTok ficam no TikTok for Business, que tem cadastro próprio.",
    dono: "voce",
    href: "/ads/como-ligar",
  },
};

export interface CanalDeAdsResumo {
  provider: CanalDeAds;
  estado: EstadoDoCanal;
  /**
   * O último dia da janela ainda está sendo consolidado pela fonte — `null`
   * quando todos os dias já fecharam. A tela mostra isso COLADO no número.
   *
   * ⚠️ Por que existe: dia que ainda se move encolhe entre duas leituras (medido
   * em 30/08/2026 no PADS: R$ 46,78 → R$ 46,55 com minutos de diferença, e as
   * visões por anúncio e por campanha consolidam em velocidades diferentes).
   * Sem a marca, a vendedora vê o número mudar sozinho amanhã e chama de erro —
   * mesmo estando certo.
   */
  consolidando: string | null;
  /**
   * Quantas linhas do período cobrem mais de um dia. `0` é o esperado; qualquer
   * número maior derruba o canal para `dado-em-recoleta` e o gasto sai `null`.
   */
  linhasAcumuladas: number;
  pendencia: PendenciaDoCanal | null;
  /**
   * A janela REAL do dado deste canal — o que impede somar 19 dias de Amazon
   * com 3 de Mercado Livre. `null` quando não há dado. A tela cola isto no
   * número, nunca num rodapé.
   */
  janela: { de: string; ate: string; dias: number } | null;
  moeda: string;
  /** `null` = desconhecido. `0` = não gastou. */
  gasto: number | null;
  campanhas: number | null;
  produtos: number | null;
  cobertura: { pedidosComTarifaPct: number | null; produtosSemCusto: number | null };
}

export interface CampanhaDeAds {
  provider: CanalDeAds;
  campaignId: string;
  nome: string | null;
  gasto: number;
  vendasAtribuidas: number | null;
  pedidosAtribuidos: number | null;
  cliques: number;
  impressoes: number;
  janelaAtribuicao: string | null;
}

export interface AdsMultiCanal {
  period: { from: string; to: string };
  canais: CanalDeAdsResumo[];
  produtos: ProdutoAnunciado[];
  campanhas: CampanhaDeAds[];
}

/** Hoje em Brasília (UTC−3, sem horário de verão desde 2019). */
function diaEmBrasilia(diasAtras = 0): string {
  return new Date(Date.now() - 3 * 60 * 60_000 - diasAtras * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Quantos dias o agendador reescreve a cada ciclo. Linha mais velha que isso
 * nunca mais é recarimbada — e a ausência do carimbo nela significa "gravada
 * antes de 74160d6", não "ainda se movendo".
 */
const DIAS_REESCRITOS_PELO_COLETOR = 8;

/**
 * O dia da janela que a fonte ainda não fechou — `null` se todos fecharam.
 *
 * ⚠️ QUEM DECIDE É A GRAVAÇÃO, NÃO ESTA TELA (commit 74160d6). O coletor carimba
 * `extra_metrics.consolidando` a partir de EVIDÊNCIA: as duas visões do PADS
 * (por anúncio e por campanha) discordarem no mesmo dia. Medido em 30/08/2026 —
 * 29/08 fechou na vírgula nas duas visões (R$ 69,66) e 30/08 não (R$ 53,05
 * contra R$ 46,55). Divergência da fonte consigo mesma é a melhor prova de que
 * ela não terminou.
 *
 * ⚠️ POR QUE NÃO DÁ PARA DECIDIR AQUI POR DATA: esta tela lê payload que pode
 * estar em cache. O "agora" do render pode estar horas depois do "agora" da
 * coleta, e a mesma linha responderia coisas diferentes conforme a hora em que
 * alguém abrisse a página. O campo gravado não muda embaixo de quem lê.
 *
 * ⚠️ `null` É "NÃO SEI", NUNCA `false`. Linha gravada antes do commit não tem o
 * campo; tratá-la como "fechada" apagaria a marca exatamente nos dias que ainda
 * estão se movendo. Então: sem carimbo, vale a única coisa que sabemos — se o
 * dia ainda está dentro da janela que o coletor reescreve, ele pode mudar e a
 * marca fica; se é mais antigo que isso, o carimbo nunca vai chegar e a marca
 * sairia decoração. Este ramo é PONTE, e morre quando todas as linhas do período
 * exibível estiverem carimbadas.
 */
export function diaAindaConsolidando(ultimoDia: string | null, carimbo: boolean | null): string | null {
  if (!ultimoDia) return null;
  if (carimbo === true) return ultimoDia;
  if (carimbo === false) return null;
  return ultimoDia >= diaEmBrasilia(DIAS_REESCRITOS_PELO_COLETOR) ? ultimoDia : null;
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numOuNulo = (v: unknown): number | null => (v == null ? null : Number(v));

interface LinhaDeProduto {
  provider: string;
  product_id: string;
  sku: string | null;
  product_title: string | null;
  currency: string;
  gasto: string;
  vendas: string | null;
  pedidos: string | null;
  acos: string | null;
  roas: string | null;
  janela_atribuicao: string | null;
}

/**
 * Produtos anunciados no período, por canal.
 *
 * ACOS e ROAS saem como a fonte gravou (migration 0016) — média de números que
 * já são razões daria um terceiro número que não existe em painel nenhum. Por
 * isso `avg` só quando a fonte mandou, e `null` quando não mandou em nenhum dia.
 */
async function lerProdutosAnunciados(deISO: string, ateISO: string): Promise<LinhaDeProduto[]> {
  return dbQuery<LinhaDeProduto>(
    `SELECT provider,
            product_id,
            NULLIF(MAX(sku), '')                    AS sku,
            MAX(product_title)                      AS product_title,
            MAX(currency)                           AS currency,
            SUM(cost)                               AS gasto,
            SUM(sales)                              AS vendas,
            SUM(purchases)                          AS pedidos,
            AVG(acos) FILTER (WHERE acos IS NOT NULL) AS acos,
            AVG(roas) FILTER (WHERE roas IS NOT NULL) AS roas,
            MAX(extra_metrics->>'attribution_window') AS janela_atribuicao
       FROM workspace_ad_product_metrics
      WHERE workspace_id = $1 AND day >= $2::date AND day <= $3::date
      GROUP BY provider, product_id`,
    [currentWorkspaceId(), deISO.slice(0, 10), ateISO.slice(0, 10)]
  );
}

interface LinhaDoPeriodo {
  chave: string;
  receita: string;
  unidades: string;
  tarifa: string | null;
  pedidos_sem_tarifa: string;
}

/**
 * Receita, unidades e TARIFA REAL por produto no período.
 *
 * ⚠️ RATEIO DA TARIFA, e por que ele não fere a regra de não extrapolar.
 *
 * A tarifa do canônico é por PEDIDO, não por item. Num pedido de uma linha só a
 * atribuição é exata. Num pedido com várias linhas, o total medido é dividido
 * entre elas na proporção da receita de cada uma — isso é ALOCAR um número que
 * a fonte informou, não ESTIMAR um número que ela não informou (que é o que
 * AGENTS.md proíbe). A distinção importa: nada aqui inventa tarifa ausente.
 *
 * REGRA APROVADA (31/08/2026), com os três motivos, porque quem herdar isto vai
 * querer saber se foi escolha ou acaso:
 *
 *  1. É a única regra que FECHA: a soma das partes dá exatamente a tarifa do
 *     pedido, sem sobra nem falta. Qualquer outra precisa de um resto.
 *  2. A tarifa da maioria dos canais é PERCENTUAL sobre o valor — então dividir
 *     na proporção da receita não é aproximação, é a própria mecânica da
 *     cobrança sendo desfeita.
 *  3. Rateio por UNIDADE quebra no caso óbvio: um item de R$ 200 e um de R$ 10
 *     no mesmo pedido receberiam a mesma tarifa.
 *
 * 🔴 A FRONTEIRA CONHECIDA, e ela é o ponto desta nota: o argumento (2) cai
 * quando a tarifa NÃO é percentual — tarifa fixa por item, logística cobrada por
 * peso ou por volume. Nesses casos o rateio proporcional distribui certo o total
 * e errado a causa: o item caro absorve a taxa fixa do item barato. Hoje isso
 * não morde porque comissão percentual domina os quatro canais; se um canal
 * passar a postar tarifa fixa por item no extrato, ESTE é o lugar que precisa
 * mudar — e quem esbarrar no caso saberá que era limite conhecido, não descuido.
 *
 * ⚠️ Pedido SEM tarifa postada não vira zero: ele é CONTADO (`pedidos_sem_tarifa`)
 * e faz a tarifa do produto sair `null`, porque somar só o que chegou afirmaria
 * um custo menor do que o real — e o "sobrou" ficaria otimista.
 *
 * ⚠️ `financial_settled` NÃO é usado de propósito: na Amazon e no ML essa coluna
 * nunca é escrita e daria 0% de cobertura para canais que têm 95,7% e 100%
 * (medido pelo backend em 30/08/2026). A verdade está na existência da linha em
 * `workspace_channel_order_fees`.
 */
async function lerPeriodoPorProduto(
  provider: string,
  chave: "sku" | "external_product_id",
  deISO: string,
  ateISO: string
): Promise<LinhaDoPeriodo[]> {
  return dbQuery<LinhaDoPeriodo>(
    `WITH itens AS (
       SELECT i.external_order_id,
              i.${chave}                              AS chave,
              i.qty                                   AS unidades,
              i.qty * i.unit_price                    AS receita,
              SUM(i.qty * i.unit_price) OVER (PARTITION BY i.external_order_id) AS receita_do_pedido
         FROM workspace_channel_order_items i
         JOIN workspace_channel_orders o
           ON o.workspace_id = i.workspace_id
          AND o.provider     = i.provider
          AND o.external_order_id = i.external_order_id
        WHERE i.workspace_id = $1 AND i.provider = $2
          AND o.occurred_at >= $3::timestamptz AND o.occurred_at <= $4::timestamptz
          AND i.${chave} IS NOT NULL AND i.${chave} <> ''
     ),
     tarifa_do_pedido AS (
       SELECT external_order_id, SUM(ABS(amount)) AS tarifa
         FROM workspace_channel_order_fees
        WHERE workspace_id = $1 AND provider = $2
        GROUP BY external_order_id
     )
     SELECT itens.chave,
            SUM(itens.receita)                                     AS receita,
            SUM(itens.unidades)                                    AS unidades,
            -- Rateio proporcional à receita da linha dentro do pedido.
            SUM(tarifa_do_pedido.tarifa * (itens.receita / NULLIF(itens.receita_do_pedido, 0))) AS tarifa,
            COUNT(*) FILTER (WHERE tarifa_do_pedido.tarifa IS NULL) AS pedidos_sem_tarifa
       FROM itens
       LEFT JOIN tarifa_do_pedido USING (external_order_id)
      GROUP BY itens.chave`,
    [currentWorkspaceId(), provider, deISO, ateISO]
  );
}

/** Custo cadastrado por SKU. `null` para SKU sem cadastro — nunca zero. */
async function lerCustosPorSku(): Promise<Map<string, number>> {
  const linhas = await dbQuery<{ sku: string | null; id: string; cost: string | null }>(
    `SELECT sku, id, cost FROM workspace_product_costs WHERE workspace_id = $1`,
    [currentWorkspaceId()]
  );
  const mapa = new Map<string, number>();
  for (const linha of linhas) {
    if (linha.cost == null) continue;
    // O id canônico do custo termina em `:sku:<SKU>` quando a coluna `sku` está
    // vazia — mesmo caminho que `costStore` usa para casar.
    const sku = linha.sku || linha.id.split(":sku:")[1] || null;
    if (sku) mapa.set(sku, Number(linha.cost));
  }
  return mapa;
}

interface LinhaDeCanal {
  provider: string;
  linhas: string;
  de: string;
  ate: string;
  campanhas: string;
  produtos: string;
  gasto: string;
  moeda: string;
  consolidando: boolean | null;
  linhas_acumuladas: string;
}

/** Cobertura de tarifa do canal no período — a metade que falta do cruzamento. */
async function lerCoberturaDeTarifa(deISO: string, ateISO: string) {
  return dbQuery<{ provider: string; pedidos: string; com_tarifa: string }>(
    `SELECT o.provider,
            COUNT(*)                                        AS pedidos,
            COUNT(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM workspace_channel_order_fees f
               WHERE f.workspace_id = o.workspace_id
                 AND f.provider     = o.provider
                 AND f.external_order_id = o.external_order_id
            ))                                              AS com_tarifa
       FROM workspace_channel_orders o
      WHERE o.workspace_id = $1
        AND o.occurred_at >= $2::timestamptz AND o.occurred_at <= $3::timestamptz
      GROUP BY o.provider`,
    [currentWorkspaceId(), deISO, ateISO]
  );
}

export async function lerAdsMultiCanal(deISO: string, ateISO: string): Promise<AdsMultiCanal> {
  const workspaceId = currentWorkspaceId();
  const dia = (iso: string) => iso.slice(0, 10);

  const [porCanal, produtosBrutos, campanhasBrutas, cobertura, custos] = await Promise.all([
    dbQuery<LinhaDeCanal>(
      // Os dois carimbos vêm da GRAVAÇÃO (commit 74160d6), não de regra de data
      // aqui: `janela_em_dias` diz se a linha é de um dia só, e `consolidando`
      // diz se aquele dia ainda vai mudar. Ver o contrato no topo do arquivo.
      `WITH ultimo AS (
         SELECT provider, MAX(day) AS ate
           FROM workspace_ad_product_metrics
          WHERE workspace_id = $1 AND day >= $2::date AND day <= $3::date
          GROUP BY provider
       )
       SELECT m.provider,
              COUNT(*)::text                      AS linhas,
              MIN(m.day)::text                    AS de,
              MAX(m.day)::text                    AS ate,
              COUNT(DISTINCT m.campaign_id)::text AS campanhas,
              COUNT(DISTINCT m.product_id)::text  AS produtos,
              SUM(m.cost)::text                   AS gasto,
              MAX(m.currency)                     AS moeda,
              -- TRUE se qualquer linha do último dia ainda se move; NULL quando
              -- nenhuma foi carimbada (linha gravada antes do commit 74160d6).
              BOOL_OR((m.extra_metrics->>'consolidando')::boolean)
                FILTER (WHERE m.day = u.ate)      AS consolidando,
              -- A defesa contra o defeito de 17x voltar por outro caminho.
              COUNT(*) FILTER (
                WHERE COALESCE((m.extra_metrics->>'janela_em_dias')::int, 1) > 1
              )::text                             AS linhas_acumuladas
         FROM workspace_ad_product_metrics m
         JOIN ultimo u ON u.provider = m.provider
        WHERE m.workspace_id = $1 AND m.day >= $2::date AND m.day <= $3::date
        GROUP BY m.provider`,
      [workspaceId, dia(deISO), dia(ateISO)]
    ),
    lerProdutosAnunciados(deISO, ateISO),
    dbQuery<{
      provider: string; campaign_id: string; campaign_name: string | null;
      gasto: string; vendas: string | null; pedidos: string | null;
      cliques: string; impressoes: string;
    }>(
      `SELECT provider, campaign_id, MAX(campaign_name) AS campaign_name,
              SUM(cost) AS gasto, SUM(sales) AS vendas, SUM(purchases) AS pedidos,
              SUM(clicks) AS cliques, SUM(impressions) AS impressoes
         FROM workspace_ad_metrics
        WHERE workspace_id = $1::uuid AND day >= $2::date AND day <= $3::date
        GROUP BY provider, campaign_id
        ORDER BY SUM(cost) DESC`,
      [workspaceId, dia(deISO), dia(ateISO)]
    ),
    lerCoberturaDeTarifa(deISO, ateISO),
    lerCustosPorSku(),
  ]);

  // O período por SKU (Amazon) e por product_id (ML) — uma consulta por canal
  // que realmente tem anúncio, e não quatro sempre.
  const providersComAnuncio = new Set(produtosBrutos.map((p) => p.provider));
  const periodoPorCanal = new Map<string, Map<string, LinhaDoPeriodo>>();
  await Promise.all(
    [...providersComAnuncio].map(async (provider) => {
      const chave = provider === "amazon" ? "sku" : "external_product_id";
      const linhas = await lerPeriodoPorProduto(provider, chave, deISO, ateISO);
      periodoPorCanal.set(provider, new Map(linhas.map((l) => [l.chave, l])));
    })
  );

  const produtos: ProdutoAnunciado[] = produtosBrutos.map((linha) => {
    const porChave = periodoPorCanal.get(linha.provider);
    const chave = linha.provider === "amazon" ? linha.sku : linha.product_id;
    const periodo = chave ? porChave?.get(chave) : undefined;
    // Anunciado e SEM VENDA no período é FATO, não lacuna: receita 0, unidades 0
    // e tarifa 0. É a linha mais útil da tela — dinheiro saindo sem retorno.
    const semVenda = periodo == null;
    const faltaTarifa = periodo != null && Number(periodo.pedidos_sem_tarifa) > 0;
    const unidades = semVenda ? 0 : Number(periodo.unidades);
    const custoUnitario = linha.sku ? custos.get(linha.sku) : undefined;

    return {
      provider: linha.provider,
      productId: linha.product_id,
      sku: linha.sku,
      titulo: linha.product_title,
      moeda: linha.currency || "BRL",
      gasto: num(linha.gasto),
      vendasAtribuidas: numOuNulo(linha.vendas),
      pedidosAtribuidos: numOuNulo(linha.pedidos),
      acos: numOuNulo(linha.acos),
      roas: numOuNulo(linha.roas),
      janelaAtribuicao: linha.janela_atribuicao,
      receitaPeriodo: semVenda ? 0 : Number(periodo.receita),
      tarifaPeriodo: semVenda ? 0 : faltaTarifa ? null : num(periodo.tarifa),
      // Sem SKU (ML hoje) não há custo cadastrado para casar: `null`, e a tela
      // diz "custo não cadastrado" em vez de fingir que o produto é de graça.
      custoPeriodo: custoUnitario == null ? (unidades === 0 ? 0 : null) : +(custoUnitario * unidades).toFixed(2),
      unidadesPeriodo: unidades,
    };
  });

  const coberturaPorProvider = new Map(cobertura.map((c) => [c.provider, c]));
  const canais: CanalDeAdsResumo[] = CANAIS_DE_ADS.map((provider) => {
    const linha = porCanal.find((c) => c.provider === provider);
    const cob = coberturaPorProvider.get(provider);
    const pedidos = cob ? Number(cob.pedidos) : 0;
    const semCusto = produtos.filter((p) => p.provider === provider && p.custoPeriodo == null).length;

    if (!linha) {
      const pendencia = PENDENCIA_POR_CANAL[provider] ?? null;
      return {
        provider,
        estado: pendencia ? (pendencia.dono === "voce" ? "aguardando-voce" : "aguardando-terceiro") : "sem-campanha",
        pendencia,
        janela: null,
        consolidando: null,
        linhasAcumuladas: 0,
        moeda: "BRL",
        gasto: null,
        campanhas: null,
        produtos: null,
        cobertura: { pedidosComTarifaPct: null, produtosSemCusto: null },
      };
    }

    const de = new Date(linha.de).getTime();
    const ate = new Date(linha.ate).getTime();
    // RECUSA SOMAR O QUE NÃO É DIÁRIO. Antes de existir `janela_em_dias`, a
    // leitura somava linhas achando que somava dias e não tinha como saber —
    // era o defeito de 16,7× do Mercado Livre. Agora o dado diz, e a tela
    // prefere não mostrar número a mostrar número errado.
    const acumuladas = Number(linha.linhas_acumuladas ?? 0);
    if (acumuladas > 0) {
      return {
        provider,
        estado: "dado-em-recoleta",
        pendencia: {
          // RECUSAR NÃO BASTA: a tela precisa dizer o que fazer, e aqui a
          // resposta honesta é "nada, é nosso". Sem essa frase, a vendedora fica
          // com um canal mudo e sem saber se o problema é dela — que é o mesmo
          // buraco de "indisponível", só que com número.
          texto:
            `${acumuladas} registro(s) deste canal cobrem mais de um dia e não podem ser somados sem contar ` +
            `o mesmo gasto duas vezes. A coleta está sendo refeita dia a dia — nada a fazer do seu lado, ` +
            `o número volta sozinho na próxima sincronização.`,
          dono: "nexo",
        },
        janela: { de: linha.de, ate: linha.ate, dias: Math.round((ate - de) / 86_400_000) + 1 },
        consolidando: null,
        linhasAcumuladas: acumuladas,
        moeda: linha.moeda || "BRL",
        gasto: null,
        campanhas: null,
        produtos: null,
        cobertura: { pedidosComTarifaPct: null, produtosSemCusto: null },
      };
    }
    return {
      provider,
      estado: "com-dado",
      pendencia: null,
      janela: { de: linha.de, ate: linha.ate, dias: Math.round((ate - de) / 86_400_000) + 1 },
      consolidando: diaAindaConsolidando(linha.ate, linha.consolidando),
      linhasAcumuladas: 0,
      moeda: linha.moeda || "BRL",
      gasto: num(linha.gasto),
      campanhas: Number(linha.campanhas),
      produtos: Number(linha.produtos),
      cobertura: {
        pedidosComTarifaPct: pedidos === 0 ? null : +((Number(cob!.com_tarifa) / pedidos) * 100).toFixed(1),
        produtosSemCusto: semCusto,
      },
    };
  });

  const campanhas: CampanhaDeAds[] = campanhasBrutas.map((c) => ({
    provider: c.provider as CanalDeAds,
    campaignId: c.campaign_id,
    nome: c.campaign_name,
    gasto: num(c.gasto),
    vendasAtribuidas: numOuNulo(c.vendas),
    pedidosAtribuidos: numOuNulo(c.pedidos),
    cliques: num(c.cliques),
    impressoes: num(c.impressoes),
    // A tabela de campanha da Amazon é colhida na janela de 30 dias; a de
    // produto, em 14. Os dois blocos NÃO fecham entre si, e a tela diz isso.
    janelaAtribuicao: c.provider === "amazon" ? "sales30d" : null,
  }));

  return { period: { from: deISO, to: ateISO }, canais, produtos, campanhas };
}
