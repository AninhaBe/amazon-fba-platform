"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatedNumber, identidadeDePeriodo } from "./AnimatedNumber";
import { EmptyState } from "./EmptyState";
import { DashboardSkeleton } from "./LoadingState";
import { PageHeader, pageIcons } from "./PageHeader";
import type { DailyPoint } from "./RevenueChart";
import { JANELA_DE_SETE_DIAS, serieDoBlocoDeLucro } from "./serieDoLucroPorDia";
import { DashboardPeriodFilter, useDashboardPeriod } from "./DashboardPeriodFilter";
import { periodoNaUrl } from "./periodoNaUrl";
import { OrderProfitabilityTable } from "./OrderProfitabilityTable";
import { ConnectionBroken, isBrokenConnection } from "./ConnectionBroken";
// O mesmo dicionário do radar da Amazon: equalizar canal é usar a MESMA palavra
// para o mesmo estado, senão "Saudável" no ML e "Ok" na Amazon parecem coisas
// diferentes sendo a mesma.
import { ORDEM_DO_RADAR, ROTULO_DE_COBERTURA, type StockStatus } from "@/lib/coberturaDeEstoque";
import { brDate, brTime } from "@/lib/datetime";
import { coberturaDoPeriodo } from "@/lib/coberturaPeriodo";
import type { ProfitabilityLine } from "@/lib/profitability";
import { MercadoLivreSaldo } from "./MercadoLivreSaldo";
import { ResumoDoCustoNoFull, TabelaDoCustoNoFull, ValorDeVendaNoFull, useCustoNoFull } from "./MercadoLivreCustoNoFull";
import { Pagination } from "./Pagination";
import { NexoDoDia } from "./NexoDoDia";
import { fatiaDoSobrou, sobreAVenda } from "./caminhoDoDinheiro";
import { IntegrationDashboardFrame } from "./IntegrationDashboardFrame";
import { PainelV3, type DadosV3 } from "./PainelV3";
import { PainelV3Baixo, type DadosV3Baixo } from "./PainelV3Baixo";

/**
 * `YYYY-MM-DD` -> `DD/MM`. A string só é reordenada: passá-la por `new Date`
 * a leria como meia-noite UTC e devolveria o dia anterior em São Paulo.
 */

import { BASE_SEM_DIFERENCA, declaracaoDeBase } from "./baseDaMargem";
import { comSemImposto } from "@/lib/semImposto";
import { ProgressoDaImportacao } from "./BaseDeData";
import { EstadoDoSync } from "./EstadoDoSync";
import type { AnuncioDeProduto } from "./AnunciosPorProduto";
import { usePrefetchDePeriodos } from "./prefetchDePeriodos";

const MERCADO_LIVRE_TAX_RATE_HREF = "/mercado-livre/anuncios#mercado-livre-aliquota";

/** As três abas do monitor — as mesmas da Amazon. */
/**
 * ⚠️ "composition" SAIU DO TIPO, e nao so da barra de abas
 * (decisao dela, 10/09/2026: *"pode tirar essa aba de composicao e no lugar
 * coloque a rentabilidade por venda"*). Deixar o valor no tipo mantinha vivo um
 * estado que nenhuma tela sabe mais desenhar — e um `?secao=composition` antigo
 * cairia numa aba em branco em vez de cair no padrao.
 */
export type SecaoDoMonitor = "transactions" | "profitability";

// Mesma frase do monitor da Amazon: quando o teto de detalhamento corta a
// lista, diz O QUE está sendo exibido — sem adjetivo que se desculpe.
function fraseDeEscopo(scope?: { detailedOrders: number; completePeriod: boolean } | null): string | undefined {
  if (!scope || scope.completePeriod) return undefined;
  return `Exibindo os ${scope.detailedOrders} pedidos mais recentes. Os totais financeiros acima consideram o período completo.`;
}

interface Overview {
  account: { id: string; nickname: string; siteId: string; };
  period: { from: string; to: string; label: string; };
  metrics: { activeListings: number; productsWithoutCost: number; orders30d: number; paidOrders: number; revenue30d: number; approvedRevenue: number; cancelledRevenue: number; cancelledOrders: number; pendingOrders: number; pendingRevenue: number | null; lastSaleAt: string | null; currency: string; revenueCoverage: { capturedOrders: number; totalOrders: number; complete: boolean; sincronizadoAte?: string | null; historicoDesde?: string | null }; };
  profit: { fees: number; cogs: number; taxes: number | null; taxRate: number | null; sellerShipping: number; buyerShipping: number; shippingCostsComplete: boolean; revenueProcessed: number;
    /** Fatias do painel, todas no universo da receita paga. O lucro e o residuo — [ADR-028]. */
    composicaoDaReceitaPaga?: {
      receita: number; fees: number; sellerShipping: number; cogs: number;
      taxes: number | null; lucro: number; margemPct: number | null;
    };
    /**
     * A receita que REALMENTE entrou na conta de lucro e margem.
     *
     * ⚠️ Opcional enquanto o backend nao a expoe (01/09/2026). Ate la a tela cai
     * em `revenueProcessed`, que e o denominador de hoje — e assim a declaracao
     * ja diz a verdade, em vez de esperar. Quando o denominador virar o
     * faturamento, este campo passa a vir igual a ele e a frase some sozinha,
     * porque `declaracaoDeBase` devolve `null` quando as bases coincidem.
     */
    revenueDoLucro?: number | null;
    /** Pedidos que ainda nao entraram na base — a causa da diferenca. */
    pedidosSemApuracao?: number | null;
    /**
     * ⚠️ TACOS DIVIDE, MAS NAO SUBTRAI. Ele mede quanto da operacao
     * inteira a midia consome — gasto sobre o faturamento TOTAL —, e nao entra
     * no lucro do ML: a decisao da Ana de 30/08/2026 continua de pe, porque
     * neste canal o seller desconta o anuncio depois, no fechamento dele.
     *
     * ⚠️ E TACOS NAO E ACOS. ACOS e gasto sobre a venda que o ANUNCIO
     * gerou; TACOS e sobre tudo que a loja vendeu. Trocar o rotulo troca a
     * pergunta que o numero responde.
     */
    tacos?: {
      /** Percentual pronto, ja arredondado em 2 casas. `null` = ver `motivo`. */
      pct: number | null;
      /**
       * ⚠️ `gasto-desconhecido` NAO E "NAO ANUNCIOU". E "nao sabemos
       * quanto foi o anuncio" — fato diferente, e escrever o primeiro na tela e
       * mentir. O produtor renomeou o motivo justamente para impedir isso.
       */
      motivo: "gasto-desconhecido" | "sem-faturamento" | null;
      /** Pedidos nao cancelados sem valor conhecido. Nao bloqueia o numero. */
      pedidosSemValor: number;
    } | null;
    /** Ultimo dia com gasto coletado. O dia corrente ainda soma. */
    tacosAteDia?: string | null;
    coverage: { processedOrders: number; paidOrders: number; complete: boolean; }; estimatedProfit: number | null; marginPct: number | null; unitsWithoutCost: number; skusWithoutCost: number; };
  dailySales: DailyPoint[];
  topProducts: Array<{ id: string; sku: string | null; title: string; units: number; revenue: number; cost: number; contribution: number; complete: boolean; marginPct: number | null; }>;
  stockRadar: Array<{ id: string; sku: string | null; title: string; thumbnail: string | null; availableQuantity: number; unitsSold: number; calculationDays: number; daysRemaining: number | null; status: StockStatus; }>;
  profitabilityLines: ProfitabilityLine[];
  profitabilityScope?: { detailedOrders: number; completePeriod: boolean } | null;
  /** Product Ads por SKU, já cruzado com a margem real (frente de Ads, 28/08/2026). */
  adsPorProduto?: AnuncioDeProduto[];
  recentOrders: Array<{ id: string; packId: string | null; status: string; createdAt: string; total: number; currency: string; items: number; }>;
}

interface SyncStatus {
  status: "pending" | "syncing" | "complete" | "error" | "unavailable";
  progress: number;
  processedOrders: number;
  coveredFrom: string | null;
  coveredTo: string | null;
  lastSuccessAt: string | null;
  error: string | null;
}

interface CachedPeriod {
  overview: Overview;
  syncStatus: SyncStatus | null;
  updatedAt: Date;
}

// Escopo de módulo: sobrevive à navegação entre canais (o componente desmonta
// ao ir para a Amazon e voltar). Ao retornar, o período já visto aparece na
// hora e a revalidação acontece em segundo plano. Um reload limpa tudo.
const periodCache = new Map<string, CachedPeriod>();

/**
 * O ÚNICO escritor do `periodCache`. O aquecimento de períodos e a janela dos
 * sete dias passam os dois por aqui: se cada um escrevesse com a sua forma, uma
 * chave gravada por um seria lida pelo outro com campo faltando, e nada ficaria
 * vermelho.
 */
async function buscarEGuardarPeriodo(view: string, q: string, signal: AbortSignal) {
  const resposta = await fetch(`/api/integrations/mercado-livre/overview?${q}&view=${view}`, { cache: "no-store", signal });
  if (!resposta.ok) return;
  const corpo = await resposta.json();
  if (!corpo?.overview) return;
  periodCache.set(`${view}:${q}`, {
    overview: corpo.overview as Overview,
    syncStatus: (corpo.sync ?? null) as SyncStatus | null,
    updatedAt: corpo.updatedAt ? new Date(corpo.updatedAt) : new Date(),
  });
}

/**
 * Entrega a série diária da janela de sete dias quando o filtro é "Hoje".
 *
 * Nos outros filtros devolve `null`, e quem chama continua lendo a série do
 * período — os outros filtros não foram pedidos e não mudam.
 */
/**
 * A janela de sete dias que o bloco de ritmo usa — buscada em QUALQUER filtro.
 *
 * ⚠️ ANTES SÓ BUSCAVA NO FILTRO "HOJE". A decisão da dona de
 * 09/09/2026 desamarrou o bloco do filtro de data, então a janela precisa
 * existir sempre, não só quando o período selecionado é um dia.
 *
 * Não é busca a mais na maioria dos casos: a chave é a MESMA do filtro "7 dias"
 * (`JANELA_DE_SETE_DIAS`), então quem já passou por ele — ou pelo aquecimento
 * de fundo — encontra tudo em memória e não pede nada à rede.
 */
function useJanelaDeSeteDias(view: string, connectionId: string | null) {
  const chave = `${view}:${JANELA_DE_SETE_DIAS}`;
  /**
   * ⚠️ O ESTADO AQUI É SÓ O SINAL DE "A BUSCA TERMINOU", não uma cópia da
   * série. Guardar a série em estado a deixaria para trás do `periodCache` no
   * dia em que outro caminho reescrevesse a chave — e a tela mostraria a janela
   * de sete dias de uma sincronização anterior sem nada ficar vermelho. É a
   * mesma disciplina do `overview`, que também é derivado do cache no render.
   */
  const [buscasConcluidas, setBuscasConcluidas] = useState(0);

  useEffect(() => {
    // Já em memória (ela passou pelo filtro de 7 dias, ou o aquecimento rodou):
    // nada a buscar, e o render abaixo já lê do cache.
    if (periodCache.has(chave)) return;
    // Sem conexão ainda não há o que buscar — a página inteira está em branco.
    if (!connectionId) return;
    const controller = new AbortController();
    void buscarEGuardarPeriodo(view, JANELA_DE_SETE_DIAS, controller.signal)
      .then(() => { if (!controller.signal.aborted) setBuscasConcluidas((n) => n + 1); })
      // Falha aqui não é erro de tela: o bloco simplesmente não aparece, e o
      // resto do período selecionado continua de pé.
      .catch(() => {});
    return () => controller.abort();
  }, [chave, connectionId, view]);

  return useMemo(
    () => periodCache.get(chave)?.overview.dailySales ?? null,
    // ⚠️ `buscasConcluidas` É DEPENDÊNCIA DE PROPÓSITO, e o lint reclama
    // com razão pela regra dele: o contador não aparece no corpo. Ele existe
    // porque `periodCache` é um Map mutável fora do React — ninguém avisa que a
    // chave foi gravada. O contador é esse aviso. Tirá-lo faria a leitura
    // congelar em `null` para quem abre a página já no filtro Hoje.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chave, buscasConcluidas],
  );
}

/**
 * O tom do chip de cobertura, a partir do status do radar.
 *
 * ⚠️ EM ESCOPO DE MODULO PORQUE DUAS TELAS O USAM: o cartao
 * "Radar do FULL" no dashboard e a tabela de `/mercado-livre/estoque`. Enquanto
 * vivia dentro de `Dashboard`, a segunda tela nao o enxergava — e a saida obvia
 * (copiar a expressao la) daria dois mapas de status que comecam iguais e
 * divergem no dia em que alguem adicionar um status novo em um so.
 */
const tomDaCobertura = (status: string) =>
  status === "out" || status === "critical" ? "critico" : status === "low" ? "atencao" : "saudavel";

const views = {
  dashboard: { eyebrow: "Operação Mercado Livre", title: "Dashboard Mercado Livre", subtitle: "Faturamento, pedidos e anúncios da sua conta do Mercado Livre Brasil.", icon: pageIcons.dashboard },
  monitor: { eyebrow: "Pedidos e financeiro Mercado Livre", title: "Monitor da conta", subtitle: "Pedidos recentes e o resultado financeiro real da sua conta.", icon: pageIcons.chart },
  estoque: { eyebrow: "Operação Mercado Livre", title: "Radar de estoque", subtitle: "Cobertura dos anúncios ativos com base no estoque e no ritmo de vendas do período.", icon: pageIcons.box },
} as const;

/**
 * ⚠️ AQUI MORAVA `rotuloImposto`, que so a cascata da aba
 * de Composicao chamava — ela saiu em 10/09/2026 e a funcao ficou sem
 * chamador.
 *
 * A REGRA QUE ELA CARREGAVA CONTINUA VALENDO e nao depende dela: sem aliquota
 * configurada o imposto e DESCONHECIDO, nunca zero. "Impostos (0%) R$ 0,00"
 * afirmava isencao para quem so nao tinha informado o percentual. Quem aplica
 * isso hoje e o cartao "Impostos" da faixa do dashboard, que ja trata
 * `taxRate == null` como travessao — mesma regra da Amazon, da Shopee e do
 * TikTok. Se a cascata voltar, a funcao volta com ela.
 */

function money(value: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

/**
 * Margem desconhecida vira travessão AQUI, e não em cada ponto de uso.
 *
 * ⚠️ Foi de propósito, e a alternativa estava errada: guardar `marginPct == null`
 * junto de `resultIncomplete` na chamada recriaria o idioma que
 * `margemNuncaSozinha` proíbe — apagar a margem por causa de CUSTO, que é
 * decisão da vendedora e não deste conserto. Tratando no formatador, `null` some
 * e o resto do comportamento fica exatamente como estava.
 *
 * Mesma forma do `percent` de `centralOverview.ts`.
 */
function percent(value: number | null) {
  if (value == null) return "—";
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}


/**
 * A aba inicial do monitor vem da URL (`?secao=vendas`), lida com
 * `useSearchParams` — a API que a doc do Next indica e que funciona em rota
 * PRERENDERIZADA, ao contrário de ler `window.location` no `useState`.
 *
 * Ela exige fronteira de Suspense, e é por isso que o workspace é exportado
 * embrulhado: o resto da árvore continua podendo ser pré-renderizado.
 */
export function MercadoLivreWorkspace(props: { view: keyof typeof views }) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <MercadoLivreWorkspaceInterno {...props} />
    </Suspense>
  );
}

function MercadoLivreWorkspaceInterno({ view }: { view: keyof typeof views }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const bruta = searchParams.get("secao");
  const secaoInicial: SecaoDoMonitor =
    /* O padrao virou "profitability": era "composition", e a aba deixou de
       existir. Qualquer valor desconhecido — inclusive o `composition` de um
       link antigo — cai aqui, que e o comportamento certo para URL velha. */
    bruta === "transacoes" || bruta === "transactions" ? "transactions" : "profitability";
  /**
   * O PERIODO MORA NA URL — mesmo contrato do TikTok, dos modulos e da aba de Ads.
   *
   * ⚠️ Ate 01/09/2026 esta tela chamava `useDashboardPeriod()` SEM argumento, e
   * isso nao era so higiene: significava que o periodo nao existia no endereco.
   * Tres consequencias, e a terceira ja custou um defeito:
   *
   *   • `?days=30` no endereco era descartado em silencio;
   *   • recarregar ou voltar pelo historico perdia a escolha;
   *   • **qualquer coisa que leia o periodo pela URL nasce quebrada aqui.** Foi
   *     assim que o guard do `BriefingLead` morreu: ele lia `useSearchParams()`,
   *     nunca achava `days`, e a narracao saia em qualquer periodo rotulando os
   *     numeros como "nos ultimos 30 dias".
   *
   * Quem JA escolheu mantem a escolha: o hook le a URL pelo primeiro argumento e
   * o padrao so decide quando nao ha nada la.
   */
  const period = useDashboardPeriod(
    searchParams.toString(),
    useCallback(
      (query: string) =>
        router.push(`${location.pathname}?${periodoNaUrl(searchParams.toString(), query)}`, { scroll: false }),
      [router, searchParams],
    ),
  );
  // Ao voltar de outro canal, o período já visto renderiza no primeiro paint
  // (sem flash de skeleton); a revalidação segue em segundo plano.
  const [initialCached] = useState(() => periodCache.get(`${view}:${period.query}`));
  const [carregado, setCarregado] = useState<{ chave: string; overview: Overview } | null>(
    initialCached ? { chave: `${view}:${period.query}`, overview: initialCached.overview } : null);
  const [loading, setLoading] = useState(!initialCached);
  const [error, setError] = useState<string | null>(null);
  const [brokenConnection, setBrokenConnection] = useState<string | null>(null);
  const [connectionPresent, setConnectionPresent] = useState(!!initialCached);
  const [updatedAtBruto, setUpdatedAtBruto] = useState<Date | null>(initialCached?.updatedAt ?? null);
  // Bruto = ultima resposta (alimenta o efeito). A TELA le `syncStatus`,
  // derivado abaixo e sempre do periodo exibido.
  const [syncStatusBruto, setSyncStatusBruto] = useState<SyncStatus | null>(initialCached?.syncStatus ?? null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const page = views[view];

  useEffect(() => {
    const controller = new AbortController();
    const cacheKey = `${view}:${period.query}`;
    const cached = periodCache.get(cacheKey);
    const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
    const pollingDelay = (attempt: number) => Math.min(5_000, 1_500 + Math.max(0, attempt - 1) * 500);
    const timer = window.setTimeout(() => {
      if (!cached) setLoading(true);
      setError(null);
      void (async () => {
        let attempts = 0;
        const readJson = async (response: Response) => {
          const text = await response.text();
          try {
            return text ? JSON.parse(text) : {};
          } catch {
            throw new Error(response.status >= 500
              ? "O serviço demorou para responder. Os últimos dados salvos continuam preservados."
              : "A sessão expirou ou a resposta do servidor foi interrompida. Atualize a página e tente novamente.");
          }
        };
        while (!controller.signal.aborted) {
          attempts += 1;
          const response = await fetch(`/api/integrations/mercado-livre/overview?${period.query}&view=${view}`, { cache: "no-store", signal: controller.signal });
          const data = await readJson(response);
          if (!response.ok && response.status !== 202) {
            if (isBrokenConnection((data as { errorInfo?: { code?: string } })?.errorInfo?.code)) {
              setBrokenConnection(data.error ?? null);
              return;
            }
            throw new Error(data.error || "Não foi possível consultar o Mercado Livre.");
          }
          if (data.connectionId) {
            setConnectionPresent(true);
            setConnectionId(String(data.connectionId));
          }
          if (data.sync) setSyncStatusBruto(data.sync as SyncStatus);
          if (data.overview) {
            // Anúncio por produto viaja no mesmo payload (uma tela, uma chamada
            // — ADR-017), então entra no overview em vez de virar estado à parte.
            const nextOverview = { ...(data.overview as Overview), adsPorProduto: (data.adsPorProduto ?? []) as AnuncioDeProduto[] };
            const nextSync = data.sync ? data.sync as SyncStatus : null;
            const nextUpdatedAt = data.updatedAt ? new Date(data.updatedAt) : new Date();
            periodCache.set(cacheKey, {
              overview: nextOverview,
              syncStatus: nextSync,
              updatedAt: nextUpdatedAt,
            });
            setCarregado({ chave: cacheKey, overview: nextOverview });
            setUpdatedAtBruto(nextUpdatedAt);
            setLoading(false);
            break;
          }
          if (cached) break;
          if (data.preparing) {
            if (attempts >= 40) throw new Error("A preparação dos indicadores está demorando mais que o esperado. Tente novamente em instantes.");
            await wait(pollingDelay(attempts));
            continue;
          }
          if (!data.sync || data.sync.status === "complete" || data.sync.status === "unavailable") break;
          if (data.sync.status === "error") throw new Error(data.sync.error || "A sincronização do Mercado Livre foi interrompida.");
          await wait(pollingDelay(attempts));
        }
      })()
        .catch((reason) => {
          if (reason instanceof DOMException && reason.name === "AbortError") return;
          // Uma falha de revalidação não deve esconder um período que o
          // usuário acabou de consultar e que continua válido no cache da tela.
          if (cached) return;
          setError(reason instanceof Error ? reason.message : "Não foi possível consultar o Mercado Livre.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [period.query, retryKey, view]);

  // ⚠️ DERIVADO NO RENDER (ver a mesma nota na Shopee e no TikTok): no mesmo
  // render em que o periodo muda, o valor exibido ja e o daquele periodo — do
  // cache quando ha, `null` quando nao. Nunca sobra quadro com o dado anterior.
  const chaveAtual = `${view}:${period.query}`;
  const emCache = periodCache.get(chaveAtual);
  const overview = (carregado?.chave === chaveAtual ? carregado.overview : null) ?? emCache?.overview ?? null;
  const syncStatus = (carregado?.chave === chaveAtual ? syncStatusBruto : null) ?? emCache?.syncStatus ?? syncStatusBruto;
  const updatedAt = (carregado?.chave === chaveAtual ? updatedAtBruto : null) ?? emCache?.updatedAt ?? null;

  // Aquecimento dos periodos padrao (depois da pintura, sequencial, so o que
  // falta). Escreve so no `periodCache`; a derivacao acima garante que nada
  // aquecido apareca sob rotulo de outro periodo.
  const jaTemPeriodo = useCallback((q: string) => periodCache.has(`${view}:${q}`), [view]);
  const buscarPeriodo = useCallback(
    (q: string, signal: AbortSignal) => buscarEGuardarPeriodo(view, q, signal),
    [view],
  );

  /**
   * ⚠️ A SÉRIE DOS SETE DIAS, QUANDO O FILTRO É "HOJE" — e só nesse caso.
   *
   * Correção da dona em 03/09/2026, verbatim: *"no filtro de hoje
   * (mercadolivre), o layout mostre o lucro por dia nos últimos 7 dias, e não só
   * hoje. Tem que ser o mesmo layout que mostra os últimos 7 dias do filtro 7
   * dias."*
   *
   * O defeito: o bloco lia `overview.dailySales`, que segue o período
   * selecionado. Com "Hoje" isso é UM ponto — e uma barra sozinha se estica pela
   * régua inteira. O título prometia sete e a tela mostrava um.
   *
   * ⚠️ SÓ A FONTE DESTE BLOCO deixa de seguir o filtro. O resto da página
   * continua no período selecionado: a faixa, os cartões e as tabelas falam de
   * hoje, porque foi hoje que ela pediu. O bloco é a comparação — ele precisa do
   * antes para o hoje significar alguma coisa.
   *
   * ⚠️ E É A MESMA JANELA DO FILTRO "7 DIAS", pela mesma chave de cache: se
   * ela já passou pelo 7 dias (ou o aquecimento já rodou), não há busca nenhuma,
   * e o que a tela mostra nos dois filtros é literalmente o mesmo objeto. Buscar
   * por fora criaria uma segunda janela de sete dias que poderia discordar da
   * primeira — dois consumidores, dois universos, agora no tempo.
   */
  const serieDeSeteDias = useJanelaDeSeteDias(view, connectionId);
  const { aquecerAgora } = usePrefetchDePeriodos({
    ativo: !!overview && !!connectionId,
    atual: period.query,
    escopo: connectionId ?? "",
    jaTem: jaTemPeriodo,
    buscar: buscarPeriodo,
  });

  return (
    <IntegrationDashboardFrame
      className={`dashboard-page meli-workspace ${view === "estoque" ? "listing-page" : view === "monitor" ? "monitor-page" : "ml-dashboard-page"}`}
      period={(view === "dashboard" || view === "monitor" || view === "estoque") ? (
        <DashboardPeriodFilter
          {...period.filterProps}
          onIntent={aquecerAgora}
          meta={view === "dashboard" && updatedAt ? <>Atualizado às {brTime(updatedAt)}{overview?.metrics.lastSaleAt ? ` · última venda às ${brTime(overview.metrics.lastSaleAt, true)}` : ""}</> : undefined}
        />
      ) : undefined}
      header={<PageHeader eyebrow={page.eyebrow} title={page.title} subtitle={page.subtitle} icon={page.icon} action={overview && <span className="meli-account-chip"><i aria-hidden="true" />{overview.account.nickname}<small>{overview.account.siteId}</small></span>} />}
    >
      {brokenConnection && <ConnectionBroken channel="mercado_livre" message={brokenConnection} />}
      {loading ? <DashboardSkeleton label="Carregando dados do Mercado Livre" chart={view === "dashboard"} rows={view === "dashboard" ? 4 : 6} /> : brokenConnection ? null : error ? (
        <EmptyState title="Não foi possível atualizar o Mercado Livre" description={error} action={<button type="button" onClick={() => setRetryKey((key) => key + 1)} className="meli-primary-action">Tentar novamente <span aria-hidden="true">↻</span></button>} />
      ) : !overview && connectionPresent ? (
        <div className="space-y-4">
          <div className="sync-chip" role="status">
            <span className="sync-chip-track is-indeterminate" aria-hidden="true"><i /></span>
            <p>Conta conectada — organizando os pedidos do período. Os indicadores aparecem aqui em instantes.</p>
          </div>
          <DashboardSkeleton label="Preparando os indicadores do período" chart={view === "dashboard"} />
        </div>
      ) : !overview ? (
        <EmptyState title="Conecte sua conta do Mercado Livre" description="Autorize o NEXO para começar a importar anúncios e pedidos." action={<Link href="/integracoes" className="meli-primary-action">Gerenciar integração <span aria-hidden="true">→</span></Link>} />
      ) : view === "dashboard" ? <Dashboard overview={overview} syncStatus={syncStatus} periodoQuery={period.query} connectionId={connectionId} serieDeSeteDias={serieDeSeteDias} /> : view === "estoque" ? <Inventory overview={overview} /> : <Monitor overview={overview} secaoInicial={secaoInicial} periodoQuery={period.query} />}
    </IntegrationDashboardFrame>
  );
}

/**
 * Estado do resultado do canal, em UM lugar só — o Dashboard e o Monitor liam a
 * mesma regra em cópias separadas, e foi assim que os dois divergiram.
 */

function avaliarResultado(overview: Overview) {
  const profitCoverage = overview.profit.coverage;
  // MARGEM: parcial é diferente de desconhecida, e tratar as duas igual deixou o
  // card em "—" para sempre.
  //
  // Na conta medida em 23/08/2026 faltava custo em 26 de ~8.000 unidades e frete
  // em 59 de 7.133 pedidos — 0,8% do volume travando 100% do indicador. O
  // AGENTS.md manda o oposto: "o painel mostra só o que foi capturado e diz que
  // está parcial — nunca projeta o resto".
  //
  // ALÍQUOTA AUSENTE NÃO BLOQUEIA MAIS (decisão dela em 26/08/2026).
  //
  // Ela é configuração da vendedora, não dado do canal: o lucro sai calculado
  // sem o imposto (`estimatedProfit` já faz `taxes ?? 0` no canônico) e a tela
  // rotula "(sem imposto)". A pendência "Cadastrar alíquota →" continua onde
  // estava — mostrar o número não dispensa apontar o que falta.
  //
  // O que continua bloqueando é `resultParcial`: pedido sem conciliar, unidade
  // sem custo, frete não capturado. Esses são `null` de dado do marketplace, e
  // na tela ninguém distingue "não cobraram" de "ainda não sei".
  const semAliquota = overview.profit.taxes == null;
  const faltas: string[] = [];
  if (!profitCoverage.complete) faltas.push(`${profitCoverage.paidOrders - profitCoverage.processedOrders} pedido(s) sem conciliar`);
  if (overview.profit.unitsWithoutCost > 0) faltas.push(`${overview.profit.unitsWithoutCost} unidade(s) sem custo`);
  if (!overview.profit.shippingCostsComplete) faltas.push("frete de alguns pedidos");
  const resultParcial = faltas.length > 0;
  // Só dado do canal bloqueia. A alíquota saiu daqui de propósito.
  //
  // ⚠️ `estimatedProfit == null` entrou aqui em 30/08/2026, quando o lucro dos
  // quatro canais passou a DESCONTAR o gasto com anúncio: com o sync de Ads sem
  // resposta, o lucro é DESCONHECIDO, não zero. Sem esta linha o número caía em
  // `money(null)` e a tela escrevia "R$ 0,00" — a mentira que o AGENTS.md
  // proíbe, e ela só apareceria quando o Ads falhasse, que é justo quando
  // importa. Mesmo padrão do arquivo vizinho (`ShopeeWorkspace`).
  const resultIncomplete = resultParcial || overview.profit.estimatedProfit == null;
  // ⚠️ A FRASE DIZIA "sobre o faturamento" E A CONTA NAO ERA SOBRE ELE.
  //
  // Achado em 01/09/2026: o denominador de lucro e margem do ML e
  // `revenueProcessed` — o APURADO —, e o card ao lado exibe `revenue30d`, o
  // faturamento. A tela afirmava a base errada em texto fixo, que e pior que
  // nao declarar nada: nao declarar deixa a pessoa desconfiar, declarar errado
  // desliga a desconfianca. Foi exatamente o defeito da Amazon em 31/08 —
  // numeros certos de universos diferentes lado a lado —, so que aqui com uma
  // frase confirmando o universo errado.
  //
  // A peca e a MESMA dos outros canais (`declaracaoDeBase`), e ela devolve
  // `null` quando as bases coincidem: no dia em que o backend trocar o
  // denominador para o faturamento, a frase vira "sobre o faturamento" sozinha,
  // sem ninguem precisar lembrar de vir aqui apagar.
  //
  // E vai no `sub` do card, VISIVEL SEM INTERACAO — nunca no "i". Declaracao
  // que exige hover nao declara (tem teste que reprova a ida para o tooltip).
  const baseDoResultado = declaracaoDeBase({
    baseApurada: overview.profit.revenueDoLucro ?? overview.profit.revenueProcessed,
    faturamentoExibido: overview.metrics.revenue30d,
    moeda: overview.metrics.currency,
    pedidosAguardando: overview.profit.pedidosSemApuracao
      ?? Math.max(0, overview.profit.coverage.paidOrders - overview.profit.coverage.processedOrders),
  });
  const margemSub = resultParcial
    ? `falta ${faltas.join(", ")}`
    : comSemImposto(baseDoResultado ?? BASE_SEM_DIFERENCA, semAliquota);
  return { semAliquota, resultParcial, resultIncomplete, margemSub };
}

/**
 * Titulo do periodo para CABECALHO, derivado da PROPRIA CONSULTA.
 *
 * ⚠️ NAO ACEITA O ROTULO POR PROP, e essa e a correcao. Antes o
 * titulo vinha de `periodoLabel`, um valor separado de `periodoQuery` — e dois
 * valores que precisam concordar acabam discordando: em 09/09/2026 a tela
 * mostrava "7 dias" marcado no filtro e "Ultimos 30 dias" no titulo, porque a
 * bancada passava o rotulo fixo. Derivar da string que BUSCOU os dados torna a
 * divergencia impossivel, em vez de improvavel.
 *
 * E a mesma familia do `from`/`to` da Shopee que o AGENTS.md registra: botao
 * marcado exibindo outro periodo. Ali o defeito custou um teste decorativo.
 */
function tituloDoPeriodo(periodoQuery: string): string {
  const p = new URLSearchParams(periodoQuery);
  const from = p.get("from");
  const to = p.get("to");
  if (from && to) {
    const br = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");
    return `De ${br(from)} a ${br(to)}`;
  }
  const dias = p.get("days");
  if (dias === "today") return "Hoje";
  if (dias === "7" || dias === "15" || dias === "30") return `Últimos ${dias} dias`;
  return "Período selecionado";
}

export function Dashboard({ overview, syncStatus, periodoQuery, connectionId, serieDeSeteDias }: { overview: Overview; syncStatus: SyncStatus | null; periodoQuery: string; connectionId: string | null; serieDeSeteDias: DailyPoint[] | null }) {
  // Alternador de metrica do Ritmo (v3). Estado de tela, nao de dado.
  const [metricaV3, setMetricaV3] = useState("Faturamento");
  const profitCoverage = overview.profit.coverage;
  const critical = overview.stockRadar.filter((product) => product.status === "critical" || product.status === "out");
  const { semAliquota, margemSub } = avaliarResultado(overview);
  /**
   * ⚠️ A MESMA LISTA DE SEMPRE, so extraida para ter nome. Nenhuma
   * condicao mudou: aliquota ausente, produtos sem custo, pedidos cancelados e
   * estoque critico, na mesma ordem e com os mesmos textos e destinos.
   */

  /**
   * ⚠️ OS SETE DIAS DO BLOCO "LUCRO POR DIA", e o cuidado todo está em NÃO
   * TRANSFORMAR `null` EM ZERO no caminho até a tela.
   *
   * O contrato distingue os dois na origem: `0` é fato (o dia não teve venda),
   * `null` é desconhecido (o dia vendeu, e custo, tarifa ou alíquota ainda não
   * chegaram). Aqui o `null` vira o traço e a ausência de coluna; um `?? 0`
   * nesta linha desenharia uma queda que não aconteceu.
   *
   * ⚠️ E "HOJE" SÓ É DITO QUANDO É VERDADE. A prancheta destaca a última coluna
   * como "hoje", e ela é — quando o período vai até hoje. Num período passado
   * escolhido a dedo, a última coluna é a última do RECORTE, e chamá-la de hoje
   * seria uma data inventada. O destaque verde continua sempre no dia mais
   * recente; só a palavra depende da data bater.
   *
   * Fuso: a chave `YYYY-MM-DD` já vem calculada em São Paulo. Passá-la por
   * `new Date(dia)` a leria como meia-noite UTC e o dia da semana viria do dia
   * anterior — a mesma pegadinha anotada em `TikTokSaldo`. Por isso a data é
   * fixada ao meio-dia UTC e formatada em UTC.
   */
  const hojeNoBrasil = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const diaDaSemana = (data: string) =>
    new Date(`${data}T12:00:00Z`)
      .toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" })
      .replace(".", "");
  /**
   * ⚠️ A FONTE DO BLOCO NÃO OLHA MAIS O FILTRO. Decisão da dona em
   * 09/09/2026: o ritmo é sempre dos últimos sete dias, qualquer que seja o
   * período selecionado acima. O porquê e o que valia antes estão em
   * `serieDoLucroPorDia.ts`, junto da função.
   */
  const serieDoBloco = serieDoBlocoDeLucro({ janelaDeSeteDias: serieDeSeteDias });
  const contagem = (n: number) => n.toLocaleString("pt-BR");

  /**
   * ⚠️ O "CUSTOU" DA FAIXA NAO EXISTE COMO CAMPO — e a soma das quatro
   * parcelas, e por isso ela passa por `somaDosCustos`, que se recusa a somar
   * quando alguma e desconhecida. Sem aliquota cadastrada, `taxes` chega `null`
   * e um `?? 0` aqui daria um total exato e MENOR que o real, com o "Sobrou" ao
   * lado parecendo melhor do que e. Nada ficaria vermelho.
   */
  /**
   * ⚠️ ALIQUOTA NAO CADASTRADA VALE ZERO NA CONTA — excecao nomeada,
   * decidida pela Ana em 07/09/2026, e o `?? 0` abaixo e ela, nao um descuido.
   *
   * O contrato acertado com o backend (ADR-038) e: `taxes` passa a vir 0 do
   * produtor e `taxRate` CONTINUA `null` quando nao ha cadastro. O `?? 0` cobre
   * a janela ate o produtor subir nos quatro canais; depois dela ele vira
   * redundante e inofensivo.
   *
   * ⚠️ O RASTRO NAO SE PERDE, e e o que autoriza a excecao: a pendencia
   * "Alíquota não configurada" continua na fila (ver `alertasDoCaminho`) e a
   * linha da tabela mostra "sem alíquota" na coluna Situacao. O numero fecha; o
   * aviso fica.
   *
   * ⚠️ E ISTO NAO VALE PARA TARIFA, FRETE NEM CUSTO. Naqueles o `null`
   * e desconhecido de verdade — ninguem decidiu que valem zero, a fonte e que
   * ainda nao publicou —, e eles continuam apagando o total.
   */
  const impostoNaConta = overview.profit.taxes ?? 0;

  /**
   * ⚠️ O CARD DE ANUNCIOS LE `adsPorProduto`, que a frente de Ads de
   * 28/08/2026 ja entrega com ACOS, ROAS e a MARGEM REAL cruzada com custo e
   * tarifas. Nada aqui e calculado: as sete colunas sao campos do produtor.
   */
  const anunciosDoPeriodo = overview.adsPorProduto ?? [];
  const gastoEmAnuncios = anunciosDoPeriodo.reduce((total, anuncio) => total + anuncio.cost, 0);

  const anunciosDaTabela = anunciosDoPeriodo.slice(0, 5).map((anuncio) => {
    // ⚠️ SEM VENDA ATRIBUIDA nao ha ACOS nem ROAS para mostrar. O
    // produtor distingue isso por `purchases`, e nao pelo `acos` — um `acos: 0`
    // vindo da fonte significaria "gastou e vendeu muito", que e o OPOSTO de
    // "nao vendeu". A frente de Ads ja pagou por essa confusao.
    const semVenda = anuncio.purchases === 0;
    return {
      id: anuncio.productId,
      produto: anuncio.title ?? anuncio.sku ?? anuncio.productId,
      impressoes: contagem(anuncio.impressions),
      cliques: contagem(anuncio.clicks),
      gasto: money(anuncio.cost, anuncio.currency),
      vendasAtribuidas: semVenda
        ? "sem venda"
        : `${money(anuncio.sales, anuncio.currency)} · ${contagem(anuncio.purchases)}`,
      // As duas grandezas, separadas: valor vendido e quantidade comprada.
      vendasValor: semVenda ? "—" : money(anuncio.sales, anuncio.currency),
      comprasQtd: semVenda ? "—" : contagem(anuncio.purchases),
      semVenda,
      acos: anuncio.acos == null ? "—" : `${anuncio.acos.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
      roas: anuncio.roas == null ? "—" : `${anuncio.roas.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×`,
      marginPct: anuncio.margemRealPct,
    };
  });

  const alertasDoCaminho = [
    ...(overview.metrics.productsWithoutCost > 0 ? [{
      id: "sem-custo",
      titulo: `${overview.metrics.productsWithoutCost} produto(s) sem custo cadastrado`,
      detalhe: "a margem deles fica em branco até o custo entrar",
      acao: "Cadastrar custos",
      href: "/mercado-livre/anuncios",
      tom: "acao" as const,
    }] : []),
    ...(semAliquota ? [{
      id: "sem-aliquota",
      titulo: "Alíquota de imposto não cadastrada",
      // ⚠️ ESTE TEXTO ENVELHECEU EM 07/09/2026 E EU NAO TINHA PERCEBIDO.
      // Ele dizia "o lucro fica em branco", e era verdade ate a Ana decidir que
      // aliquota ausente vale ZERO na conta. Depois disso o lucro NAO fica em
      // branco: ele fecha, e fecha MAIOR que o real, porque falta um custo.
      //
      // A frase antiga assustava com a consequencia errada; a nova diz o que
      // esta acontecendo com o numero que ela esta olhando agora. E a mesma
      // familia do AGENTS.md: afirmacao verdadeira morre junto com a regra que
      // a sustentava, e enquanto sobrevive ela mente.
      detalhe: "A alíquota de imposto ainda não está cadastrada: o imposto entra como zero, e o lucro acima está maior que o real",
      acao: "Cadastrar alíquota",
      href: MERCADO_LIVRE_TAX_RATE_HREF,
      tom: "acao" as const,
    }] : []),
    ...(critical.length > 0 ? [{
      id: "estoque",
      titulo: `${critical.length} produto(s) em estoque crítico`,
      detalhe: "no ritmo de venda desta semana",
      acao: "Ver no radar",
      href: "/mercado-livre/estoque",
      tom: "atencao" as const,
    }] : []),
  ];

  /**
   * ⚠️ ESTRUTURA v3 — a composição veio do canvas dela
   * ("Dashboard Mercado Livre v3.dc.html", lido via DesignSync em 09/09/2026).
   *
   * ⚠️ NENHUM DADO NOVO E NENHUM DADO A MENOS: tudo abaixo sai do
   * MESMO `overview` que a faixa antiga já usava. O que muda é a APRESENTAÇÃO —
   * o custo deixa de ser um total ("Custou") e passa a abrir em tarifa, frete,
   * produto e imposto, que é onde a margem realmente se decide.
   *
   * As regras de dado incerto seguem valendo: imposto sem alíquota é travessão,
   * produto sem custo entra sem margem, dia sem apuração fica só com o contorno.
   */
  /**
   * ⚠️ A DIVISAO VOLTOU PARA O MODULO TESTADO (11/09/2026). Esta
   * funcao nasceu com a conta escrita aqui — `(v / revenue30d) * 100` —, e a
   * conta era a MESMA que `sobreAVenda` ja fazia, com os dois casos de borda
   * cobertos por teste: base zero nao e "0%", e divisor invalido nao vira
   * "NaN%" nem "Infinity%".
   *
   * Duas copias da mesma divisao e como as porcentagens param de fechar com o
   * numero de cima sem ninguem notar — a base de uma muda e a da outra nao.
   * Aqui sobrou o que e de apresentacao: formatar e escrever o sufixo.
   */
  const pctDaVenda = (v: number | null | undefined) => {
    const pct = sobreAVenda(v, overview.metrics.revenue30d);
    return pct == null ? "" : pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "% da venda";
  };

  const maiorFaturamento = Math.max(1, ...overview.topProducts.map((p) => p.revenue));
  const semMoeda = (n: number) => money(n, overview.metrics.currency).replace(/^R\$\s*/, "");

  const dadosV3 = {
    periodoLabel: tituloDoPeriodo(periodoQuery),
    resumoApuracao: profitCoverage.processedOrders + " de " + profitCoverage.paidOrders + " pedidos apurados",
    colunas: [
      { id: "vendeu", rotulo: "Você vendeu", valor: money(overview.metrics.revenue30d, overview.metrics.currency), share: overview.metrics.paidOrders + " aprovados" + (overview.metrics.cancelledOrders === 0 ? ", nenhum cancelado" : ", " + overview.metrics.cancelledOrders + " cancelados"), dica: "Faturamento aprovado do período, pela data do pedido. Cancelados ficam fora." },
      { id: "tarifa", rotulo: "Tarifa do ML", valor: money(overview.profit.fees, overview.metrics.currency), share: pctDaVenda(overview.profit.fees), dica: "Comissão efetivamente cobrada em cada pedido." },
      { id: "frete", rotulo: "Frete que você paga", valor: money(overview.profit.sellerShipping, overview.metrics.currency), share: pctDaVenda(overview.profit.sellerShipping), dica: "A parte do frete que sai de você, separada do que o comprador pagou." },
      { id: "custo", rotulo: "Custo dos produtos", valor: money(overview.profit.cogs, overview.metrics.currency), share: pctDaVenda(overview.profit.cogs), dica: "Custo cadastrado por SKU na data do pedido." },
      { id: "imposto", rotulo: "Impostos", valor: overview.profit.taxRate == null ? "—" : money(overview.profit.taxes ?? 0, overview.metrics.currency), share: overview.profit.taxRate == null ? "alíquota não configurada" : "alíquota de " + overview.profit.taxRate + "%", tom: overview.profit.taxRate == null ? "vazio" : "normal" },
      /**
       * ⚠️ DOIS DEFEITOS NA MESMA LINHA, achados em 11/09/2026 —
       * ela mandava `tom: "positivo"` para QUALQUER lucro nao-nulo.
       *
       *   1. PREJUIZO SAIA VERDE. Cor significa estado nesta casa: verde e
       *      dinheiro, vermelho e prejuizo. Um mes negativo era desenhado com a
       *      cor do mes bom, e cor engana mais rapido que numero — ninguem le o
       *      sinal antes da cor.
       *   2. LUCRO COM PARCELA DESCONHECIDA TAMBEM SAIA VERDE. Esta e a regra
       *      que `fatiaDoSobrou` guarda desde 06/09: com qualquer parcela do
       *      custo desconhecida, a tela NAO afirma resultado fechado — o numero
       *      continua aparecendo (parcial nao e apagar), mas sem a cor que diz
       *      "conta fechada, e fechou bem".
       *
       * ⚠️ E POR QUE A PECA VELHA, e nao um `if` novo aqui: ela
       * ja carrega a decisao inteira e o imposto ja resolvido em zero (07/09 —
       * aliquota nao cadastrada vale zero, as outras tres continuam bloqueando).
       * Reescrever a condicao aqui seria uma segunda fonte da verdade, que e
       * como as duas metades passam a divergir sem ninguem notar.
       */
      {
        id: "sobrou",
        rotulo: "Lucro",
        valor: overview.profit.estimatedProfit == null ? "—" : money(overview.profit.estimatedProfit, overview.metrics.currency),
        share: "",
        tom: overview.profit.estimatedProfit == null
          ? "vazio"
          : overview.profit.estimatedProfit < 0
          ? "negativo"
          : fatiaDoSobrou({
              parcelas: [overview.profit.cogs, overview.profit.sellerShipping, overview.profit.fees, impostoNaConta],
              lucro: overview.profit.estimatedProfit,
              base: overview.metrics.revenue30d,
            }) == null
          ? "normal"
          : "positivo",
      },
    ],
    margem: {
      valor: overview.profit.marginPct == null ? "—" : overview.profit.marginPct.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%",
      tom: overview.profit.marginPct == null ? "vazio" : overview.profit.marginPct < 0 ? "negativo" : "positivo",
      /* ⚠️ A DECLARACAO DA BASE MORA AQUI NO V3 (11/09/2026), e
         este slot estava VAZIO — `nota: ""`. O calculo nunca sumiu
         (`avaliarResultado` segue devolvendo `margemSub`); o que sumiu foi o
         card `<Metric label="Margem" sub={margemSub}>`, que era quem o exibia.
         O redesign nao revoga a regra: se a peca nova nao tinha lugar para a
         declaracao, ela ganha um — e ganhou o mesmo lugar dos vizinhos, a linha
         sob o numero, VISIVEL SEM INTERACAO.

         ⚠️ O DEFEITO QUE ISSO REPROVA e de 01/09/2026: a tela
         AFIRMAVA "sobre o faturamento" enquanto lucro e margem saiam do
         APURADO. Declarar base errada e pior que nao declarar — nao declarar
         deixa a pessoa desconfiar de dois numeros que nao fecham; declarar
         errado desliga a desconfianca. Entre 09 e 11/09 a tela nao mentia, mas
         tinha calado: a margem aparecia sozinha, sem dizer sobre o que e.

         Os dois ramos de `margemSub` importam: com falta, ele diz O QUE falta
         com numero ("falta 26 unidade(s) sem custo"); sem falta, a frase da
         base, que some sozinha quando as bases coincidem. */
      nota: margemSub,
    },
    notaDoImposto: semAliquota ? (
      <>
        Imposto sem alíquota configurada não é zero: fica desconhecido e o lucro acima é o máximo possível, não o final.{" "}
        <Link href={MERCADO_LIVRE_TAX_RATE_HREF}>Configurar alíquota</Link>
      </>
    ) : null,
    /**
     * ⚠️ OITO, E O TITULO CONTA A LISTA em vez de repetir o
     * numero. Escolha dela em 09/09/2026 para fechar os 185px que sobravam ao
     * lado do Ritmo — tres linhas a mais deixam as duas colunas em 643 contra
     * 660, e o espaco vira INFORMACAO em vez de ar.
     *
     * ⚠️ POR QUE O TITULO NAO PODE TRAZER O "8" CRAVADO: conta com
     * menos de oito produtos no periodo mostraria menos linhas, e o rotulo
     * prometeria oito. E a terceira vez que esta familia aparece hoje — o
     * "Ritmo dos ultimos 7 dias" seguindo o filtro, o "Onde a margem escapa"
     * num ranking ordenado por faturamento, e o numero no titulo. Por isso
     * `PainelV3.tsx` deriva o numero de `produtos.length`.
     *
     * O canonico ja entrega 8 (`mercadoLivreOverviewCanonical.ts`), ordenados
     * por faturamento decrescente — este corte usa a lista inteira que chega.
     */
    produtos: overview.topProducts.slice(0, 8).map((p, i) => ({
      id: p.id,
      posicao: i + 1,
      titulo: p.title,
      sku: p.sku,
      unidades: p.units.toLocaleString("pt-BR") + " un",
      faturamento: semMoeda(p.revenue),
      fracao: p.revenue / maiorFaturamento,
      contribuicao: p.complete ? semMoeda(p.contribution) : "—",
      margemPct: p.marginPct,
    })),
    ritmo: {
      metricas: ["Faturamento", "Pedidos", "Unidades"],
      metricaAtiva: metricaV3,
      aoTrocarMetrica: setMetricaV3,
      legendaTotal: metricaV3.toLowerCase(),
      legendaMedia: metricaV3 === "Faturamento" ? "média de lucro do período" : "média de " + metricaV3.toLowerCase() + " por dia",
      mostraLucro: metricaV3 === "Faturamento",
      media: (() => {
        const base = metricaV3 === "Faturamento"
          ? serieDoBloco.filter((d): d is typeof d & { profit: number } => d.profit != null).map((d) => d.profit)
          : serieDoBloco.map((d) => (metricaV3 === "Pedidos" ? d.orders : d.units));
        return base.length ? base.reduce((acc, v) => acc + v, 0) / base.length : 0;
      })(),
      dias: serieDoBloco.map((d) => {
        const total = metricaV3 === "Faturamento" ? d.revenue : metricaV3 === "Pedidos" ? d.orders : d.units;
        return {
          id: d.date,
          dia: d.date === hojeNoBrasil ? "hoje" : diaDaSemana(d.date),
          total,
          lucro: d.profit ?? null,
          rotuloTotal: metricaV3 === "Faturamento"
            ? money(d.revenue, overview.metrics.currency)
            : total.toLocaleString("pt-BR") + (metricaV3 === "Pedidos" ? " ped." : " un."),
          rotuloLucro: d.profit == null ? null : money(d.profit, overview.metrics.currency),
          destaque: d.date === serieDoBloco[serieDoBloco.length - 1]?.date,
        };
      }),
      nota: metricaV3 === "Faturamento"
        ? "A parte cheia é o que sobrou do que foi vendido naquele dia. Dia sem apuração fechada fica só com o contorno e não conta na média."
        : "Volume por dia, sem valor: serve para ver o ritmo de venda separado do dinheiro.",
    },
    pendencias: alertasDoCaminho.map((a) => ({
      id: a.id,
      titulo: a.titulo,
      efeito: a.detalhe,
      acao: a.acao,
      href: a.href,
      tom: a.tom === "acao" ? "atencao" : "neutro",
    })),
    hrefs: {
      resultado: "/mercado-livre/monitor",
      produtos: "/mercado-livre/anuncios",
      historico: "/mercado-livre/vendas",
      pendencias: "/mercado-livre/anuncios",
    },
  /* ⚠️ `satisfies`, NAO `as unknown as` (11/09/2026). O molde
     nasceu com dupla conversao, que desliga a checagem inteira: campo com nome
     trocado, faltando ou com tipo errado compilava igual, e o painel so
     denunciaria na tela. Como este objeto e a UNICA ponte entre os produtores
     do ML e o desenho novo, e ele que tem de ficar vermelho quando um campo
     muda de forma. Medido: com `satisfies`, `tsc --noEmit` passa limpo — a
     conversao nao escondia erro nenhum, so a possibilidade de um. */
  } satisfies DadosV3;


  /**
   * ⚠️ DEIXOU DE SER FILA DE TRABALHO E VIROU EXTRATO. Decisao dela
   * em 09/09/2026: *"aqui sera so Pedidos mesmo, ai aparece uns 4-5 pedidos com
   * base no filtro de data"*.
   *
   * O que valia antes: so entrava o pedido que pedia uma ACAO — margem
   * negativa, custo ausente ou repasse pendente —, e havia uma coluna "Motivo"
   * dizendo qual dos tres. Era a separacao entre fila de trabalho e extrato que
   * o canvas propunha.
   *
   * ⚠️ O QUE ISSO CUSTA, para quem for reverter saber: os pedidos
   * com pendencia deixam de ter destaque proprio aqui. Eles NAO sumiram da
   * tela — "O que falta para o numero fechar" continua contando produto sem
   * custo e aliquota ausente, e a coluna Margem continua vazia (nunca zero)
   * quando falta custo. O que se perdeu foi o atalho de ver os tres motivos
   * lado a lado.
   *
   * Ordena por data decrescente: "os ultimos pedidos" so quer dizer alguma
   * coisa se a ordem for essa, e `profitabilityLines` nao promete ordem.
   */
  const ultimosPedidos = [...overview.profitabilityLines]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 5)
    .map((l) => ({
      id: l.id,
      produto: l.product,
      detalhe: [l.sku, `${l.quantity} un`, brDate(l.date)].filter(Boolean).join(" · "),
      pedido: "#…" + String(l.orderId).slice(-6),
      logistica: l.fulfillment ?? "—",
      venda: l.revenue == null ? "—" : semMoeda(l.revenue),
      tarifa: l.marketplaceFees == null ? "—" : semMoeda(l.marketplaceFees),
      frete: l.sellerShipping == null || l.sellerShipping === 0 ? "—" : semMoeda(l.sellerShipping),
      custo: l.productCost == null ? "—" : semMoeda(l.productCost),
      custoVazio: l.productCost == null,
      imposto: l.tax == null ? "—" : semMoeda(l.tax),
      impostoVazio: l.tax == null,
      margemPct: l.marginPct,
    }));


  const dadosV3Baixo = {
    revisar: {
      linhas: ultimosPedidos,
      href: "/mercado-livre/monitor",
      vazio: "Nenhum pedido no período.",
      escopo: fraseDeEscopo(overview.profitabilityScope),
    },
    anuncios: anunciosDoPeriodo.length === 0 ? null : {
      linhas: anunciosDaTabela.map((a) => ({
        id: a.id,
        produto: a.produto,
        trafego: `${a.impressoes} impressões · ${a.cliques} cliques`,
        gasto: a.gasto,
        vendas: a.vendasValor,
        compras: a.comprasQtd,
        acos: a.acos,
        roas: a.roas,
        semVenda: a.semVenda,
        margemPct: a.marginPct,
      })),
      resumo: `gasto ${money(gastoEmAnuncios, overview.metrics.currency)}${overview.profit.tacos?.pct != null ? " · TACOS " + overview.profit.tacos.pct.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%" : ""}`,
      href: "/mercado-livre/anuncios",
    },
    radar: {
      itens: overview.stockRadar.slice(0, 5).map((e) => ({
        id: e.id,
        titulo: e.title || e.sku || e.id,
        unidades: e.availableQuantity === 0 ? "—" : `${e.availableQuantity} un`,
        cobertura: e.status === "out" ? "esgotado" : e.daysRemaining == null ? "—" : `${e.daysRemaining} dias`,
        tom: e.availableQuantity === 0 && e.status !== "out" ? "vazio" : tomDaCobertura(e.status),
      })),
      href: "/mercado-livre/estoque",
      vazio: "Nenhum produto no radar.",
    },
    saldo: <MercadoLivreSaldo modo="etapa" connectionId={connectionId ?? undefined} />,
    /**
     * ⚠️ `null` ATÉ O PRODUTOR EXISTIR, e não exemplo
     * (11/09/2026). Estes dois blocos vinham com quatro concorrentes e três
     * campanhas escritos à mão, marcados só por um "exemplo · sem rota ainda"
     * no canto — e o comentário que estava aqui já dizia, com todas as letras,
     * que assim eles não podiam ir para produção. A leva sobe; então eles não
     * sobem.
     *
     * ⚠️ NÚMERO INVENTADO NÃO É PLACEHOLDER NUMA TELA DE
     * DINHEIRO. "Arranhador e Protetor de Sofá · 12º de 33 · margem −4%" é
     * indistinguível de leitura real, e quem lê decide preço com ele. Etiqueta
     * discreta no canto não desfaz isso.
     *
     * `PainelV3Baixo` aceita `null` nos dois e não desenha o bloco — ausência
     * é ausência, como no resto do produto. O layout está descrito no canvas e
     * não se perde: quando `api/integrations/mercado-livre/` ganhar
     * concorrentes por catálogo e as campanhas que o ML oferece, trocar o
     * `null` pelos itens é a única mudança daqui.
     */
    catalogo: null,
    promocoes: null,
  } satisfies DadosV3Baixo;



  // ⚠️ 30/08/2026 — custo faltando virou SINAL, nao trava (decisao da vendedora).
  // O numero aparece sempre; `sinais` anda colado nele.
  // O painel de composicao fala do universo da RECEITA PAGA, e o resultado dele
  // e o residuo do proprio bloco — nunca o lucro do periodo, que vive nos cards
  // e parte do faturamento. Os dois caminhos do ML (canonico e legado) expoem a
  // composicao desde 02/09/2026.
  //
  // ⚠️ SEM COMPOSICAO, O PAINEL NAO INVENTA UM NUMERO. A tentacao era
  // `revenueProcessed - knownCosts`, e ela seria a propria doenca de volta:
  // `taxes` no caminho canonico incide sobre o FATURAMENTO, entao a subtracao
  // cobriria um universo maior que o centro. Ausencia se mostra como ausencia.
  // Período do filtro vs. histórico já importado (frente K): mês ainda não
  // importado nunca vira cards zerados — "não vendeu" e "não importei" são
  // fatos diferentes. O covered_from chega pelo overview (historicoDesde).
  const cobertura = coberturaDoPeriodo({
    periodoDeMs: new Date(overview.period.from).getTime(),
    periodoAteMs: new Date(overview.period.to).getTime(),
    coveredFrom: overview.metrics.revenueCoverage.historicoDesde ?? null,
    status: syncStatus?.status ?? null,
  });
  if (cobertura.periodoInteiroDescoberto) {
    const desde = cobertura.cobreDesde ? brDate(new Date(cobertura.cobreDesde)) : null;
    return <div className="dashboard-sections integration-dashboard-sections ml-dashboard-body">
      <NexoDoDia />
      <EmptyState
        kind="data"
        title={cobertura.emImportacao ? "Este período ainda está sendo importado" : "Período anterior ao histórico importado"}
        description={cobertura.emImportacao
          ? `${desde ? `O histórico já cobre a partir de ${desde}. ` : ""}${syncStatus?.processedOrders ?? 0} pedido(s) já importado(s) — este período aparece conforme o histórico avança.`
          : `O histórico importado começa em ${desde ?? "—"}. Datas anteriores não foram importadas.`}
      />
    </div>;
  }
  return <div className="dashboard-sections integration-dashboard-sections ml-dashboard-body">
    {/* A MESMA leitura do NEXO dos outros canais — uma narracao por dia por
    workspace, nao uma por canal. So aparece se ja estiver escrita. */}
    <NexoDoDia />
    {/* Duas faixas de largura total viraram UMA linha discreta: as duas diziam
        partes da mesma frase (quanto ja importou / ate onde alcanca) com peso
        de alarme, empilhadas antes do primeiro numero. Toda frase antiga
        sobrevive, nas mesmas condicoes — ver `ProgressoDaImportacao`. */}
    <ProgressoDaImportacao
      progresso={syncStatus && syncStatus.status !== "complete" && syncStatus.status !== "unavailable" ? syncStatus.progress : null}
      cobreDesde={cobertura.periodoCoberto ? null : cobertura.cobreDesde}
      emImportacao={cobertura.emImportacao}
      pedidosImportados={syncStatus?.processedOrders}
    />
    {/* ⚠️ A FAIXA DE 4 ETAPAS NO LUGAR DO COCKPIT (06/09/2026, canvas
        "Caminho do dinheiro" aprovado pela Ana).

        O que saiu daqui saiu por DUPLICACAO, e os cortes foram aprovados: o
        lucro aparecia tres vezes na pagina e passa a aparecer uma; a cascata e
        a legenda diziam a decomposicao do custo, que agora e a linha de
        contexto da etapa "Custou". Nenhum numero novo entrou e nenhum produtor
        mudou — os quatro valores saem dos mesmos campos de antes.

        ⚠️ E OS DOIS BLOCOS QUE MORAVAM DENTRO DA FAIXA CONTINUAM NA PAGINA,
        logo abaixo: o lucro por dia e o top produtos. Eles nao foram cortados —
        ganham o tratamento do canvas nas proximas etapas. Remove-los agora
        porque a caixa que os hospedava mudou seria perder funcao no meio de uma
        troca de layout. */}
    {/* ⚠️ A QUARTA ETAPA VEM DE OUTRA FONTE, e por isso entra como
        filho: o saldo do Mercado Pago tem busca propria, e quem o desenha e
        quem ja o busca. Mover o fetch para ca seria trocar arquitetura numa
        frente de layout — e duplicar a chamada seria pior ainda.

        ⚠️ E ELA PODE NAO VIR. Sem saldo conhecido o componente some em
        silencio e a faixa fecha com tres — ausencia e ausencia, como no card da
        Amazon. Nada de "R$ 0,00" nem de "proximo repasse ~dia X" estimado por
        nos. */}
    {/* ⚠️ A PRIMEIRA VIEWPORT É A v3 (09/09/2026). A faixa de quatro
        etapas, os alertas soltos e o par ranking+decomposição foram SUBSTITUÍDOS
        — não escondidos. Quem procurar por eles nesta tela não os encontra, que
        é a checagem que a frente anterior falhou: "o que isto substitui ainda
        está na página?".

        O saldo do Mercado Pago continua vindo de fetch próprio e entra ao lado,
        porque quem o desenha é quem já o busca. */}
    <PainelV3 dados={dadosV3} />

    {/* ⚠️ A METADE DE BAIXO É A v3. A tabela de vendas, o card de
        anúncios e o painel de "Estoque crítico" foram SUBSTITUÍDOS por Pedidos a
        revisar, Anúncios pagos e Radar do FULL — não somados. Procurar pelos
        antigos nesta tela não os encontra, que é a checagem que a frente anterior
        falhou. */}
    <PainelV3Baixo dados={dadosV3Baixo} />

    {/* No desktop a sidebar já cobre estes atalhos; no mobile a nav é scroll
        horizontal e os cartões ajudam. */}
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:hidden">
      <QuickLink href="/mercado-livre/monitor" label="Monitor" desc="Pedidos e financeiro" />
      <QuickLink href="/mercado-livre/estoque" label="Radar" desc="Estoque × velocidade" />
      {/* ⚠️ UM atalho de Anuncios, nao dois (11/09/2026). Quando a
          tela de Produtos foi absorvida por Anuncios, o atalho dela foi
          reapontado e ficou ao lado do que ja existia: dois cartoes identicos,
          lado a lado, com descricoes diferentes para o MESMO destino. A
          descricao que sobrou e a que cobre o que a tela faz agora. */}
      <QuickLink href="/mercado-livre/anuncios" label="Anúncios" desc="Catálogo, custos e alíquota" />
    </div>
  </div>;
}


function Empty({ children }: { children: React.ReactNode }) {
  return <EmptyState compact title={String(children)} />;
}

function QuickLink({ href, label, desc }: { href: string; label: string; desc: string }) {
  return <Link href={href} className="quick-command group flex items-center justify-between border-t border-[var(--line-strong)] py-4"><div><p className="text-sm font-semibold text-[var(--ink)]">{label}</p><p className="text-xs text-[var(--ink-muted)]">{desc}</p></div><span className="text-[var(--ink-faint)] transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-yellow-600">→</span></Link>;
}

/**
 * ⚠️ DEIXOU DE SER EXPORTADA EM 11/09/2026. O `export` existia
 * para as bancadas montarem esta tela com dado de amostra; elas passaram a
 * montar a tela real (`MercadoLivreWorkspace`), entao nao ha mais quem a
 * importe de fora. `Dashboard` segue exportada porque `/lab/mercado-livre`
 * ainda a usa com dado fixo — e aquela rota nao e servida em producao.
 */
function Inventory({ overview }: { overview: Overview }) {
  const critical = overview.stockRadar.filter((product) => product.status === "critical" || product.status === "out").length;
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "out" | "critical" | "ok">("all");
  const [sort, setSort] = useState<"urgency" | "stock" | "sales">("urgency");
  const [page, setPage] = useState(1);
  // A ordem de urgência também vem do módulo compartilhado — era mais uma
  // cópia local, e ela nem conhecia "sem venda".
  const urgencyRank = ORDEM_DO_RADAR;
  const rows = [...overview.stockRadar]
    .filter((product) => `${product.title || ""} ${product.sku || ""} ${product.id}`.toLowerCase().includes(query.toLowerCase()) && (statusFilter === "all" || product.status === statusFilter))
    .sort((a, b) =>
      sort === "stock"
        ? b.availableQuantity - a.availableQuantity
        : sort === "sales"
          ? b.unitsSold - a.unitsSold
          : (urgencyRank[a.status] - urgencyRank[b.status]) || ((a.daysRemaining ?? Number.POSITIVE_INFINITY) - (b.daysRemaining ?? Number.POSITIVE_INFINITY))
    );
  /* ⚠️ 15 POR PAGINA, o mesmo da tabela do Full e do contrato
     visual. Era 30 — herdado da tela antiga, quando a linha tinha 65px. Com a
     linha enxuta, 15 ja ocupam ~435px; 30 devolveriam a rolagem longa que a
     compactacao veio resolver. */
  const pageCount = Math.max(1, Math.ceil(rows.length / 15));
  const current = Math.min(page, pageCount);
  const pagedRows = rows.slice((current - 1) * 15, current * 15);
  const healthy = overview.stockRadar.filter((product) => product.status === "ok").length;
  const sold = overview.stockRadar.reduce((total, product) => total + product.unitsSold, 0);
  // Capital parado no Full: leitura própria, independente do período do radar —
  // é foto do estoque de hoje, não de um intervalo de vendas.
  const custoNoFull = useCustoNoFull();
  /**
   * ⚠️ A TELA MUDOU DE ROUPA, NAO DE FUNCAO (10/09/2026). Busca,
   * filtro de status, ordenacao, paginacao de 30, miniatura, "como calculamos"
   * e os dois blocos de custo no FULL continuam exatamente os mesmos — o que
   * mudou e a linguagem visual, que passou a ser a do dashboard novo.
   *
   * ⚠️ A TABELA USA O MECANISMO DO "Top N produtos": um grid so
   * para cabecalho e linhas (`subgrid`), colunas dimensionadas pelo conteudo
   * com piso, e `nowrap` nos numeros. Uma tabela `<table>` aqui divergiria do
   * resto da tela na primeira coluna que crescesse.
   */
  const rotuloDoStatus = (status: string) => ROTULO_DE_COBERTURA[status as StockStatus] ?? "Saudável";
  return <div className="v3 inventory-family-body">
    <section className="v3-card v3-faixa">
      <div className="v3-card-cab">
        <h2>Radar de estoque</h2>
        <span className="v3-meta">{overview.period.label}</span>
      </div>
      {/* ⚠️ O TOM SEGUE O ROTULO, e isso foi decidido contra o meu
          parecer. Eu tinha amarrado a cor ao VALOR — verde so quando ha
          saudaveis, vermelho so quando ha urgencia — com medo de "Saudaveis 0"
          com fundo verde parecer boa noticia. Ela decidiu o contrario em
          10/09/2026: *"saudaveis sao os saudaveis, cor verde e o que faz
          sentido"*.

          O argumento dela e melhor que o meu: aqui a cor identifica a NATUREZA
          da coluna, nao julga o numero — quem julga o numero e o proprio numero,
          que fica bem no meio do cartao. Fundo trocando de cor conforme o dado
          faria a faixa piscar de verde para vermelho entre um dia e outro, e
          ninguem consegue decorar uma tela que muda de mapa.

          Cartao sem natureza propria (contagem, faturamento) fica branco: cor
          que nao quer dizer nada gasta a atencao que os outros precisam. */}
      <div className="v3-colunas">
        <div className="v3-coluna">
          <p className="v3-coluna-rotulo">Produtos ativos</p>
          <strong className="v3-coluna-valor">{overview.stockRadar.length.toLocaleString("pt-BR")}</strong>
          <span className="v3-coluna-share">monitorados no radar</span>
        </div>
        <div className="v3-coluna is-tom-vermelho">
          <p className="v3-coluna-rotulo">Ação imediata</p>
          <strong className={`v3-coluna-valor${critical ? " is-negativo" : ""}`}>{critical.toLocaleString("pt-BR")}</strong>
          <span className="v3-coluna-share">{critical ? "repor com urgência" : "tudo sob controle"}</span>
        </div>
        <div className="v3-coluna is-tom-verde">
          <p className="v3-coluna-rotulo">Saudáveis</p>
          <strong className="v3-coluna-valor is-positivo">{healthy.toLocaleString("pt-BR")}</strong>
          <span className="v3-coluna-share">com cobertura</span>
        </div>
        <div className="v3-coluna">
          <p className="v3-coluna-rotulo">Unidades vendidas</p>
          <strong className="v3-coluna-valor">{sold.toLocaleString("pt-BR")}</strong>
          <span className="v3-coluna-share">{overview.period.label}</span>
        </div>
        {/* ⚠️ O VALOR NO FULL E A QUINTA COLUNA DA FAIXA, nao um
            bloco solto acima da tabela. Ele e um numero de resumo como os
            outros quatro — o que muda e so a origem (foto do estoque de hoje,
            nao do periodo selecionado), e isso a propria nota dele diz. */}
        <ResumoDoCustoNoFull leitura={custoNoFull} />
        {/* ⚠️ O PAR CUSTO/VENDA FICA LADO A LADO, nunca separado.
            Sozinho, "Valor de venda no Full" parece dinheiro no bolso; ao lado
            do custo ele vira a comparacao que interessa — quanto entrou de
            mercadoria contra quanto ela devolve. */}
        <ValorDeVendaNoFull leitura={custoNoFull} />
      </div>
    </section>

    <TabelaDoCustoNoFull leitura={custoNoFull} />

    {overview.stockRadar.length === 0 ? <Empty>Nenhum produto ativo encontrado.</Empty> : (
      <section className="v3-card" aria-labelledby="ml-inventory-results">
        <div className="v3-card-cab">
          <h2 id="ml-inventory-results">{rows.length} {rows.length === 1 ? "produto encontrado" : "produtos encontrados"}</h2>
          <span className="v3-meta">{overview.period.label}</span>
        </div>
        <p className="v3-nota">
          Cobertura = estoque atual ÷ média diária de vendas no período. Pausas e dias históricos
          sem estoque ainda não são descontados.
        </p>

        <div className="v3-filtros" role="search" aria-label="Filtros de estoque">
          <label className="v3-busca">
            <span className="sr-only">Buscar no estoque</span>
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(1); }}
              placeholder="Buscar SKU ou produto"
            />
          </label>
          <select
            value={statusFilter}
            onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); setPage(1); }}
            aria-label="Filtrar status do estoque"
          >
            <option value="all">Todos os status</option>
            <option value="out">Esgotado</option>
            <option value="critical">Repor já</option>
            <option value="low">Repor em breve</option>
            <option value="ok">Saudável</option>
            <option value="overstock">Excesso</option>
            <option value="idle">Sem venda</option>
          </select>
          <select
            value={sort}
            onChange={(event) => { setSort(event.target.value as typeof sort); setPage(1); }}
            aria-label="Ordenar estoque"
          >
            <option value="urgency">Maior urgência</option>
            <option value="stock">Maior estoque</option>
            <option value="sales">Mais vendidos</option>
          </select>
        </div>

        {rows.length === 0 ? <Empty>Nenhum produto encontrado. Limpe a busca ou troque o status.</Empty> : (
          <div className="v3-tabela v3-tabela-estoque">
            <div className="v3-estoque-cab">
              <span>Produto</span>
              <span>SKU</span>
              <span>Estoque</span>
              <span>Vendidos</span>
              <span>Cobertura</span>
              <span>Status</span>
            </div>
            {pagedRows.map((product) => (
              <div className="v3-estoque-linha" key={product.id}>
                <span className="v3-cel-nome">
                  <span className="v3-margem-titulo" title={product.title}>{product.title}</span>
                  <span className="v3-cel-sub">base: {product.calculationDays} dias</span>
                </span>
                <span className="v3-cel-pedido">{product.sku || product.id}</span>
                <span className="v3-cel-num">{product.availableQuantity.toLocaleString("pt-BR")}</span>
                <span className="v3-cel-num">{product.unitsSold.toLocaleString("pt-BR")}</span>
                {/* ⚠️ TRES ESTADOS, NAO DOIS, e eu errei este na
                    primeira versao (10/09/2026): guardei so `null` e o produto
                    ESGOTADO apareceu com "0 dias" — que le como "acaba hoje"
                    quando na verdade ja acabou.
                      • `null`  → nao da para calcular (sem venda no periodo): "—"
                      • `0`     → esgotado agora: a palavra, nao o numero
                      • n > 0   → dias de cobertura
                    E a familia `null ≠ 0` do projeto aparecendo na tela: aqui o
                    zero E um fato ("nao ha estoque"), e por isso merece palavra
                    propria em vez de virar contagem. */}
                <span className={`v3-cel-num${product.daysRemaining == null ? " is-vazio" : ""}`}>
                  {product.daysRemaining == null
                    ? "—"
                    : product.daysRemaining === 0
                      ? "esgotado"
                      : `${product.daysRemaining} dias`}
                </span>
                <span className="v3-cel-fim">
                  <em className={`v3-chip v3-cobertura is-${tomDaCobertura(product.status)}`}>
                    {rotuloDoStatus(product.status)}
                  </em>
                </span>
              </div>
            ))}
          </div>
        )}

        {pageCount > 1 && (
          <div className="v3-paginacao">
            <Pagination page={current} pageCount={pageCount} total={rows.length} pageSize={15} onPage={setPage} />
          </div>
        )}
      </section>
    )}
  </div>;
}

/**
 * Uma coluna da faixa de numeros, no contrato visual do dashboard.
 *
 * ⚠️ EXISTE PARA O MONITOR USAR A MESMA PECA DA FAIXA sem
 * perder o `CustomizableMetricGrid`, que deixa a vendedora reordenar e esconder
 * indicadores. O grid aceita a classe da grade por prop, entao da para adotar o
 * visual novo mantendo a funcao — trocar o grid inteiro por uma faixa estatica
 * teria custado essa personalizacao em silencio.
 */
/**
 * Cartao da faixa do monitor — rotulo e valor, so isso.
 *
 * ⚠️ A LEGENDA SAIU DOS CINCO CARTOES (pedido dela,
 * 10/09/2026, com print). A segunda linha de apoio quebrava em duas e
 * esticava o cartao para 126px; o contrato da faixa e 110px.
 *
 * ⚠️ O QUE ISSO CUSTA, para quem for reverter saber: a
 * legenda da "Margem" era o unico ponto DESTA tela que apontava o cadastro
 * faltando ("falta 51 unidade(s) sem custo"). O numero nao sumiu do produto —
 * "O que falta para o numero fechar", no dashboard, continua com ele e com
 * destino. Se a falta precisar voltar a aparecer aqui, ela volta como LINHA
 * PROPRIA abaixo da faixa, nunca como segunda linha dentro do cartao: foi a
 * segunda linha que quebrou a altura.
 */
function ColunaDoMonitor({ rotulo, valor, tom, nota }: {
  rotulo: string;
  valor: React.ReactNode;
  tom?: "positivo" | "negativo" | "vazio";
  /**
   * ⚠️ OPCIONAL, E EXISTE PARA UMA REGRA, nao para decorar
   * (11/09/2026). "Havendo pendencia, o numero exige sinal" e regra inegociavel
   * do AGENTS.md: numero que depende de dado faltando nao pode aparecer sozinho,
   * porque sozinho ele parece completo.
   *
   * A faixa "N SKUs sem custo — cadastrar →" (`SinaisDoResultado`) saiu desta
   * tela a pedido dela em 10/09, e o pedido foi contra o EMPILHAMENTO: aviso em
   * banda larga no topo, somado aos outros. O que nao foi pedido — nem podia
   * ser, porque e doutrina — foi deixar a Margem sem dizer o que falta. Entre 10
   * e 11/09 ela ficou: `resultParcial` era calculado aqui e nao era usado por
   * ninguem (o eslint acusava), que e a assinatura exata deste defeito.
   *
   * Aqui a falta volta no peso certo: a linha sob o numero, do mesmo tamanho e
   * na mesma classe que o dashboard usa (`v3-coluna-share`) — nao uma faixa.
   */
  nota?: React.ReactNode;
}) {
  return (
    <div className="v3-coluna">
      <p className="v3-coluna-rotulo">{rotulo}</p>
      <strong className={`v3-coluna-valor${tom ? ` is-${tom}` : ""}`}>{valor}</strong>
      {nota ? <span className="v3-coluna-share">{nota}</span> : null}
    </div>
  );
}

/**
 * ⚠️ TAMBEM DEIXOU DE SER EXPORTADO (11/09/2026) — mesmo motivo
 * do `Inventory` acima: a bancada que o importava agora monta a tela real.
 */
function Monitor({ overview, secaoInicial, periodoQuery }: { overview: Overview; secaoInicial: SecaoDoMonitor; periodoQuery: string }) {
  const profitCoverage = overview.profit.coverage;
  const netReceived = overview.profit.revenueProcessed - overview.profit.fees - overview.profit.sellerShipping;
  const { semAliquota, resultIncomplete, margemSub } = avaliarResultado(overview);
  // ⚠️ Vem por PROP, não de `window.location`: a página é prerenderizada e um
  // `useState` que lê a URL no inicializador roda no servidor, onde `window` não
  // existe — e a hidratação não o re-executa. Quem lê a URL é o
  // `useSearchParams`, dentro da fronteira de Suspense lá em cima.
  const [section, setSection] = useState<SecaoDoMonitor>(secaoInicial);
  /**
   * ⚠️ A TELA MUDOU DE ROUPA, NAO DE FUNCAO (10/09/2026). As
   * tres secoes, a personalizacao da faixa e o estado do sync continuam
   * identicos — o que mudou e a linguagem visual, que passou a ser a do
   * dashboard (contrato em `globals.css`). A base de data e os sinais sairam a
   * pedido dela; o porque esta no comentario logo abaixo.
   */
  return <div className="v3 ml-monitor-body">
    {/* ⚠️ SAIRAM DAQUI DOIS COMPONENTES ANTIGOS (pedido dela,
        10/09/2026): a linha "Valores por data do pedido…" (`BaseDeData`) e a
        faixa "N SKUs sem custo cadastrado — cadastrar →" (`SinaisDoResultado`).

        ⚠️ O QUE ISSO CUSTA, para quem for reverter saber: a base
        de data era a unica coisa que distinguia este monitor do da Amazon, onde
        o numero e por data do REPASSE, nao do pedido. Os dois canais mostram
        "Monitor da conta" e somam por criterios diferentes; sem a frase, quem
        compara os dois nao tem como saber. E o link "cadastrar →" era o unico
        atalho desta tela para o cadastro de custo.

        A falta em si nao sumiu: o cartao "Margem" da faixa continua dizendo
        "falta N unidade(s) sem custo", e "O que falta para o numero fechar" no
        dashboard mantem o numero com destino. O que se perdeu foi o atalho
        daqui e a distincao entre os dois monitores. */}
    <EstadoDoSync provider="mercado_livre" />
    {/* ⚠️ SEM CARTAO EM VOLTA, SEM META E SEM "Personalizar"
        (pedido dela, 10/09/2026). A moldura branca envolvia seis caixinhas que
        JA tem moldura propria — caixa dentro de caixa, e o vao entre as duas
        virava um blocao branco no topo da tela.

        ⚠️ E ISSO CUSTOU A PERSONALIZACAO DA FAIXA. O
        `CustomizableMetricGrid` era quem deixava reordenar e esconder
        indicadores, e o botao "Personalizar" era a porta dele; sem o botao o
        componente vira peso morto. Os cinco cartoes agora sao fixos, nesta
        ordem. Se a personalizacao voltar a ser desejada, o caminho e outro —
        um controle na barra da tela, nao um botao flutuando sobre a faixa.

        O "N de N pedidos apurados" tambem saiu: a cobertura ja aparece na nota
        do cartao "Margem" ("276 de 276 vendas"), e dizer duas vezes na mesma
        tela e repetir a mesma lista, que a regra da casa proibe. */}
    {/* ⚠️ O TITULO SAI DA CONSULTA, nao de `overview.period.label`.
        E o mesmo defeito que ja corrigimos no dashboard e que ela pegou de novo
        aqui (10/09/2026): com "15 dias" marcado no filtro, o titulo continuava
        "Ultimos 30 dias", porque o rotulo vinha de um valor separado da query.
        Derivar da string que BUSCOU os dados torna a divergencia impossivel. */}
    {/**
      * ⚠️ TITULO E FAIXA SO EXISTEM ONDE O PERIODO GOVERNA — e
      * na aba "Transacoes" ele nao governa nada. Ela pegou pela tela em
      * 10/09/2026: *"mas estao aqui ainda em transacoes"*.
      *
      * O saldo do Mercado Pago e o estado de AGORA, por decisao registrada na
      * propria rota: *"Sem `period`: saldo e o estado de AGORA. Filtrar por
      * periodo esconderia uma liberacao fora da janela e diria que nao ha nada
      * a receber."* Com o titulo "Ultimos 30 dias" e cinco cartoes do periodo
      * por cima, a tela prometia um recorte que o conteudo abaixo ignora.
      *
      * ⚠️ E NAO E SO ENFEITE FORA DE LUGAR: "Total recebido" do
      * periodo ao lado de "Ainda retido pelo Mercado Pago" convida a subtrair
      * um do outro, e os dois nao falam do mesmo conjunto de vendas. Numero
      * que nao se compara nao pode ficar lado a lado.
      *
      * O filtro de data continua na barra de cima porque ele governa as OUTRAS
      * duas abas — some-lo faria a volta para "Composicao" perder o recorte.
      */}
    {section !== "transactions" && (
      <>
      <h2 className="v3-titulo-solto">{tituloDoPeriodo(periodoQuery)}</h2>
      <div className="v3-colunas">
        <ColunaDoMonitor
          rotulo="Vendas brutas"
          valor={<AnimatedNumber periodo={identidadeDePeriodo(overview.period.from, overview.period.to)} id="ml-monitor-revenue" value={overview.metrics.revenue30d} format={(amount) => money(amount, overview.metrics.currency)} />}
        />
        <ColunaDoMonitor
          rotulo="Canceladas"
          valor={money(overview.metrics.cancelledRevenue, overview.metrics.currency)}
          tom={overview.metrics.cancelledRevenue > 0 ? "negativo" : undefined}
          /* ⚠️ A CONTAGEM VOLTOU (11/09/2026). O valor cancelado
             ficou na tela e o "em quantos pedidos" nao: R$ 1.017,58 em 28
             pedidos le diferente de R$ 1.017,58 em um. Ninguem cortou de
             proposito — `overview.metrics.cancelledOrders` sumiu das duas telas
             do canal na troca de layout, e so apareceu quando o diff de numeros
             comparou campo a campo o que cada tela lia antes e depois. */
          nota={`${overview.metrics.cancelledOrders.toLocaleString("pt-BR")} pedido(s) no período`}
        />
        <ColunaDoMonitor
          rotulo={profitCoverage.complete ? "Total recebido" : "Total recebido processado"}
          valor={money(netReceived, overview.metrics.currency)}
        />
        <ColunaDoMonitor
          rotulo={resultIncomplete ? "Resultado processado" : "Margem de contribuição"}
          valor={overview.profit.estimatedProfit == null ? "—" : money(overview.profit.estimatedProfit, overview.metrics.currency)}
          tom={overview.profit.estimatedProfit == null ? "vazio" : overview.profit.estimatedProfit > 0 ? "positivo" : overview.profit.estimatedProfit < 0 ? "negativo" : undefined}
        />
        <ColunaDoMonitor
          rotulo="Margem"
          valor={percent(overview.profit.marginPct)}
          tom={overview.profit.marginPct == null ? "vazio" : overview.profit.marginPct < 0 ? "negativo" : "positivo"}
          nota={margemSub}
        />
      </div>
      {/* ⚠️ ESTA NOTA VOLTOU (11/09/2026), e foi a UNICA das seis
          perdas que o diff de numeros achou cuja informacao sumia POR COMPLETO
          da tela. As outras cinco sobrevivem em outra forma; esta nao tinha
          outra casa.
          
          O que ela guarda e a regra de faturamento do Mercado Livre: o frete
          que o COMPRADOR paga nao entra no faturamento, e o resultado conta so
          o frete que sai do bolso dela. Sem a frase, quem bate o numero do NEXO
          contra outra ferramenta ve uma diferenca do tamanho do frete e nao tem
          como saber de onde vem — e conferir com outra ferramenta e exatamente
          o que a dona do produto faz.
          
          Entra como nota do monitor, que e onde ela morava, no peso de nota. */}
      {overview.profit.buyerShipping > 0 && (
        <p className="v3-nota">
          O comprador pagou {money(overview.profit.buyerShipping, overview.metrics.currency)} de frete no período.
          Esse valor não compõe o faturamento; o resultado considera apenas o frete efetivamente pago pelo vendedor.
        </p>
      )}
      {semAliquota && <div className="flex justify-end"><Link href={MERCADO_LIVRE_TAX_RATE_HREF} className="meli-primary-action">Cadastrar alíquota <span aria-hidden="true">→</span></Link></div>}
      </>
    )}

    {/* Mesmas três abas da Amazon, na mesma ordem. "Transações" faltava aqui: o
        extrato do Mercado Pago existia só no card do dashboard, e quem abria o
        monitor não achava onde ver quando o dinheiro cai. */}
    {/* ⚠️ MESMA PECA DAS ABAS DO "Ritmo dos ultimos 7 dias"
        (`v3-abas`), e nao um estilo proprio do monitor. Duas familias de aba no
        mesmo produto e o que faz uma tela parecer de outro app — foi por isso
        que a tela de estoque teve de ser refeita. */}
    <nav className="v3-abas" aria-label="Visões do monitor Mercado Livre">
      {/* Rentabilidade primeiro: e ela que ocupa o lugar da Composicao, e e
          onde cai quem clica em "Abrir vendas" no dashboard. */}
      {([
        ["profitability", "Rentabilidade por venda"],
        ["transactions", "Transações"],
      ] as const).map(([id, rotulo]) => (
        <button
          key={id}
          type="button"
          className={`v3-aba${section === id ? " is-ativa" : ""}`}
          aria-current={section === id ? "page" : undefined}
          onClick={() => setSection(id)}
        >
          {rotulo}
        </button>
      ))}
    </nav>

    {section === "transactions" && <MercadoLivreSaldo modo="transacoes" />}

    {/**
      * ⚠️ AQUI MORAVA "Do faturamento ao resultado" — a
      * cascata com os sinais: faturamento, menos tarifa, menos frete, igual
      * total recebido, menos custo, menos imposto, igual margem.
      *
      * ⚠️ O QUE ISSO CUSTA, para quem for reverter saber:
      * era o UNICO lugar do produto que dizia que aqueles numeros sao
      * SUBTRAIDOS uns dos outros. O dashboard mostra os mesmos valores como
      * sete cartoes lado a lado e nunca escreve a conta. Quem estiver
      * aprendendo para onde o dinheiro vai perdeu a explicacao; quem ja sabe
      * nao perdeu numero nenhum.
      *
      * Saiu porque REPETIA: de sete linhas, duas apareciam na faixa a 20px
      * daqui (Total recebido e Margem, como "Resultado processado") e quatro
      * na faixa do dashboard (tarifa, frete, custo, imposto). So
      * "Faturamento processado" era exclusivo. Medido linha a linha antes de
      * propor, e a decisao foi dela em 10/09/2026.
      *
      * Se a conta com sinais voltar a fazer falta, o lugar dela e o DASHBOARD,
      * junto dos cartoes que ja tem os mesmos numeros — nao uma terceira copia
      * numa aba.
      *
      * ⚠️ DUAS NOTAS SAIRAM JUNTO e nao tem outro dono:
      * a do frete pago pelo comprador ("nao compoe o faturamento") e a da
      * conciliacao em andamento ("Conciliando N de M vendas"). A segunda e a
      * que aponta falta com numero — se alguem sentir a ausencia, e ela.
      */}
    {section === "profitability" && <OrderProfitabilityTable lines={overview.profitabilityLines} scopeNote={fraseDeEscopo(overview.profitabilityScope)} />}
  </div>;
}
