"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatedNumber, identidadeDePeriodo } from "./AnimatedNumber";
import { EmptyState } from "./EmptyState";
import { DashboardSkeleton } from "./LoadingState";
import { PageHeader, pageIcons } from "./PageHeader";
import { RevenueChart, type DailyPoint } from "./RevenueChart";
import { FILTRO_DE_HOJE, JANELA_DE_SETE_DIAS, serieDoBlocoDeLucro } from "./serieDoLucroPorDia";
import { DashboardPeriodFilter, useDashboardPeriod } from "./DashboardPeriodFilter";
import { periodoNaUrl } from "./periodoNaUrl";
import { OrderProfitabilityTable } from "./OrderProfitabilityTable";
import { ConnectionBroken, isBrokenConnection } from "./ConnectionBroken";
import { CustomizableMetricGrid } from "./CustomizableMetricGrid";
// O mesmo dicionário do radar da Amazon: equalizar canal é usar a MESMA palavra
// para o mesmo estado, senão "Saudável" no ML e "Ok" na Amazon parecem coisas
// diferentes sendo a mesma.
import { ORDEM_DO_RADAR, ROTULO_DE_COBERTURA, type StockStatus } from "@/lib/coberturaDeEstoque";
import { LegendaDeVendas } from "./LegendaDeVendas";
import { CompactMetric, Flow, FlowExpandable, Metric, getRevenueTrend } from "./Metric";
import { buildFinancialComposition, FinancialSummaryPanel } from "./FinancialSummaryPanel";
import { tomDaFatia, type PaletaDeCategoria } from "./CompositionDonut";
import { sinaisDoResultado } from "./oQueFaltaNoResultado";
import { SinaisDoResultado } from "./SinaisDoResultado";
import { sinaisSilenciadosPorAlarme } from "./hierarquiaDeAvisos";
import { brDate, brTime } from "@/lib/datetime";
import { coberturaDoPeriodo } from "@/lib/coberturaPeriodo";
import type { ProfitabilityLine } from "@/lib/profitability";
import { MercadoLivreSaldo } from "./MercadoLivreSaldo";
import { ResumoDoCustoNoFull, TabelaDoCustoNoFull, useCustoNoFull } from "./MercadoLivreCustoNoFull";
import { Pagination } from "./Pagination";
import { TopProductsRanking } from "./TopProductsRanking";
import { BriefingLead } from "./BriefingLead";
import { NexoDoDia } from "./NexoDoDia";
import { CockpitDoResultado, LinhaDePendencias, LucroPorDia } from "./CockpitDoResultado";
import { TopProdutosNaFaixa } from "./TopProdutosNaFaixa";
import { IntegrationDashboardFrame } from "./IntegrationDashboardFrame";

/**
 * ⚠️ A PALETA APROVADA PELA ANA EM 03/09/2026, e ela é DO MERCADO LIVRE.
 *
 * Vermelho decrescente para o que consome a venda — quanto mais escuro, mais
 * pesado — e o verde da marca do ML para o que sobra. A dona aprovou olhando a
 * prancheta "Lucro no tempo": *"Boa. Upa a opção 3 pro sistema."*
 *
 * ⚠️ POR QUE HEX AQUI E NÃO UM TOKEN GLOBAL: `--positive` é o verde de TODOS os
 * canais. Trocá-lo pintaria Amazon, Shopee e TikTok de verde-ML sem ninguém
 * pedir, e a ordem foi explícita: o redesenho é um teste num canal só. Este
 * dicionário é o único lugar que conhece estes valores, e ele é passado ao mapa
 * de cor compartilhado em vez de duplicá-lo.
 *
 * As chaves são os `id` que `buildFinancialComposition` emite — não os rótulos,
 * que mudam de texto quando o período está parcial.
 */
/**
 * `YYYY-MM-DD` -> `DD/MM`. A string só é reordenada: passá-la por `new Date`
 * a leria como meia-noite UTC e devolveria o dia anterior em São Paulo.
 */
const diaBrasileiro = (data: string) => data.slice(5).split("-").reverse().join("/");

const PALETA_DO_ML: PaletaDeCategoria = {
  cogs: "#FF0000",
  shipping: "#FF4D4D",
  fees: "#FF8585",
  taxes: "#FFC2C2",
  result: "#337129",
};
import { marginMetricTone } from "@/lib/marginTone";
import { BASE_SEM_DIFERENCA, declaracaoDeBase } from "./baseDaMargem";
import { comSemImposto } from "@/lib/semImposto";
import { BaseDeData, ProgressoDaImportacao } from "./BaseDeData";
import { EstadoDoSync } from "./EstadoDoSync";
import { AnunciosPorProduto, type AnuncioDeProduto } from "./AnunciosPorProduto";
import { usePrefetchDePeriodos } from "./prefetchDePeriodos";

const MERCADO_LIVRE_TAX_RATE_HREF = "/mercado-livre/produtos#mercado-livre-aliquota";

/** As três abas do monitor — as mesmas da Amazon. */
type SecaoDoMonitor = "composition" | "transactions" | "profitability";

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
function useJanelaDeSeteDias(view: string, periodoAtual: string, connectionId: string | null) {
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
    if (periodoAtual !== FILTRO_DE_HOJE) return;
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
  }, [chave, connectionId, periodoAtual, view]);

  return useMemo(
    () => (periodoAtual === FILTRO_DE_HOJE ? periodCache.get(chave)?.overview.dailySales ?? null : null),
    // ⚠️ `buscasConcluidas` É DEPENDÊNCIA DE PROPÓSITO, e o lint reclama
    // com razão pela regra dele: o contador não aparece no corpo. Ele existe
    // porque `periodCache` é um Map mutável fora do React — ninguém avisa que a
    // chave foi gravada. O contador é esse aviso. Tirá-lo faria a leitura
    // congelar em `null` para quem abre a página já no filtro Hoje.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chave, periodoAtual, buscasConcluidas],
  );
}

const views = {
  dashboard: { eyebrow: "Operação Mercado Livre", title: "Dashboard Mercado Livre", subtitle: "Faturamento, pedidos e anúncios da sua conta do Mercado Livre Brasil.", icon: pageIcons.dashboard },
  monitor: { eyebrow: "Pedidos e financeiro Mercado Livre", title: "Monitor da conta", subtitle: "Pedidos recentes e o resultado financeiro real da sua conta.", icon: pageIcons.chart },
  estoque: { eyebrow: "Operação Mercado Livre", title: "Radar de estoque", subtitle: "Cobertura dos anúncios ativos com base no estoque e no ritmo de vendas do período.", icon: pageIcons.box },
} as const;

/**
 * Linha de imposto do detalhamento. Sem alíquota configurada o valor é
 * DESCONHECIDO, não zero: "Impostos (0%) R$ 0,00" afirmava isenção para quem
 * simplesmente ainda não tinha informado o percentual. Mesma regra da Amazon,
 * da Shopee e do TikTok.
 */
function rotuloImposto(taxRate: number | null, taxes: number | null, currency: string): { label: string; value: string } {
  if (taxRate == null || taxes == null) {
    return { label: "Impostos", value: "Alíquota não configurada" };
  }
  return {
    label: `Impostos (${taxRate.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%)`,
    value: money(taxes, currency),
  };
}

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

function orderStatus(status: string) {
  const labels: Record<string, string> = { paid: "Pago", confirmed: "Confirmado", payment_required: "Aguardando pagamento", cancelled: "Cancelado" };
  return labels[status] || status.replaceAll("_", " ");
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
    bruta === "vendas" || bruta === "profitability" ? "profitability" : bruta === "transacoes" || bruta === "transactions" ? "transactions" : "composition";
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
  const serieDeSeteDias = useJanelaDeSeteDias(view, period.query, connectionId);
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
      ) : view === "dashboard" ? <Dashboard overview={overview} syncStatus={syncStatus} periodoLabel={period.label} periodoQuery={period.query} connectionId={connectionId} conexaoCaida={Boolean(brokenConnection)} serieDeSeteDias={serieDeSeteDias} /> : view === "estoque" ? <Inventory overview={overview} /> : <Monitor overview={overview} secaoInicial={secaoInicial} />}
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

function Dashboard({ overview, syncStatus, periodoLabel, periodoQuery, connectionId, conexaoCaida, serieDeSeteDias }: { overview: Overview; syncStatus: SyncStatus | null; periodoLabel: string; periodoQuery: string; conexaoCaida: boolean; connectionId: string | null; serieDeSeteDias: DailyPoint[] | null }) {
  const [costsOpen, setCostsOpen] = useState(false);
  const profitCoverage = overview.profit.coverage;
  const units = overview.dailySales.reduce((total, point) => total + point.units, 0);
  const critical = overview.stockRadar.filter((product) => product.status === "critical" || product.status === "out");
  const { semAliquota, resultParcial, resultIncomplete, margemSub } = avaliarResultado(overview);
  /**
   * ⚠️ A MESMA LISTA DE SEMPRE, so extraida para ter nome. Nenhuma
   * condicao mudou: aliquota ausente, produtos sem custo, pedidos cancelados e
   * estoque critico, na mesma ordem e com os mesmos textos e destinos.
   */

  /**
   * ⚠️ UM CALCULO, DOIS CONSUMIDORES (03/09/2026). A rosquinha subiu para
   * a faixa do topo e o painel de baixo continua listando as mesmas parcelas —
   * se cada um montasse a sua, bastaria alguem editar um lado para a tela
   * mostrar duas composicoes diferentes do mesmo periodo, sem nada ficar
   * vermelho. E o defeito de "dois consumidores, dois universos" que este
   * projeto ja pagou caro.
   */
  const composicaoDoResultado = buildFinancialComposition({
          total: overview.profit.revenueProcessed,
          costs: [
            { id: "fees", label: "Taxas do Mercado Livre", value: overview.profit.fees },
            { id: "shipping", label: "Frete do vendedor", value: overview.profit.sellerShipping },
            { id: "cogs", label: "Custo dos produtos", value: overview.profit.cogs },
            { id: "taxes", label: "Impostos", value: overview.profit.taxes },
          ],
          result: resultIncomplete ? null : overview.profit.estimatedProfit,
        });

  /**
   * ⚠️ A COR DA CASCATA VEM DA MESMA FATIA DA ROSQUINHA — pela
   * CATEGORIA, nao pela posicao na barra.
   *
   * As duas listas tem ordens diferentes de proposito (a barra segue a leitura
   * da prancheta; a rosquinha ordena por tamanho), entao usar o indice de cada
   * uma daria cores diferentes para a mesma categoria. Procurar a fatia pelo
   * `id` garante que "Taxas" e a mesma tinta nos dois lugares.
   *
   * Categoria que a rosquinha nao tem (porque o valor e nulo ou zero) cai no
   * tom mais leve: ela nao aparece na barra tambem, entao a cor nunca chega a
   * ser usada — mas a funcao nao pode devolver `undefined` no caminho.
   */
  const corDaCategoria = (id: string) => {
    const indice = composicaoDoResultado.findIndex((fatia) => fatia.id === id);
    return (indice < 0 ? null : tomDaFatia(indice, composicaoDoResultado[indice], PALETA_DO_ML)) ?? "var(--ink-12)";
  };

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
   * ⚠️ A FONTE DO BLOCO, e é aqui que a correção de 03/09/2026 mora.
   *
   * Com o filtro "Hoje", `overview.dailySales` tem UM ponto — e uma coluna
   * sozinha ocupa a régua inteira, com o título prometendo sete. Nesse caso a
   * série vem da janela de sete dias, a MESMA que o filtro "7 dias" exibe.
   *
   * Nos outros filtros nada muda: `serieDeSeteDias` é `null` e o bloco segue o
   * período, como sempre seguiu.
   *
   * Enquanto a janela não chegou, a lista fica vazia e o bloco não se desenha —
   * melhor não existir por um instante do que aparecer com uma coluna e o
   * título de sete.
   */
  const serieDoBloco = serieDoBlocoDeLucro({
    filtro: periodoQuery,
    serieDoPeriodo: overview.dailySales,
    janelaDeSeteDias: serieDeSeteDias,
  });
  const seteDiasDeLucro = serieDoBloco.map((ponto) => {
    const lucro = ponto.profit ?? null;
    const ehHoje = ponto.date === hojeNoBrasil;
    return {
      data: ponto.date,
      rotulo: ehHoje ? "hoje" : diaDaSemana(ponto.date),
      valor: lucro,
      // O rótulo em cima da coluna é curto porque a coluna é estreita: só a
      // parte inteira, sem símbolo. O valor por extenso vai no nome acessível.
      compacto: lucro == null ? "—" : Math.round(lucro).toLocaleString("pt-BR"),
      completo: lucro == null
        ? `${diaBrasileiro(ponto.date)}: lucro ainda desconhecido`
        : `${diaBrasileiro(ponto.date)}: ${money(lucro, overview.metrics.currency)}`,
      destaque: ponto.date === serieDoBloco[serieDoBloco.length - 1]?.date,
    };
  });

  const pendenciasDoCanal = [
    ...(semAliquota
      ? [{ label: "Cadastrar alíquota", href: MERCADO_LIVRE_TAX_RATE_HREF, tone: "pendencia" as const }]
      : []),
    ...(overview.metrics.productsWithoutCost > 0
      ? [{ label: `Cadastrar custo de ${overview.metrics.productsWithoutCost} produto(s)`, href: "/mercado-livre/produtos", tone: "pendencia" as const }]
      : []),
    ...(overview.metrics.cancelledOrders > 0
      ? [{ label: `${overview.metrics.cancelledOrders} pedido(s) cancelado(s) no período`, href: "/mercado-livre/monitor", tone: "alerta" as const }]
      : []),
    ...(critical.length > 0
      ? [{ label: `${critical.length} produto(s) em estoque crítico`, href: "/mercado-livre/estoque", tone: "alerta" as const }]
      : []),
  ];

  // ⚠️ 30/08/2026 — custo faltando virou SINAL, nao trava (decisao da vendedora).
  // O numero aparece sempre; `sinais` anda colado nele.
  const sinais = sinaisDoResultado({
    skusWithoutCost: overview.profit.skusWithoutCost,
    ordersProcessed: profitCoverage.processedOrders,
    paidOrders: profitCoverage.paidOrders,
    hrefDeCustos: "/mercado-livre/produtos",
  });
  const netReceived = overview.profit.revenueProcessed - overview.profit.fees - overview.profit.sellerShipping;
  const ticket = overview.metrics.paidOrders > 0 ? overview.metrics.approvedRevenue / overview.metrics.paidOrders : null;
  const roi = overview.profit.cogs > 0 && !resultParcial && overview.profit.estimatedProfit != null ? (overview.profit.estimatedProfit / overview.profit.cogs) * 100 : null;
  const knownCosts = overview.profit.fees + overview.profit.sellerShipping + overview.profit.cogs + (overview.profit.taxes ?? 0);
  // O painel de composicao fala do universo da RECEITA PAGA, e o resultado dele
  // e o residuo do proprio bloco — nunca o lucro do periodo, que vive nos cards
  // e parte do faturamento. Os dois caminhos do ML (canonico e legado) expoem a
  // composicao desde 02/09/2026.
  //
  // ⚠️ SEM COMPOSICAO, O PAINEL NAO INVENTA UM NUMERO. A tentacao era
  // `revenueProcessed - knownCosts`, e ela seria a propria doenca de volta:
  // `taxes` no caminho canonico incide sobre o FATURAMENTO, entao a subtracao
  // cobriria um universo maior que o centro. Ausencia se mostra como ausencia.
  const composicaoDoPainel = overview.profit.composicaoDaReceitaPaga ?? null;
  const resultadoDoPainel = composicaoDoPainel ? composicaoDoPainel.lucro : null;
  const margemDoPainel = composicaoDoPainel ? composicaoDoPainel.margemPct : null;
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
    {/* Mesma abertura dos outros três canais: a frase vem do dado e as
        pendências ficam com ela. Ver `BriefingLead.tsx` — a peça é
        compartilhada de propósito, para os quatro painéis não divergirem. */}
    <BriefingLead
      periodo={periodoLabel}
      janela={periodoQuery}
      faturamento={overview.metrics.revenue30d}
      pedidos={overview.metrics.paidOrders}
      // `resultIncomplete` é a resposta honesta: enquanto falta custo, tarifa
      // ou imposto, o lucro é DESCONHECIDO — passar o parcial como se fosse o
      // resultado é a confusão que `null ≠ 0` existe para evitar.
      lucro={resultIncomplete ? null : overview.profit.estimatedProfit}
      format={(v) => money(v, overview.metrics.currency)}
      escopo="mercado_livre"
      canalNome="Mercado Livre"
      moeda={overview.metrics.currency}
      briefingHref="/mercado-livre/monitor"
      briefingLabel="Ver detalhes"
      // ⚠️ AS PENDENCIAS SAIRAM DAQUI E VIRARAM UMA LINHA DE CHIPS
      // (03/09/2026, redesenho aprovado). A LISTA E A MESMA — os textos, os
      // links e as condicoes vem de `pendenciasDoCanal`, logo abaixo, e sao
      // exatamente os que estavam aqui. O que mudou foi a FORMA: cartoes
      // empilhados a direita viraram chips em fila.
      //
      // ⚠️ E o `acoes` continua existindo no `BriefingLead`, que e
      // compartilhado pelos quatro canais: Amazon, Shopee e TikTok seguem
      // passando o deles e renderizando igual. So o ML deixa de passar.
      acoes={[]}
    />



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
    {/* Faturamento do ML conta aprovadas + canceladas, sem frete (regra do
        proprio canal) — e sempre pela data do pedido. */}
    <BaseDeData base="pedido" />
    {/* ⚠️ A FAIXA DO RESULTADO — redesenho aprovado em 03/09/2026,
        direcao "Cockpit". A restricao da dona foi literal: *"sem alteracao
        nenhuma que nao seja o design"*.

        TODO NUMERO AQUI JA ERA EXIBIDO NESTA TELA: o lucro e a margem sao os
        mesmos do cartao de Lucro, as parcelas sao as mesmas do painel de
        composicao, e a contagem de vendas e a mesma do cartao de Pedidos. Nada
        e recalculado, nada e buscado a mais — o `CockpitDoResultado` recebe
        pronto e so decide tamanho, ordem e proporcao.

        ⚠️ A cascata OMITE parcela desconhecida em vez de desenha-la como
        zero. Barra que soma o que ninguem sabe mente com a autoridade de um
        desenho — e o `null != 0` vale para a proporcao como vale para o
        numero. */}
    <CockpitDoResultado
      titulo={`Resultado — ${periodoLabel}`}
      // ⚠️ A REGRA E A MESMA DO CARTAO DE HOJE, LITERAL — e a primeira
      // versao desta faixa NAO era (03/09/2026).
      //
      // Eu tinha posto `resultIncomplete` como porta: com custo, tarifa ou
      // imposto faltando, o numero grande sairia "—". O CARTAO DA PAGINA NAO FAZ
      // ISSO: ele mostra o numero sempre que `estimatedProfit != null`, e quando
      // o resultado e parcial ele muda o ROTULO para "Resultado processado" em
      // vez de esconder o valor.
      //
      // Um gate novo aqui seria mudanca de COMPORTAMENTO, e a ordem da dona foi
      // "sem alteracao nenhuma que nao seja o design": mesmo payload, mesmos
      // numeros que hoje, so em nova posicao. Entao a faixa replica a regra
      // existente — inclusive a troca de rotulo, para nao chamar de LUCRO o que
      // a pagina chama de resultado processado.
      lucro={overview.profit.estimatedProfit}
      lucroFormatado={overview.profit.estimatedProfit == null
        ? "—"
        : money(overview.profit.estimatedProfit, overview.metrics.currency)}
      frase={overview.profit.estimatedProfit == null ? margemSub : (
        <>
          de {resultParcial ? "resultado processado" : "lucro"} em <strong>{overview.metrics.paidOrders} venda(s)</strong>
          {overview.profit.marginPct == null ? null : (
            <> · margem <strong>{overview.profit.marginPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</strong></>
          )}
        </>
      )}
      parcelas={[
        { id: "fees", rotulo: `Taxas ${money(overview.profit.fees ?? 0, overview.metrics.currency)}`, valor: overview.profit.fees, cor: corDaCategoria("fees") },
        { id: "cogs", rotulo: `Custo ${money(overview.profit.cogs ?? 0, overview.metrics.currency)}`, valor: overview.profit.cogs, cor: corDaCategoria("cogs") },
        { id: "shipping", rotulo: `Frete ${money(overview.profit.sellerShipping ?? 0, overview.metrics.currency)}`, valor: overview.profit.sellerShipping, cor: corDaCategoria("shipping") },
        { id: "taxes", rotulo: `Impostos ${money(overview.profit.taxes ?? 0, overview.metrics.currency)}`, valor: overview.profit.taxes, cor: corDaCategoria("taxes") },
        { id: "lucro", rotulo: `${resultParcial ? "Resultado" : "Lucro"} ${overview.profit.estimatedProfit == null ? "—" : money(overview.profit.estimatedProfit, overview.metrics.currency)}`, valor: overview.profit.estimatedProfit, cor: corDaCategoria("result") },
      ]}
      aoLado={
        /* ⚠️ O TOP PRODUTOS NO LUGAR DA CONTA ESCRITA (06/09/2026). O
           motivo e dela, e estava certo: *"Quero tirar essa tela de Repasses,
           taxas e lucro, porque a tela da esquerda ja mostra literalmente
           isso."* A cascata e a legenda a esquerda listam as MESMAS quatro
           parcelas e o MESMO lucro — a conta escrita era a segunda leitura do
           mesmo numero ocupando a outra metade da faixa.

           ⚠️ A LISTA E A MESMA `overview.topProducts` que o bloco
           "Desempenho do periodo" consome mais abaixo, na ordem que o produtor
           ja emitiu. Um calculo, dois consumidores: ordenar ou cortar aqui
           criaria dois rankings do mesmo periodo na mesma pagina, e o dia em
           que discordassem ninguem veria nada vermelho. */
        <TopProdutosNaFaixa
          titulo={`Top produtos — ${periodoLabel}`}
          href="/mercado-livre/produtos"
          vazio="Sem vendas no período para ranquear."
          produtos={overview.topProducts.map((produto) => ({
            id: produto.id,
            titulo: produto.title,
            unidades: `${produto.units.toLocaleString("pt-BR")} un.`,
            faturamento: money(produto.revenue, overview.metrics.currency),
            marginPct: produto.marginPct,
          }))}
        />
      }
      abaixoDaLegenda={
        /* ⚠️ DEBAIXO DA LEGENDA, dentro da faixa — é onde a prancheta
           aprovada o pôs, ocupando o branco que sobrava à esquerda. Fora da
           faixa ele viraria mais um cartão, e a leitura "quanto sobrou hoje ->
           foi um dia bom?" se quebraria no meio. */
        <LucroPorDia titulo="Lucro por dia — últimos 7" dias={seteDiasDeLucro} />
      }
    />

    <LinhaDePendencias itens={pendenciasDoCanal} />

    <section className="metric-grid ml-dashboard-metric-grid" aria-label="Resumo financeiro Mercado Livre">
      <Metric label="Faturamento" value={<AnimatedNumber periodo={identidadeDePeriodo(overview.period.from, overview.period.to)} id="ml-dash-revenue" value={overview.metrics.revenue30d} format={(amount) => money(amount, overview.metrics.currency)} />} sub={`${overview.metrics.paidOrders} aprovadas + ${overview.metrics.cancelledOrders} canceladas`} trend={getRevenueTrend(overview.dailySales)} />
      <Metric label="Taxas" value={money(overview.profit.fees, overview.metrics.currency)} sub={`${profitCoverage.processedOrders} venda(s) processada(s)`} />
      <Metric label="Custo dos produtos" value={money(overview.profit.cogs, overview.metrics.currency)} sub={overview.profit.unitsWithoutCost > 0 ? `${overview.profit.unitsWithoutCost} unidade(s) sem custo` : "custos cadastrados"} tone={overview.profit.unitsWithoutCost > 0 ? "warn" : "default"} />
      <Metric label={overview.profit.estimatedProfit == null ? "Resultado processado" : resultParcial ? "Resultado processado" : "Lucro estimado"} value={overview.profit.estimatedProfit == null ? "—" : <AnimatedNumber periodo={identidadeDePeriodo(overview.period.from, overview.period.to)} id="ml-dash-profit" value={overview.profit.estimatedProfit} format={(amount) => money(amount, overview.metrics.currency)} />} sub={comSemImposto("após todos os custos", semAliquota)} tone={overview.profit.estimatedProfit == null ? "default" : overview.profit.estimatedProfit > 0 ? "positive" : overview.profit.estimatedProfit < 0 ? "danger" : "default"} />
      <Metric label="Margem" value={percent(overview.profit.marginPct)} sub={margemSub} tone={marginMetricTone(overview.profit.marginPct)} />
    </section>
      {/*
        ⚠️ OS SINAIS APARECEM UMA VEZ POR TELA — corte 1 da auditoria de
        empilhamento (01/09/2026).

        A MESMA lista era passada para tres cartoes desta faixa, e como ela tem
        ate 3 sinais, a tela mostrava ate 9 marcas dizendo TRES coisas. Nao era
        excesso de informacao: era a mesma informacao repetida, e repeticao
        ensina a varrer a faixa sem ler nenhuma.

        Nada sumiu — os tres sinais continuam aqui, uma vez cada, com numero e
        link. O que saiu foi a repeticao, e os cartoes voltaram a mostrar o sub
        deles, que e a declaracao de base: informacao que a repeticao escondia.

        ⚠️ CORTE 2: CONEXAO CAIDA CALA OS SINAIS. Sem dado, "3 SKUs sem custo
        cadastrado" nao e o problema dela — cadastrar o custo nao traz o numero
        de volta, reconectar traz. Os sinais voltam inteiros quando a conexao
        volta, porque a condicao e o ESTADO da conexao.
      */}
      {!sinaisSilenciadosPorAlarme(conexaoCaida) && sinais.length > 0 && <SinaisDoResultado sinais={sinais} />}

    {/* ⚠️ A ORDEM AQUI E A DA PRANCHETA, e ela foi reprovada uma vez
        por nao ser (03/09/2026). Palavra dela: *"Eu pedi pra voce fazer
        exatamente como me apresentou na direcao A"*.

        A sequencia aprovada e: faixa do resultado -> chips de pendencia ->
        regua de cards -> TOP PRODUTOS + RENTABILIDADE lado a lado. O grafico de
        evolucao e o painel de composicao vinham DEPOIS na prancheta, e no ar
        estavam antes — a leitura chegava ao grafico antes de chegar ao produto.

        ⚠️ E ELES DESCERAM, NAO SAIRAM. A prancheta era um viewport, nao a
        pagina inteira; remover funcao porque ela nao cabia no recorte seria
        passar de "so design" para "tirei uma peca". Se a dona quiser tira-los,
        ela manda e ai saem. */}
    <div className="ml-cockpit-duas-colunas">
      <div>
        {overview.topProducts.length === 0 ? <Empty>Sem vendas no período para ranquear.</Empty> : <TopProductsRanking products={overview.topProducts.map((product) => ({ sku: product.sku || product.id, title: product.title, units: product.units, revenue: product.revenue, marginPct: product.marginPct }))} currency={overview.metrics.currency} productsHref="/mercado-livre/produtos" />}
      </div>
      <div>
        <OrderProfitabilityTable lines={overview.profitabilityLines} scopeNote={fraseDeEscopo(overview.profitabilityScope)} />
      </div>
    </div>


    <section className="secondary-metrics" aria-label="Indicadores operacionais Mercado Livre">
      <CompactMetric label="Vendas" value={overview.metrics.paidOrders.toLocaleString("pt-BR")} />
      <CompactMetric label="Unidades" value={units.toLocaleString("pt-BR")} />
      <CompactMetric label="Ticket médio" value={ticket == null ? "—" : money(ticket, overview.metrics.currency)} />
      <CompactMetric label="ROI" value={roi == null ? "—" : `${roi.toFixed(1)}%`} tone={roi == null ? "default" : roi > 0 ? "positive" : roi < 0 ? "danger" : "default"} />
      <CompactMetric label="Canceladas" value={`${money(overview.metrics.cancelledRevenue, overview.metrics.currency)} · ${overview.metrics.cancelledOrders}`} tone={overview.metrics.cancelledOrders > 0 ? "danger" : "default"} />
      <CompactMetric label="Total recebido" value={money(netReceived, overview.metrics.currency)} />
    </section>

    <section className="performance-panel">
      <div className="performance-chart">
        <div className="mb-2 flex items-baseline justify-between gap-4">
          <div><p className="section-kicker">Desempenho diário</p><h2 className="mt-1 text-lg font-semibold text-[var(--ink)]">Evolução do faturamento</h2></div>
          <span className="text-sm font-semibold tabular-nums text-[var(--ink)]">{money(overview.metrics.revenue30d, overview.metrics.currency)} <span className="font-normal text-[var(--ink-muted)]">no período</span></span>
        </div>
        {/* Mesma legenda da Amazon, mesmo componente. O que é do ML é só a nota:
            aqui o dinheiro só entra quando o comprador paga, e o repasse do
            Mercado Pago tem data própria de liberação. */}
        <LegendaDeVendas
          confirmados={{ pedidos: overview.metrics.paidOrders, valor: overview.metrics.approvedRevenue }}
          aguardando={{ pedidos: overview.metrics.pendingOrders, valor: overview.metrics.pendingRevenue }}
          cancelados={{ pedidos: overview.metrics.cancelledOrders }}
          nota="O Mercado Livre só confirma a venda quando o pagamento é aprovado; o repasse tem data própria de liberação."
          money={(valor) => money(valor, overview.metrics.currency)}
        />
        <RevenueChart points={overview.dailySales} currency={overview.metrics.currency} explorable />
      </div>
      <FinancialSummaryPanel
        semDonut
        complete={!resultIncomplete}
        labelledBy="meli-financial-summary-title"
        description={profitCoverage.complete ? "Valores efetivamente identificados no período." : `Detalhamento processado em ${profitCoverage.processedOrders} de ${profitCoverage.paidOrders} vendas.`}
        total={overview.profit.revenueProcessed}
        totalLabel="Receita processada"
        format={(value) => money(value, overview.metrics.currency)}
        slices={composicaoDoResultado}
        footer={(
          <>
            <Link href="/mercado-livre/monitor" className="meli-financial-link">Ver composição completa no monitor <span aria-hidden="true">→</span></Link>
            <Link href="/mercado-livre/produtos" className="meli-financial-link">Configurar custos e imposto <span aria-hidden="true">→</span></Link>
            {semAliquota && <p className="text-xs leading-relaxed text-amber-700">A alíquota de imposto ainda não está cadastrada. <Link href={MERCADO_LIVRE_TAX_RATE_HREF} className="meli-financial-link">Cadastrar alíquota <span aria-hidden="true">→</span></Link></p>}
            {overview.profit.unitsWithoutCost > 0 && <p className="text-xs leading-relaxed text-amber-700">{overview.profit.unitsWithoutCost} unidade(s) vendida(s) ainda estão sem custo cadastrado.</p>}
            {!profitCoverage.complete && <p className="text-xs leading-relaxed text-amber-700">O NEXO mostra somente os valores já capturados e não extrapola o lucro enquanto o histórico, as tarifas e os fretes não estiverem completos.</p>}
          </>
        )}
      >
          <Flow label={profitCoverage.complete ? "Receita paga" : "Receita processada"} value={money(overview.profit.revenueProcessed, overview.metrics.currency)} />
          <FlowExpandable
            label="Custos do canal e do produto"
            value={resultIncomplete ? "—" : money(knownCosts, overview.metrics.currency)}
            open={costsOpen}
            onToggle={() => setCostsOpen((open) => !open)}
            items={[
              { label: "Tarifa de venda", value: money(overview.profit.fees, overview.metrics.currency) },
              { label: "Frete pago pelo vendedor", value: money(overview.profit.sellerShipping, overview.metrics.currency) },
              { label: "Custo dos produtos", value: money(overview.profit.cogs, overview.metrics.currency) },
              rotuloImposto(overview.profit.taxRate, overview.profit.taxes, overview.metrics.currency),
            ]}
          />
          {/* ⚠️ NOME PROPRIO PARA NUMERO DE OUTRO UNIVERSO — [ADR-028].
              O centro deste painel e a receita PROCESSADA; o "Lucro estimado"
              dos cards e do periodo inteiro, calculado sobre o faturamento.
              Exibir um dentro do outro foi o que produziu margem de 5673% no
              painel da Amazon. Aqui o resultado e o residuo DESTE bloco e se
              chama pelo que e — os dois numeros continuam existindo, e e o nome
              que impede a confusao. */}
          <Flow label={resultIncomplete ? "Resultado indisponível" : comSemImposto("Resultado da receita paga", semAliquota)} value={resultIncomplete || resultadoDoPainel == null ? "—" : money(resultadoDoPainel, overview.metrics.currency)} sign="=" accent tone={resultIncomplete || resultadoDoPainel == null ? "default" : resultadoDoPainel > 0 ? "positive" : resultadoDoPainel < 0 ? "danger" : "default"} />
          <Flow
            label={comSemImposto("Margem", semAliquota)}
            value={resultIncomplete ? "—" : percent(margemDoPainel)}
            accent
            tone={resultIncomplete ? "default" : marginMetricTone(margemDoPainel)}
          />
      </FinancialSummaryPanel>
    </section>


    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
      <Panel title="Estoque crítico" href="/mercado-livre/estoque" linkLabel="Ver radar">
        {critical.length === 0 ? <Empty>Nenhum produto em ruptura iminente.</Empty> : <ul className="divide-y divide-[var(--line)]">{critical.slice(0, 6).map((product) => <li key={product.id} className="flex items-center justify-between py-2.5 text-sm"><span className="min-w-0 truncate pr-3">{product.title || product.sku || product.id}</span><span className="shrink-0 font-semibold text-red-600">{product.status === "out" ? "esgotado" : `${product.daysRemaining} dias`}</span></li>)}</ul>}
      </Panel>
      <Panel title="Pedidos recentes" href="/mercado-livre/monitor?secao=vendas" linkLabel="Ver todos os pedidos">
        {overview.recentOrders.length === 0 ? <Empty>Nenhum pedido no período.</Empty> : <ul className="divide-y divide-[var(--line)]">{overview.recentOrders.slice(0, 6).map((order) => <li key={order.id} className="flex items-center justify-between py-2.5 text-sm"><span className="min-w-0"><span className="block truncate font-mono text-xs text-[var(--ink-muted)]">#{order.id}</span><span className="text-xs text-[var(--ink-muted)]">{brDate(order.createdAt)} · {orderStatus(order.status)}</span></span><span className="shrink-0 font-medium tabular-nums">{money(order.total, order.currency)}</span></li>)}</ul>}
      </Panel>
    </div>

    {/* Mesma posição do bloco da Amazon: logo depois da conversa sobre dinheiro,
        respondendo o que o lucro sozinho deixa no ar — "então cadê?". */}
    <MercadoLivreSaldo />

    {/* Product Ads contra a margem real — mesmo painel da Amazon, parametrizado.
        Só aparece quando há anúncio coletado: conta que não anuncia não ganha
        seção vazia. Os três estados de vazio moram dentro do componente. */}
    {(overview.adsPorProduto?.length ?? 0) > 0 && (
      <AnunciosPorProduto
        linhas={overview.adsPorProduto ?? []}
        canal="Mercado Livre"
        baseDeProdutos="/mercado-livre/produtos"
      />
    )}

    {/* ⚠️ DUAS COLUNAS — item 5 do redesenho aprovado (03/09/2026).

        O ranking e a rentabilidade respondem a mesma pergunta por angulos
        diferentes ("o que vendeu" e "o que sobrou por venda"), e empilhados
        obrigavam a rolar de um para o outro. Lado a lado, a comparacao e de
        relance.

        ⚠️ O GRID E DAQUI, DO CORPO DA PAGINA DO ML — as duas pecas nao
        mudaram. Elas recebem exatamente os mesmos dados de antes, e a tabela de
        rentabilidade e compartilhada com os outros canais, que continuam com ela
        em largura inteira. */}
    {/* No desktop a sidebar já cobre estes atalhos; no mobile a nav é scroll
        horizontal e os cartões ajudam. */}
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:hidden">
      <QuickLink href="/mercado-livre/monitor" label="Monitor" desc="Pedidos e financeiro" />
      <QuickLink href="/mercado-livre/estoque" label="Radar" desc="Estoque × velocidade" />
      <QuickLink href="/mercado-livre/anuncios" label="Anúncios" desc="Catálogo publicado" />
      <QuickLink href="/mercado-livre/produtos" label="Produtos" desc="Custos e impostos" />
    </div>
  </div>;
}


function Panel({ title, href, linkLabel, children }: { title: string; href: string; linkLabel: string; children: React.ReactNode }) {
  return <div className="work-panel border-t border-[var(--line-strong)] py-5"><div className="mb-3 flex items-center justify-between border-b border-[var(--line)] pb-3"><h2 className="text-[13px] font-semibold text-[var(--ink-soft)]">{title}</h2><Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--acao)] hover:gap-1.5 hover:opacity-80">{linkLabel}<span aria-hidden="true">→</span></Link></div>{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <EmptyState compact title={String(children)} />;
}

function QuickLink({ href, label, desc }: { href: string; label: string; desc: string }) {
  return <Link href={href} className="quick-command group flex items-center justify-between border-t border-[var(--line-strong)] py-4"><div><p className="text-sm font-semibold text-[var(--ink)]">{label}</p><p className="text-xs text-[var(--ink-muted)]">{desc}</p></div><span className="text-[var(--ink-faint)] transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-yellow-600">→</span></Link>;
}

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
  const pageCount = Math.max(1, Math.ceil(rows.length / 30));
  const current = Math.min(page, pageCount);
  const pagedRows = rows.slice((current - 1) * 30, current * 30);
  const healthy = overview.stockRadar.filter((product) => product.status === "ok").length;
  const sold = overview.stockRadar.reduce((total, product) => total + product.unitsSold, 0);
  // Capital parado no Full: leitura própria, independente do período do radar —
  // é foto do estoque de hoje, não de um intervalo de vendas.
  const custoNoFull = useCustoNoFull();
  return <div className="inventory-family-body">
    <section className="listing-summary-band is-5" aria-label="Resumo de estoque Mercado Livre">
      <div><span>Produtos ativos</span><strong>{overview.stockRadar.length.toLocaleString("pt-BR")}</strong><small>monitorados no radar</small></div>
      <div className={critical ? "is-danger" : "is-positive"}><span>Ação imediata</span><strong>{critical.toLocaleString("pt-BR")}</strong><small>{critical ? "repor com urgência" : "tudo sob controle"}</small></div>
      <div className="is-positive"><span>Saudáveis</span><strong>{healthy.toLocaleString("pt-BR")}</strong><small>com cobertura</small></div>
      <div><span>Unidades vendidas</span><strong>{sold.toLocaleString("pt-BR")}</strong><small>{overview.period.label}</small></div>
      <ResumoDoCustoNoFull leitura={custoNoFull} />
    </section>
    <TabelaDoCustoNoFull leitura={custoNoFull} />
    {overview.stockRadar.length === 0 ? <Empty>Nenhum produto ativo encontrado.</Empty> : <>
      <aside className="inventory-method-strip" aria-label="Como a cobertura de estoque é calculada"><strong>Como calculamos</strong><span>Cobertura = estoque atual ÷ média diária de vendas no período. Pausas e dias históricos sem estoque ainda não são descontados.</span></aside>
      <section className="listing-controls cols-3" role="search" aria-label="Filtros de estoque">
        <label className="listing-search"><span className="sr-only">Buscar no estoque</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Buscar SKU ou produto" /></label>
        <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); setPage(1); }} aria-label="Filtrar status do estoque"><option value="all">Todos os status</option><option value="out">Esgotado</option><option value="critical">Repor já</option><option value="low">Repor em breve</option><option value="ok">Saudável</option><option value="overstock">Excesso</option><option value="idle">Sem venda</option></select>
        <select value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setPage(1); }} aria-label="Ordenar estoque"><option value="urgency">Maior urgência</option><option value="stock">Maior estoque</option><option value="sales">Mais vendidos</option></select>
      </section>
      <section className="listing-table-shell inventory-table-shell" aria-labelledby="ml-inventory-results"><header><div><p className="section-kicker">Cobertura de estoque</p><h2 id="ml-inventory-results">{rows.length} {rows.length === 1 ? "produto encontrado" : "produtos encontrados"}</h2></div><p>{overview.period.label}</p></header>
        {rows.length === 0 ? <Empty>Nenhum produto encontrado. Limpe a busca ou troque o status.</Empty> : <div className="overflow-x-auto"><table className="inventory-table listing-table"><caption className="sr-only">Cobertura de estoque dos produtos do Mercado Livre</caption><thead><tr><th>Produto</th><th>SKU</th><th>Estoque</th><th>Vendidos</th><th>Cobertura</th><th>Status</th></tr></thead><tbody>{pagedRows.map((product) => <tr key={product.id}><td><div className="listing-product">{product.thumbnail ? (
                        // Miniatura já vem reduzida do catálogo do canal.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.thumbnail} alt="" />
                      ) : <span className="listing-image-fallback" aria-hidden="true">ML</span>}<div><strong className="block max-w-[320px] truncate" title={product.title}>{product.title}</strong></div></div></td><td className="font-mono text-xs">{product.sku || product.id}</td><td className="tabular-nums">{product.availableQuantity}</td><td className="tabular-nums">{product.unitsSold}</td><td className="stock-coverage-value tabular-nums"><strong>{product.daysRemaining == null ? "—" : `${product.daysRemaining} dias`}</strong><small>base: {product.calculationDays} dias</small></td><td className="inventory-status-cell"><span className={`stock-status is-${product.status}`}>{ROTULO_DE_COBERTURA[product.status] ?? "Saudável"}</span></td></tr>)}</tbody></table></div>}
        {pageCount > 1 && <div className="listing-pagination"><Pagination page={current} pageCount={pageCount} total={rows.length} pageSize={30} onPage={setPage} /></div>}
      </section>
    </>}
  </div>;
}

function Monitor({ overview, secaoInicial }: { overview: Overview; secaoInicial: SecaoDoMonitor }) {
  const profitCoverage = overview.profit.coverage;
  const netReceived = overview.profit.revenueProcessed - overview.profit.fees - overview.profit.sellerShipping;
  const { semAliquota, resultParcial, resultIncomplete, margemSub } = avaliarResultado(overview);
  // ⚠️ 30/08/2026 — custo faltando virou SINAL, nao trava (decisao da vendedora).
  const sinais = sinaisDoResultado({
    skusWithoutCost: overview.profit.skusWithoutCost,
    hrefDeCustos: "/mercado-livre/produtos",
  });
  // ⚠️ Vem por PROP, não de `window.location`: a página é prerenderizada e um
  // `useState` que lê a URL no inicializador roda no servidor, onde `window` não
  // existe — e a hidratação não o re-executa. Quem lê a URL é o
  // `useSearchParams`, dentro da fronteira de Suspense lá em cima.
  const [section, setSection] = useState<SecaoDoMonitor>(secaoInicial);
  return <div className="ml-monitor-body">
    {/* Mesmo nome de pagina do monitor da Amazon, base DIFERENTE: la o numero e
        por data do lancamento do repasse, aqui e por data do pedido. Sem dizer
        isso, "Monitor da conta" parece a mesma coisa nos dois canais. */}
    <BaseDeData base="pedido" />
    <EstadoDoSync provider="mercado_livre" />
    {/*
      Os sinais aparecem UMA vez aqui tambem — o Monitor e outra tela, e quem
      esta nela precisa saber o que falta do mesmo jeito. O que o corte 1 proibe
      e repetir a MESMA lista em varios cartoes da MESMA tela, nao mostra-la nas
      telas que a usam.

      ⚠️ Sem esta linha, `sinais` viraria calculo sem consumidor: a auditoria
      teria trocado repeticao por codigo morto, e a pessoa que abre o Monitor
      perderia o aviso de custo nao cadastrado — o oposto de "nada desaparece".
    */}
    {sinais.length > 0 && <SinaisDoResultado sinais={sinais} />}
    <CustomizableMetricGrid
      viewKey="mercado-livre-monitor"
      ariaLabel="Resumo do monitor Mercado Livre"
      gridClassName="metric-grid monitor-metric-grid"
      widgets={[
        {
          id: "vendas-brutas",
          label: "Vendas brutas",
          node: <Metric label="Vendas brutas" value={<AnimatedNumber periodo={identidadeDePeriodo(overview.period.from, overview.period.to)} id="ml-monitor-revenue" value={overview.metrics.revenue30d} format={(amount) => money(amount, overview.metrics.currency)} />} sub={`${overview.metrics.paidOrders} aprovadas + ${overview.metrics.cancelledOrders} canceladas`} />,
        },
        {
          id: "canceladas",
          label: "Canceladas",
          node: <Metric label="Canceladas" value={money(overview.metrics.cancelledRevenue, overview.metrics.currency)} sub={`${overview.metrics.cancelledOrders} pedido(s) no período`} tone={overview.metrics.cancelledRevenue > 0 ? "danger" : "ok"} className="metric-cancelled" />,
        },
        {
          id: "total-recebido",
          label: profitCoverage.complete ? "Total recebido" : "Total recebido processado",
          node: <Metric label={profitCoverage.complete ? "Total recebido" : "Total recebido processado"} value={money(netReceived, overview.metrics.currency)} sub="após tarifa e frete" />,
        },
        {
          id: "margem",
          label: profitCoverage.complete ? "Margem de contribuição" : "Margem processada",
          node: <Metric label={resultIncomplete ? "Resultado processado" : "Margem de contribuição"} value={overview.profit.estimatedProfit == null ? "—" : money(overview.profit.estimatedProfit, overview.metrics.currency)} sub={comSemImposto(`${overview.profit.coverage.processedOrders} de ${overview.profit.coverage.paidOrders} vendas`, semAliquota)} tone={resultIncomplete || overview.profit.estimatedProfit == null ? "default" : overview.profit.estimatedProfit > 0 ? "positive" : overview.profit.estimatedProfit < 0 ? "danger" : "default"} />,
        },
        {
          id: "margem-pct",
          label: "Margem",
          node: <Metric label="Margem" value={percent(overview.profit.marginPct)} sub={margemSub} tone={marginMetricTone(overview.profit.marginPct)} />,
        },
      ]}
    />
    {semAliquota && <div className="flex justify-end"><Link href={MERCADO_LIVRE_TAX_RATE_HREF} className="meli-primary-action">Cadastrar alíquota <span aria-hidden="true">→</span></Link></div>}

    {/* Mesmas três abas da Amazon, na mesma ordem. "Transações" faltava aqui: o
        extrato do Mercado Pago existia só no card do dashboard, e quem abria o
        monitor não achava onde ver quando o dinheiro cai. */}
    <nav className="monitor-section-tabs" aria-label="Visões do monitor Mercado Livre"><button type="button" aria-current={section === "composition" ? "page" : undefined} onClick={() => setSection("composition")}>Composição</button><button type="button" aria-current={section === "transactions" ? "page" : undefined} onClick={() => setSection("transactions")}>Transações</button><button type="button" aria-current={section === "profitability" ? "page" : undefined} onClick={() => setSection("profitability")}>Rentabilidade por venda</button></nav>

    {section === "transactions" && <MercadoLivreSaldo modo="transacoes" />}

    {section === "composition" && <section className="monitor-composition" aria-labelledby="meli-financial-title">
      <header className="monitor-section-heading"><div><p>Financeiro realizado</p><h2 id="meli-financial-title">Do faturamento ao resultado</h2></div><span>Valores conciliados do Mercado Livre</span></header>
      <div className="financial-lines">
        <Flow label={profitCoverage.complete ? "Faturamento dos produtos" : "Faturamento processado"} value={money(overview.profit.revenueProcessed, overview.metrics.currency)} />
        <Flow label="Tarifa de venda" value={money(overview.profit.fees, overview.metrics.currency)} sign="−" />
        <Flow label="Frete pago pelo vendedor" value={money(overview.profit.sellerShipping, overview.metrics.currency)} sign="−" />
        <Flow label="Total recebido" value={money(netReceived, overview.metrics.currency)} sign="=" />
        <Flow label="Custo dos produtos" value={money(overview.profit.cogs, overview.metrics.currency)} sign="−" />
        <Flow label={rotuloImposto(overview.profit.taxRate, overview.profit.taxes, overview.metrics.currency).label} value={rotuloImposto(overview.profit.taxRate, overview.profit.taxes, overview.metrics.currency).value} sign="−" />
        <Flow label={comSemImposto("Margem de contribuição", semAliquota)} value={overview.profit.estimatedProfit == null ? "—" : money(overview.profit.estimatedProfit, overview.metrics.currency)} sign="=" accent />
      </div>
      {overview.profit.buyerShipping > 0 && <p className="monitor-coverage-note">O comprador pagou {money(overview.profit.buyerShipping, overview.metrics.currency)} de frete no período. Esse valor não compõe o faturamento; o resultado considera apenas o frete efetivamente pago pelo vendedor.</p>}
    {(!profitCoverage.complete || !overview.profit.shippingCostsComplete) && (
      // Nota discreta: o cálculo já cobre o período inteiro; isto só sinaliza o
      // que ainda está sendo conciliado em segundo plano, sem poluir a tela.
      <p className="monitor-coverage-note">
        {!profitCoverage.complete
          ? `Conciliando ${(profitCoverage.paidOrders - profitCoverage.processedOrders).toLocaleString("pt-BR")} de ${profitCoverage.paidOrders.toLocaleString("pt-BR")} vendas — os valores acima consideram só o que já foi apurado.`
          : "Alguns fretes ainda estão sendo conciliados; essas vendas ficam de fora da margem para não superestimá-la."}
      </p>
    )}
    </section>}
    {section === "profitability" && <OrderProfitabilityTable lines={overview.profitabilityLines} scopeNote={fraseDeEscopo(overview.profitabilityScope)} />}
  </div>;
}
