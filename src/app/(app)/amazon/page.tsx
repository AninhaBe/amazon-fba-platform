"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { DailyPoint } from "../../components/RevenueChart";
import { PageHeader, pageIcons } from "../../components/PageHeader";
import { AccountSwitcher } from "../../components/AccountSwitcher";
import { DashboardSkeleton, InlineLoading } from "../../components/LoadingState";
import { NexoDoDia } from "../../components/NexoDoDia";
import { EmptyState } from "../../components/EmptyState";
import { DashboardPeriodFilter, useDashboardPeriod } from "../../components/DashboardPeriodFilter";
import { periodoNaUrl } from "../../components/periodoNaUrl";
import type { OperationPendingItem } from "../../components/OperationPending";
import { amazonFinancialCards, diasSemAnuncio, type AmazonAdsInput } from "./amazonFinancialCards";
import { identidadeDePeriodo } from "../../components/AnimatedNumber";
import { JANELA_DE_SETE_DIAS, precisaBuscarAJanela, serieDoBlocoDeLucro } from "../../components/serieDoLucroPorDia";
import { PainelV3, type DadosV3 } from "../../components/PainelV3";
import { PainelV3Baixo, type DadosV3Baixo } from "../../components/PainelV3Baixo";
import { EtapaDoCaminhoView } from "../../components/EtapaDoCaminhoView";
import { colunasDoPeriodoAmazon, diasDoRitmoAmazon, entradaDaFaixaDosCards, margemDoPeriodoAmazon, produtosDoTopAmazon } from "./amazonPainelV3";
import { buscaCompartilhada } from "../../components/buscaCompartilhada";
import { CANAL_AMAZON } from "@/lib/canalV3";
import { AnunciosPorProduto, type AnuncioDeProduto } from "../../components/AnunciosPorProduto";
import { ConnectionBroken, isBrokenConnection } from "../../components/ConnectionBroken";
import { IntegrationDashboardFrame } from "../../components/IntegrationDashboardFrame";

/**
 * Cobertura do cálculo de rentabilidade, como a API devolve. É objeto, não
 * texto: `scopeNote` da tabela espera uma frase, então precisa ser formatado
 * antes de chegar lá (renderizar o objeto cru derruba a página inteira).
 */
interface ProfitabilityScope {
  processedOrders: number;
  completePeriod: boolean;
}

/**
 * "Anúncio contabilizado até DD/MM — faltam N dias", a MESMA frase do card.
 *
 * Ela precisa aparecer também na tabela por produto: quem lê a tabela pode não
 * ter lido o card, e sem isso um SKU parece ter gastado menos do que gastou
 * (ajuste pedido pelo cérebro em 28/08/2026).
 */
function janelaDoAnuncio(
  ads: AmazonAdsInput | null | undefined,
  janela: { esperadoAte: string } | null | undefined,
): string | null {
  if (!ads?.ateDia || !janela?.esperadoAte) return null;
  const faltam = diasSemAnuncio(ads.ateDia, janela.esperadoAte);
  if (faltam <= 0) return null;
  return `Anúncio contabilizado até ${brDate(new Date(`${ads.ateDia}T12:00:00-03:00`))} — falta${faltam > 1 ? "m" : ""} ${faltam} dia${faltam > 1 ? "s" : ""}`;
}

function scopeSentence(scope?: ProfitabilityScope): string | undefined {
  if (!scope) return undefined;
  if (scope.completePeriod) return undefined; // período completo: texto padrão da tabela serve
  return `Detalhamento processado em ${scope.processedOrders} venda(s) do período — o histórico ainda está sendo importado.`;
}
import type { ProfitabilityLine } from "@/lib/profitability";
import { brDate, brTime } from "@/lib/datetime";
import { coberturaDoPeriodo } from "@/lib/coberturaPeriodo";
import { usePrefetchDePeriodos } from "../../components/prefetchDePeriodos";
import { readJson } from "../../../lib/readJson";
import { BaseDeData, ProgressoDaImportacao } from "../../components/BaseDeData";

// Faixa de cima: o que resume o RESULTADO. Anuncio entrou aqui em 25/08/2026
// porque virou componente do lucro — deixa-lo so na composicao la embaixo
// esconderia justamente o custo que inverteu o sinal do resultado.
const AMAZON_TAX_RATE_HREF = "/amazon/calculadora#amazon-aliquota";

function money(v: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);
}

interface OrdersData {
  metrics: { totalOrders: number; totalRevenue: number; currency: string; fbaOrders: number; pendingItems: number };
  orders: {
    amazonOrderId: string;
    purchaseDate: string;
    orderStatus: string;
    orderTotal?: { CurrencyCode: string; Amount: string };
  }[];
}
interface ProfitData {
  finance: {
    revenue: number;
    /** `null` = nenhuma tarifa postada no período. Zero seria mentira (30/08/2026). */
    fees: number | null;
    refunds: number;
    netProceeds: number | null;
    currency: string;
    orderCount: number; units: number; daily: DailyPoint[];
    /** Cupom bancado pela vendedora, já abatido de `revenue`. */
    promotions?: number;
    /** Frete que o comprador pagou de fato. */
    buyerShipping?: number;
    /** Cada tarifa nomeada, para a cascata não esconder o que compõe "Taxas Amazon". */
    feeBreakdown?: { type: string; amount: number }[];
  };
  cogs: number;
  /**
   * A BASE de lucro, margem e imposto: o faturamento do período (pendentes e
   * confirmados). É o denominador da margem — ver a nota em
   * `amazonFinancialCards.ts`, onde a divergência entre base e numerador exibiu
   * −90,5% e +120,9% no mesmo dia.
   */
  revenueDoLucro?: number | null;
  /**
   * A BASE DO RESULTADO — so os pedidos com preco, tarifa E custo conhecidos.
   * E o denominador da MARGEM desde 04/09/2026; `revenueDoLucro` continua sendo
   * o card de Faturamento. Ver o bloco UNIVERSO COERENTE no produtor.
   */
  baseDoResultado?: number | null;
  /** Quantos pedidos compoem `baseDoResultado`. A tela declara "X de N". */
  pedidosCompletos?: number;
  /** Pedidos que a Amazon ainda não valorizou — fora da base, apontados com número. */
  pedidosSemValor?: number;
  pedidosDoPeriodo?: number;
  /**
   * ⚠️ O TOTAL DE TARIFA QUE O LUCRO SUBTRAI, e o nome tem de ser o MESMO na
   * gravacao e na leitura (02/09/2026).
   *
   * O defeito que isto conserta: o estado gravava `feesDoLucro` e o construtor
   * dos cards lia `profit.fees` — um campo que NUNCA foi preenchido. O card caia
   * no fallback (`finance.fees`, so a tarifa postada) e a marca voltava ao texto
   * antigo, porque a composicao so aparece quando o total existe.
   *
   * E o compilador AVISOU: `Property 'fees' does not exist on type ProfitData`.
   * Eu calei o aviso acrescentando `fees?: number` ao tipo, em vez de consertar a
   * leitura. O campo opcional fez o erro sumir e o defeito ficar — silenciar o
   * compilador nao e o mesmo que resolver o que ele apontou.
   */
  feesDoLucro?: number | null;
  /** Fatias e fluxo do painel do conciliado; o lucro e o residuo do universo dele. */
  composicaoDoConciliado?: {
    receita: number; custo: number; tarifa: number; pedidos: number;
    lucro: number; margemPct: number | null;
  };
  pedidosComValor?: number;
  /** Quanto das tarifas é estimativa da Amazon (ADR-027), para a marca na tela. */
  feesEstimadas?: number;
  pedidosComTarifaEstimada?: number;
  /** Já com o anúncio dentro (fronteira em `src/lib/financialMath.ts`). */
  estimatedProfit: number | null;
  /** O anúncio que o produtor já descontou acima — a tela escreve, não subtrai. */
  adsNoLucro?: number | null;
  /** Estorno já descontado, pela data da venda. A tela avisa quando muda o passado. */
  refunds?: number;
  refundCount?: number;
  unitsWithoutCost: number;
  skusWithoutCost: number;
  taxRate?: number | null;
  taxes?: number | null;
  /** Anuncio do periodo, da Ads API. `null` = nao sincronizado (nao e zero). */
  ads?: AmazonAdsInput | null;
  /** Janela do periodo em dia BRT. Vem mesmo sem metrica. */
  adsJanela?: { inicioDia: string; esperadoAte: string; incluiHoje?: boolean } | null;
  /** Ha conta de anuncio conectada? Separa "nao anuncia" de "nao sei quanto gastou". */
  adsConectado?: boolean;
  /** Por SKU anunciado, ja cruzado com a margem real (frente de Ads, 28/08/2026). */
  adsPorProduto?: AnuncioDeProduto[];
}
interface SaldoData {
  currency: string;
  disponivel: number | null;
  retido: number;
  liberacoes: { date: string; amount: number; orderIds: string[] }[];
  extratoDesde: string | null;
  seraCobrado: boolean;
}
/** A MESMA escala do Mercado Livre — `tomDaCobertura` em
 *  `MercadoLivreWorkspace`. Duas escalas para "critico" no mesmo produto fariam
 *  o mesmo estoque mudar de cor conforme o canal. */
const tomDaCoberturaAmazon = (status: string): "critico" | "atencao" | "saudavel" =>
  status === "out" || status === "critical" ? "critico" : status === "low" ? "atencao" : "saudavel";

interface RadarRow {
  sellerSku: string;
  productName?: string;
  fulfillable: number;
  daysRemaining: number | null;
  status: string;
}
interface ProductRow {
  id: string;
  cost: number | null;
}
// Faturamento e vendas vêm da Sales API (orderMetrics, data do pedido) para
// BATER com o "Vendas brutas" do Seller Central. O lado financeiro (taxas,
// repasse, lucro) vem das transações — base diferente, como as abas Vendas e
// Pagamentos do próprio Seller Central.
interface SalesSeries {
  currency: string;
  points: DailyPoint[];
  totalRevenue: number;
  totalOrders: number;
  totalUnits: number;
}
interface TopProduct {
  sku: string;
  title?: string;
  units: number;
  revenue: number;
  marginPct: number | null;
}


// Payload da rota agregadora /api/amazon/dashboard (ADR-017): uma chamada
// devolve a tela inteira, lida do banco canônico. As interfaces acima seguem
// sendo o contrato interno da página — aqui só o mapeamento de chegada.
interface DashboardPayload {
  covered: boolean;
  /** Período resolvido + cobertura do sync (frente K): a tela distingue
   *  "não vendeu" de "ainda não importei" — nunca zero fabricado. */
  period?: { from: string; to: string };
  sync?: { connectionId: string; coveredFrom: string | null; coveredTo: string | null; status: string | null; processedOrders: number };
  currency: string;
  /**
   * ⚠️ NÃO É O FATURAMENTO — é a receita que o NOSSO BANCO consegue valorizar.
   * Chamava-se `billing`, e o nome custou o ticket médio de R$ 0,68 medido em
   * 01/09/2026. Ver a nota no produtor, em `api/amazon/dashboard/route.ts`.
   */
  receitaValorizadaPeloBanco: {
    revenue: number;
    orders: number;
    ordersWithValue?: number;
    /**
     * Cupom resgatado no período — o que explica "Pedidos feitos" ser MAIOR que
     * "Faturamento". `null` = período sem pedido conciliado, e a linha some.
     */
    coupon?: number | null;
    /** Há pedidos sem preço de tabela: o cupom é um PISO, não o total exato. */
    couponPartial?: boolean;
  };
  /**
   * Pedidos feitos, pela Sales API: inclui pendentes, EXCLUI cancelados, e
   * valoriza a preço de tabela (antes do cupom resgatado).
   *
   * Medido em 22/08/2026, janela de 30 dias — `orderMetrics` e o relatório
   * All Orders devolvem o mesmo R$ 449,94, decomposto assim:
   *   360,99 pago pelos 14 enviados + 16,83 de cupom + 72,12 dos 3 pendentes.
   * O Seller Central mostra R$ 516,27 porque soma também os 2 cancelados
   * (R$ 66,33) — e esse valor a Amazon NÃO devolve em nenhuma API: pedido
   * cancelado vem com `quantity 0` e preço vazio no relatório e no
   * `getOrderItems`. Por isso a paridade com o Seller Central é impossível,
   * não é defeito nosso. Ver docs/api-amazon-sp-api.md.
   *
   * `null` = a Sales API não respondeu; omitir é melhor que zerar.
   */
  ordered: { revenue: number; orders: number; units: number; points: DailyPoint[] } | null;
  /**
   * Canceladas: somadas no bruto, exibidas à parte — mesmo padrão do ML.
   * `revenue` nulo = valor desconhecido (a Amazon omite `OrderTotal` no que
   * cancela ainda em `Pending`), nunca zero.
   */
  cancelled: { revenue: number | null; orders: number };
  metrics: { totalOrders: number; paidOrders: number; fbaOrders: number; revenue: number };
  /** ⚠️ Ganhou lucro por dia em 12/09/2026 (contrato fechado com o backend):
   *  `profit` null = dia nao apuravel (so contorno, fora da media);
   *  `profitEstimated` = a tarifa do dia inclui estimativa ADR-027;
   *  `refunds` = estorno postado no dia, que explica barra derrubada por venda antiga. */
  dailySales: Array<{ date: string; revenue: number; orders: number; units: number; profit?: number | null; profitEstimated?: boolean; refunds?: number }>;
  topProducts: Array<{ sku: string; title: string; units: number; revenue: number; marginPct: number | null }>;
  profit: { revenueProcessed: number; revenueDoLucro?: number | null; baseDoResultado?: number | null; pedidosCompletos?: number; pedidosDoPeriodo?: number; pedidosComValor?: number; pedidosSemValor?: number; feesEstimadas?: number; pedidosComTarifaEstimada?: number; composicaoDoConciliado?: { receita: number; custo: number; tarifa: number; pedidos: number; lucro: number; margemPct: number | null }; fees: number; cogs: number; estimatedProfit: number | null; taxRate?: number | null; taxes?: number | null; refunds?: number; refundCount?: number; ads?: number | null; unitsWithCost: number; unitsWithoutCost: number; skusWithoutCost: number; coverage?: { processedOrders: number; paidOrders: number; complete: boolean } };
  ads?: AmazonAdsInput | null;
  adsJanela?: { inicioDia: string; esperadoAte: string; incluiHoje?: boolean } | null;
  adsConectado?: boolean;
  /** Por SKU anunciado, já cruzado com a margem real (frente de Ads, 28/08/2026). */
  adsPorProduto?: AnuncioDeProduto[];
  finance: ProfitData["finance"];
  profitabilityLines: ProfitabilityLine[];
  profitabilityScope?: ProfitabilityScope;
  recentOrders: OrdersData["orders"];
  radar: RadarRow[] | null;
  durationMs: number;
}

// ⚠️ TUDO QUE DEPENDE DO PERIODO MORA AQUI. NAO DEIXE FATIA DE FORA.
//
// Medido em producao em 28/08/2026, no movimento que a dona do produto faz todo
// dia: a tela abre em 30 dias, ela vai para 7 e VOLTA para 30. Na volta, o card
// de Faturamento continuou mostrando R$ 1.603,70 — o valor de 7 dias — sob o
// rotulo "30 dias" por 551ms, enquanto a celula de Taxas ao lado ja mostrava o
// recorte novo.
//
// A causa nao foi o cache: foi o que ficou FORA dele. Cinco fatias
// (conciliacao, faturamento, pedidos feitos, canceladas e cobertura) eram
// estado solto, escrito so quando a resposta chegava. O que estava no snapshot
// repintava do cache no primeiro quadro; o que estava fora esperava a rede — e
// esperar mostrando o numero do periodo anterior e a mesma mentira que a gente
// passou o dia inteiro consertando, so que numa celula que ninguem olhava.
//
// A regra, entao: fatia nova que muda com o periodo entra NESTE tipo. Se ela
// nao couber aqui, ela nao pode ser exibida junto do rotulo do periodo.
interface DashSnapshot {
  orders: OrdersData | null;
  profit: ProfitData | null;
  radar: RadarRow[];
  sales: SalesSeries | null;
  top: TopProduct[];
  profitability: ProfitabilityLine[];
  profitabilityScope?: ProfitabilityScope;
  conciliacao: ConciliacaoData | null;
  faturamento: DashboardPayload["receitaValorizadaPeloBanco"] | null;
  pedidosFeitos: PedidosFeitosData | null;
  canceladas: CanceladasData | null;
  cobertura: CoberturaData | null;
  updatedAt: Date;
}

type ConciliacaoData = { processedOrders: number; paidOrders: number; complete: boolean };
type PedidosFeitosData = { revenue: number; orders: number; units: number; points: DailyPoint[] };
type CanceladasData = { revenue: number | null; orders: number; ordersWithValue?: number; ordersEstimated?: number };
type CoberturaData = {
  periodo: { from: string; to: string };
  sync: { connectionId: string; coveredFrom: string | null; coveredTo: string | null; status: string | null; processedOrders: number };
};

// Escopo de módulo: sobrevive à navegação entre canais. Ao voltar, o período
// já visto renderiza no primeiro paint e a revalidação roda em segundo plano.
const dashCache = new Map<string, DashSnapshot>();

/**
 * A JANELA DE SETE DIAS DO BLOCO "Ritmo" — buscada em QUALQUER filtro.
 *
 * ⚠️ ELA VIU O DEFEITO EM PRODUCAO EM 13/09/2026: com o filtro
 * "Hoje", o cartao "Ritmo dos ultimos 7 dias" da Amazon mostrava UMA coluna
 * gigante ocupando o cartao inteiro, sem dia da semana e sem valor por dia —
 * enquanto o Mercado Livre, ao lado, mostrava as sete.
 *
 * A causa era `sales.points.slice(-7)`: `points` e a serie do PERIODO
 * selecionado, e no filtro "Hoje" ela tem um ponto so. Cortar os ultimos sete
 * de uma lista de um devolve um.
 *
 * ⚠️ A REGRA JA EXISTIA E E DELA (09/09/2026): *"o ritmo dos
 * ultimos 7 dias vai ser a unica coisa que nao vai mudar com base no filtro de
 * data"*. O Mercado Livre a cumpria desde entao, com as funcoes puras de
 * `serieDoLucroPorDia.ts`; a Amazon nunca foi ligada nelas. Replicar aqui e
 * usar as MESMAS funcoes, nao escrever uma segunda versao da regra.
 *
 * Nao e busca a mais na maioria dos casos: a chave e a mesma do filtro
 * "7 dias", entao quem ja passou por ele encontra tudo em memoria.
 */
function useJanelaDeSeteDiasAmazon(contaAtual: string | null) {
  // ⚠️ SO O SETTER IMPORTA: os Maps vivem fora do React e nao
  // avisam ninguem quando a chave e preenchida. Quem decide o que a tela recebe
  // e a leitura no render, logo abaixo — a mesma disciplina do Mercado Livre,
  // onde memorizar a leitura deixou o cartao vazio com o dado no payload.
  const [, setBuscasConcluidas] = useState(0);

  useEffect(() => {
    const temNoCache = payloadDoPeriodo.has(JANELA_DE_SETE_DIAS) || dashCache.has(JANELA_DE_SETE_DIAS);
    if (!precisaBuscarAJanela({ temNoCache, connectionId: contaAtual })) return;
    const controller = new AbortController();
    void fetch(`/api/amazon/dashboard?${JANELA_DE_SETE_DIAS}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() as Promise<DashboardPayload> : null))
      .then((payload) => {
        if (!payload || controller.signal.aborted) return;
        payloadDoPeriodo.set(JANELA_DE_SETE_DIAS, payload);
        setBuscasConcluidas((n) => n + 1);
      })
      // Falha aqui nao e erro de tela: o bloco nao aparece e o resto do periodo
      // selecionado continua de pe.
      .catch(() => {});
    return () => controller.abort();
  }, [contaAtual]);

  // Leitura no render, sem `useMemo` — ver o porque em `serieDaJanelaDeSeteDias`.
  return payloadDoPeriodo.get(JANELA_DE_SETE_DIAS)?.dailySales
    ?? dashCache.get(JANELA_DE_SETE_DIAS)?.sales?.points
    ?? null;
}

// Payload CRU por periodo, so para o aquecimento. De proposito nao guarda o
// snapshot montado: o mapeamento payload -> tela e campo a campo (ver a nota
// em `profit`), e uma segunda copia dele derivaria da primeira no dia em que
// alguem acrescentasse um campo. Aqui guarda-se a resposta e reusa-se o MESMO
// mapeamento que a tela ja usa.
const payloadDoPeriodo = new Map<string, DashboardPayload>();
// ⚠️ O CACHE DE PRODUTOS CARREGA A CONTA JUNTO.
//
// Ele sobrevive a navegacao como os outros, e por isso precisa dizer de quem
// ele e. Guardar so as linhas repetiria, com outra roupa, o defeito de
// 28/08/2026 (numero de um recorte sob o rotulo de outro): trocar de conta
// Amazon e continuar vendo os produtos da anterior e a mesma mentira, so que
// pior — ali era um periodo, aqui seria outra loja.
//
// `conta: null` = buscado antes de a conta ser conhecida (a resposta e a da
// sessao, que e a mesma). Assim que o payload revela a conta, ela e anotada.
let productsCache: { conta: string | null; linhas: ProductRow[] } | null = null;

/**
 * A legenda do cartão de Faturamento.
 *
 * A Amazon não informa o valor de pedido `Pending`, então existe pedido real sem
 * valor no período. Somar zero e contar um produz "R$ 0,00 · 1 pedido" — a
 * contradição que a vendedora flagrou em 22/08/2026. Aqui a legenda nomeia o
 * estado: quantos pedidos ainda não têm valor, em vez de escondê-los na contagem.
 */
function legendaFaturamento(
  f: { revenue: number; orders: number; ordersWithValue?: number } | null,
  fallback: number
): string {
  const pedidos = f?.orders ?? fallback;
  const comValor = f?.ordersWithValue;
  const plural = (n: number) => `${n} ${n === 1 ? "pedido" : "pedidos"}`;
  if (comValor === undefined || comValor === pedidos) return `${plural(pedidos)} no período`;
  const semValor = pedidos - comValor;
  // Nenhum tem valor ainda: dizer o motivo, não mostrar zero seco.
  if (comValor === 0) {
    return `${plural(pedidos)} — a Amazon ainda não informou o valor`;
  }
  return `${plural(pedidos)} · ${semValor} ainda sem valor informado`;
}

function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [initialDash] = useState(() => dashCache.get(period.query));
  const [loadingBruto, setLoading] = useState(!initialDash);
  // De qual periodo sao as fatias em `*Bruto`. Sem isto nao da para saber, no
  // render, se o que esta na mao pertence ao periodo selecionado.
  const [periodoCarregado, setPeriodoCarregado] = useState<string | null>(initialDash ? period.query : null);
  const [ordersBruto, setOrders] = useState<OrdersData | null>(initialDash?.orders ?? null);
  const [profitBruto, setProfit] = useState<ProfitData | null>(initialDash?.profit ?? null);
  const [radarBruto, setRadar] = useState<RadarRow[]>(initialDash?.radar ?? []);
  const [products, setProducts] = useState<ProductRow[]>(productsCache?.linhas ?? []);
  const [salesBruto, setSales] = useState<SalesSeries | null>(initialDash?.sales ?? null);
  const [topBruto, setTop] = useState<TopProduct[]>(initialDash?.top ?? []);
  const [profitabilityBruto, setProfitability] = useState<ProfitabilityLine[]>(initialDash?.profitability ?? []);
  // Cobertura da conciliação: quantos pedidos pagos já viraram linhas conciliadas.
  // É o que permite à seção "Financeiro conciliado" DIZER que está parcial em vez
  // de exibir um número menor que o faturamento sem explicação (20/08/2026).
  const [conciliacaoBruta, setConciliacao] = useState<ConciliacaoData | null>(initialDash?.conciliacao ?? null);
  const [metricaV3, setMetricaV3] = useState("Faturamento");
  // Faturamento do período — o MESMO número que a central mostra. Antes o card
  // exibia a receita conciliada (subconjunto), e por isso três telas do produto
  // mostravam três valores diferentes de "faturamento" (20/08/2026).
  const [faturamentoBruto, setFaturamento] = useState<DashboardPayload["receitaValorizadaPeloBanco"] | null>(initialDash?.faturamento ?? null);
  // O número que ela confere contra o Seller Central. Sem ele na tela, a conta
  // era feita à mão — e foi assim que apareceram os defeitos de 21/08.
  const [pedidosFeitosBruto, setPedidosFeitos] = useState<PedidosFeitosData | null>(initialDash?.pedidosFeitos ?? null);
  // Canceladas entram no bruto (ADR-020); mostrar à parte é o que impede o número
  // de parecer inflado sem explicação — o ML já fazia, a Amazon não tinha.
  const [profitabilityScopeBruto, setProfitabilityScope] = useState<ProfitabilityScope | undefined>(initialDash?.profitabilityScope);
  const [saldo, setSaldo] = useState<SaldoData | null>(null);
  const [profitabilityLoadingBruto, setProfitabilityLoading] = useState(!initialDash);
  const [productsLoading, setProductsLoading] = useState(!productsCache);
  const [errors, setErrors] = useState<string[]>([]);
  const [brokenConnection, setBrokenConnection] = useState<string | null>(null);
  // Cobertura do sync vs. período (frente K) — vem da rota agregadora.
  const [coberturaBruta, setCobertura] = useState<CoberturaData | null>(initialDash?.cobertura ?? null);
  const [updatedAtBruto, setUpdatedAt] = useState<Date | null>(initialDash?.updatedAt ?? null);

  const periodQuery = period.query;

  // Aquecimento dos periodos padrao: depois da pintura, sequencial, so o que
  // falta. Guarda o payload cru; a troca de periodo passa a aplica-lo direto.
  const jaTemPeriodo = useCallback((q: string) => payloadDoPeriodo.has(q) || dashCache.has(q), []);
  const buscarPeriodo = useCallback(async (q: string, signal: AbortSignal) => {
    const resposta = await fetch(`/api/amazon/dashboard?${q}`, { signal });
    if (!resposta.ok) return;
    payloadDoPeriodo.set(q, await resposta.json() as DashboardPayload);
  }, []);


  // ⚠️ DERIVADO NO RENDER (mesma nota do ML, da Shopee e do TikTok).
  //
  // Medido em 28/08/2026 na v149: o repaint do cache saia por microtask, e nos
  // 5 quadros seguintes ao clique o botao ja dizia "7 dias" enquanto os numeros
  // ainda eram os de "hoje" (72ms a 124ms). Derivar aqui elimina o VAO: no
  // mesmo render em que o periodo muda, o que a tela le ja e daquele periodo —
  // do cache quando ha, vazio quando nao. Nunca o do periodo anterior.
  const cacheDoPeriodo = dashCache.get(periodQuery);
  const naMao = periodoCarregado === periodQuery;
  const orders = naMao ? ordersBruto : cacheDoPeriodo?.orders ?? null;
  const profit = naMao ? profitBruto : cacheDoPeriodo?.profit ?? null;
  const radar = naMao ? radarBruto : cacheDoPeriodo?.radar ?? [];
  const sales = naMao ? salesBruto : cacheDoPeriodo?.sales ?? null;
  const top = naMao ? topBruto : cacheDoPeriodo?.top ?? [];
  const profitability = naMao ? profitabilityBruto : cacheDoPeriodo?.profitability ?? [];
  const profitabilityScope = naMao ? profitabilityScopeBruto : cacheDoPeriodo?.profitabilityScope;
  const updatedAt = naMao ? updatedAtBruto : cacheDoPeriodo?.updatedAt ?? null;
  // As cinco que faltavam. Mesmo criterio das de cima: o que esta na mao vale
  // quando e DESTE periodo; senao vem do cache; senao e null — que a tela sabe
  // exibir como "—" ou carregando. O que nao pode e sobrar o valor do recorte
  // anterior, e era exatamente isso que acontecia aqui.
  const conciliacao = naMao ? conciliacaoBruta : cacheDoPeriodo?.conciliacao ?? null;
  const faturamento = naMao ? faturamentoBruto : cacheDoPeriodo?.faturamento ?? null;
  const pedidosFeitos = naMao ? pedidosFeitosBruto : cacheDoPeriodo?.pedidosFeitos ?? null;
  const cobertura = naMao ? coberturaBruta : cacheDoPeriodo?.cobertura ?? null;
  // Carregando = nao ha NADA daquele periodo na mao. Derivado pelo mesmo motivo
  // dos valores: o estado chegava um quadro depois do rotulo.
  const temDoPeriodo = naMao || !!cacheDoPeriodo;
  const loading = temDoPeriodo ? loadingBruto && !cacheDoPeriodo : true;
  const profitabilityLoading = temDoPeriodo ? profitabilityLoadingBruto && !cacheDoPeriodo : true;
  const { aquecerAgora } = usePrefetchDePeriodos({
    ativo: !loading && !!orders,
    atual: periodQuery,
    escopo: "amazon",
    jaTem: jaTemPeriodo,
    buscar: buscarPeriodo,
  });

  useEffect(() => {
    let active = true;
    const cached = dashCache.get(periodQuery);
    // Nada de repintar do cache aqui, e nada de sinalizar carregamento por
    // estado: as duas coisas sao DERIVADAS no render. Sincronizar por efeito e
    // o que abria o vao de quadros com o dado do periodo anterior.
    const next: Omit<DashSnapshot, "updatedAt"> = {
      orders: cached?.orders ?? null,
      profit: cached?.profit ?? null,
      radar: cached?.radar ?? [],
      sales: cached?.sales ?? null,
      top: cached?.top ?? [],
      profitability: cached?.profitability ?? [],
      profitabilityScope: cached?.profitabilityScope,
      conciliacao: cached?.conciliacao ?? null,
      faturamento: cached?.faturamento ?? null,
      pedidosFeitos: cached?.pedidosFeitos ?? null,
      canceladas: cached?.canceladas ?? null,
      cobertura: cached?.cobertura ?? null,
    };
    const store = () => {
      dashCache.set(periodQuery, { ...next, updatedAt: new Date() });
      // Marca de QUAL periodo sao as fatias em `*Bruto`. Sem isto o render nao
      // consegue distinguir "dado deste periodo" de "dado que sobrou do anterior".
      setPeriodoCarregado(periodQuery);
    };
    const errs: string[] = [];
    // Guarda o motivo de autorização à parte: ele merece tratamento próprio
    // (reconectar), e não entra na lista genérica de "não carregou".
    let broken: string | null = null;
    const safe = <T,>(url: string, set: (v: T) => void, pick: (d: unknown) => T, name: string) =>
      fetch(url)
        .then((r) => readJson(r).then((d) => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          if (!ok) {
            const info = (d as { errorInfo?: { code?: string }; error?: string });
            if (isBrokenConnection(info?.errorInfo?.code)) {
              broken = info.error ?? null;
              throw new Error("auth");
            }
            throw new Error(info?.error || name);
          }
          if (active) set(pick(d));
        })
        .catch(() => {
          if (!broken) errs.push(name);
        });

    // Uma tela = uma chamada (ADR-017): a rota agregadora devolve pedidos,
    // financeiro, vendas, estoque, top e rentabilidade num payload só, lido do
    // banco canônico — a SP-API saiu do caminho interativo.
    const aplicarPayload = (payload: DashboardPayload) => {
      const orders: OrdersData = {
        metrics: {
          totalOrders: payload.metrics.totalOrders,
          totalRevenue: payload.metrics.revenue,
          currency: payload.currency,
          fbaOrders: payload.metrics.fbaOrders,
          // O canônico não separa "itens pendentes" (era um subproduto da
          // paginação ao vivo). Zero aqui é honesto: a lista de recentes mostra
          // o status real de cada pedido.
          pendingItems: 0,
        },
        orders: payload.recentOrders,
      };
      const profit: ProfitData = {
        finance: payload.finance,
        cogs: payload.profit.cogs,
        revenueDoLucro: payload.profit.revenueDoLucro,
        baseDoResultado: payload.profit.baseDoResultado,
        pedidosCompletos: payload.profit.pedidosCompletos,
        pedidosSemValor: payload.profit.pedidosSemValor,
        feesDoLucro: payload.profit.fees,
        composicaoDoConciliado: payload.profit.composicaoDoConciliado,
        pedidosDoPeriodo: payload.profit.pedidosDoPeriodo,
        pedidosComValor: payload.profit.pedidosComValor,
        feesEstimadas: payload.profit.feesEstimadas,
        pedidosComTarifaEstimada: payload.profit.pedidosComTarifaEstimada,
        estimatedProfit: payload.profit.estimatedProfit,
        adsNoLucro: payload.profit.ads ?? null,
        // ⚠️ CAMPO NOVO TEM QUE SER LIDO AQUI — este objeto é montado campo a
        // campo e o TypeScript não reclama do que falta (os campos são
        // opcionais). Foi assim que o card de Anúncios ficou em "—" com o dado
        // já no banco; o imposto entrou em 31/08/2026 pelo mesmo caminho.
        taxRate: payload.profit.taxRate ?? null,
        taxes: payload.profit.taxes ?? null,
        refunds: payload.profit.refunds ?? 0,
        refundCount: payload.profit.refundCount ?? 0,
        unitsWithoutCost: payload.profit.unitsWithoutCost,
        skusWithoutCost: payload.profit.skusWithoutCost ?? 0,
        // ⚠️ ESTE OBJETO E MONTADO CAMPO A CAMPO: campo novo na resposta da rota
        // NAO chega na tela sozinho, e como os tres sao opcionais o TypeScript
        // nao reclama. Foi assim que o card de Anuncios ficou em "—" com o dado
        // ja gravado no banco de producao (25/08/2026) — a rota devolvia, e aqui
        // ninguem lia.
        ads: payload.ads ?? null,
        adsJanela: payload.adsJanela ?? null,
        adsConectado: payload.adsConectado ?? false,
        adsPorProduto: payload.adsPorProduto ?? [],
      };
      // O gráfico se chama "pedidos recebidos", então tem de contar pedido
      // recebido — incluindo o que ainda está `pending`. A série canônica só tem
      // aprovadas, e por isso um pedido feito às 21:12 aparecia como dia zerado.
      // Quando o orderMetrics responde, é ele que manda; se falhar, cai no
      // canônico e o rótulo abaixo passa a dizer "confirmado".
      const sales: SalesSeries = payload.ordered
        ? {
            currency: payload.currency,
            points: payload.ordered.points,
            totalRevenue: payload.ordered.revenue,
            totalOrders: payload.ordered.orders,
            totalUnits: payload.ordered.units,
          }
        : {
            currency: payload.currency,
            points: payload.dailySales,
            totalRevenue: payload.metrics.revenue,
            totalOrders: payload.metrics.paidOrders,
            totalUnits: payload.dailySales.reduce((sum, d) => sum + d.units, 0),
          };
      next.orders = orders; setOrders(orders);
      next.profit = profit; setProfit(profit);
      next.sales = sales; setSales(sales);
      if (payload.radar) { next.radar = payload.radar; setRadar(payload.radar); }
      next.top = payload.topProducts; setTop(payload.topProducts);
      next.profitability = payload.profitabilityLines; setProfitability(payload.profitabilityLines);
      // Escrever nas DUAS pontas — estado e `next` — e o que faltava: sem o
      // `next`, estas cinco nunca chegavam ao cache e a volta ao periodo ja
      // visto pagava a ida inteira mostrando o recorte anterior.
      next.conciliacao = payload.profit.coverage ?? null; setConciliacao(next.conciliacao);
      next.faturamento = payload.receitaValorizadaPeloBanco ?? null; setFaturamento(next.faturamento);
      next.pedidosFeitos = payload.ordered ?? null; setPedidosFeitos(next.pedidosFeitos);
      next.canceladas = payload.cancelled ?? null;
      next.cobertura = payload.period && payload.sync ? { periodo: payload.period, sync: payload.sync } : null;
      setCobertura(next.cobertura);
      next.profitabilityScope = payload.profitabilityScope; setProfitabilityScope(payload.profitabilityScope);
    };
    // Se o aquecimento ja trouxe este periodo, aplica o payload guardado em vez
    // de ir de novo ao servidor — mesmo mapeamento, sem espera.
    const jaAquecido = payloadDoPeriodo.get(periodQuery);
    const dashboardPronto = jaAquecido
      ? Promise.resolve().then(() => { if (active) aplicarPayload(jaAquecido); })
      : safe<DashboardPayload>(`/api/amazon/dashboard?${periodQuery}`, aplicarPayload, (d) => d as DashboardPayload, "dashboard");
    dashboardPronto.then(() => {
      if (active) {
        setErrors(errs);
        setBrokenConnection(broken);
        setUpdatedAt(new Date());
        setLoading(false);
        setProfitabilityLoading(false);
        store();
      }
    });

    return () => {
      active = false;
    };
  }, [periodQuery]);

  // ⚠️ ESTE EFEITO NAO OLHA O PERIODO — DE PROPOSITO, E ISSO E O CONSERTO.
  //
  // Medido em producao em 28/08/2026: trocar de periodo na Amazon disparava
  // TRES requisicoes (produtos, saldo e o briefing da central) enquanto ML,
  // Shopee e TikTok disparavam duas. E o dashboard, que e o unico que depende
  // do periodo, nem estava entre elas — o aquecimento ja o tinha. Ou seja: a
  // Amazon era a mais lenta a trocar de periodo pagando por dado que NAO MUDA
  // com o periodo. `/api/amazon/balance` e o saldo de agora e `/api/products`
  // nem periodo tem na pergunta; os dois eram refeitos a cada clique so porque
  // moravam num efeito com `[periodQuery]` na dependencia.
  //
  // O que muda o resultado destes dois e a CONTA, entao e nela que eles ouvem.
  const contaAtual = cobertura?.sync.connectionId ?? null;
  const contaDosExtras = useRef<string | null | undefined>(undefined);

  // ⚠️ TROCA DE CONTA LIMPA A LISTA ANTES DE PINTAR — mesmo padrao (e mesmo
  // motivo) do ajuste de estado no `AnimatedNumber`.
  //
  // Sem isto, trocar a conta Amazon deixaria os produtos da loja anterior na
  // tela ate a nova resposta chegar. Seria trocar um desperdicio por uma
  // mentira, e uma pior que a de hoje: la era o numero de outro PERIODO, aqui
  // seriam os produtos de outra LOJA. Ajustar durante o render acontece antes
  // da pintura, entao nao sobra quadro com a lista alheia.
  //
  // Só a troca entre contas CONHECIDAS limpa: `null -> conta` e a primeira vez
  // que o payload revela quem e, e a lista que esta na tela ja e dela.
  const [contaDosProdutos, setContaDosProdutos] = useState(contaAtual);
  if (contaAtual !== contaDosProdutos) {
    setContaDosProdutos(contaAtual);
    if (contaAtual !== null && contaDosProdutos !== null) {
      setProducts([]);
      setProductsLoading(true);
    }
  }
  useEffect(() => {
    // `undefined` = ainda nao buscamos nesta montagem. `null` = buscamos antes
    // de a conta ser conhecida. Sabendo a conta pela primeira vez NAO se busca
    // de novo: a resposta que ja veio e dela. So conta DIFERENTE refaz.
    const primeira = contaDosExtras.current === undefined;
    const trocouDeConta = !primeira && contaAtual !== null && contaDosExtras.current !== null
      && contaDosExtras.current !== contaAtual;
    if (!primeira && !trocouDeConta) {
      if (contaAtual !== null) contaDosExtras.current = contaAtual;
      return;
    }
    contaDosExtras.current = contaAtual;
    // Conta nova invalida o que estava em cache: e de outra loja.
    if (trocouDeConta) productsCache = null;

    let active = true;
    const falhas: string[] = [];
    const buscar = <T,>(url: string, set: (v: T) => void, pick: (d: unknown) => T, nome: string) =>
      fetch(url)
        .then((r) => readJson(r).then((d) => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          if (!ok) throw new Error((d as { error?: string })?.error || nome);
          if (active) set(pick(d));
        })
        .catch(() => { falhas.push(nome); });

    // Produtos usam o relatório da Amazon (lento) — carregam em separado.
    // O cache agora decide o FETCH, não só o esqueleto: antes ele existia,
    // guardava a resposta e mesmo assim a tela pedia de novo toda troca.
    // Cache da MESMA conta: nao ha o que buscar nem o que pintar. O estado ja
    // nasceu dele na montagem (`useState(productsCache?.linhas ?? [])`), entao
    // repintar aqui seria estado sincronizado por efeito — o padrao que a
    // licao de hoje mandou eliminar.
    if (!productsCache || productsCache.conta !== contaAtual) {
      void buscar<ProductRow[]>(`/api/products`, (v) => { productsCache = { conta: contaAtual, linhas: v }; setProducts(v); },
        (d) => (d as { products: ProductRow[] }).products, "produtos")
        .finally(() => { if (active) setProductsLoading(false); });
    }
    // Saldo NÃO leva `periodQuery`: é o estado de agora, não do período escolhido.
    void buscar<SaldoData | null>(`/api/amazon/balance`, (v) => setSaldo(v), (d) => d as SaldoData | null, "saldo")
      .then(() => { if (active && falhas.length) setErrors((atuais) => [...new Set([...atuais, ...falhas])]); });

    return () => { active = false; };
  }, [contaAtual]);

  const currency = profit?.finance.currency || orders?.metrics.currency || "BRL";

  const critical = radar.filter((r) => r.status === "critical" || r.status === "out");
  const noCost = products.filter((p) => p.cost == null || p.cost === 0).length;
  const janelaDeSeteDias = useJanelaDeSeteDiasAmazon(contaAtual ?? null);

  /**
   * O FUNDO DA TELA, NA MESMA PECA DO MERCADO LIVRE (13/09/2026).
   *
   * ⚠️ ATE AQUI A AMAZON TINHA BLOCOS PROPRIOS — dois `<Panel>`
   * brancos ("Estoque critico" e "Pedidos recentes") e o saldo solto — enquanto
   * o Mercado Livre ja renderizava `PainelV3Baixo`. As duas telas mostravam as
   * MESMAS coisas com molduras diferentes, e foi isso que ela viu: *"NAO ESTA
   * IGUAL"*.
   *
   * A peca aceita `null` em cada bloco e simplesmente nao o desenha — por isso
   * `catalogo` e `promocoes` saem vazios: sao do Mercado Livre (Raio X e
   * promocoes bancadas pelo canal) e a Amazon nao tem equivalente. Ausencia
   * aqui e ausencia de verdade, nao bloco vazio na tela.
   *
   * ⚠️ `anuncios` FICA `null` DE PROPOSITO, e nao por falta: a
   * Amazon mantem `AnunciosPorProduto`, que e MAIS rico — leva os cartoes de
   * eficiencia (ACOS, TACOS, ROI) que a versao do Mercado Livre nao tem.
   * Trocar por igualdade visual apagaria numero da tela.
   */
  const semMoeda = (n: number) => money(n, currency).replace(/^R\$\s*/, "");
  const ultimosPedidos = [...profitability]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 5)
    .map((l) => ({
      id: l.id,
      produto: l.product,
      detalhe: [l.sku, `${l.quantity} un`, brDate(l.date)].filter(Boolean).join(" · "),
      pedido: "#…" + String(l.orderId).slice(-6),
      logistica: l.fulfillment ?? "—",
      // ⚠️ `revenueKnown === false`, E NAO `revenue == null` — a
      // diferenca entre copiar e replicar. No Mercado Livre a venda ausente
      // chega como `null`; na Amazon ela chega como ZERO com a bandeira
      // `revenueKnown: false`, porque o pedido `Pending` vem sem `ItemPrice`.
      // Copiar a linha do ML ao pe da letra faria o pendente exibir "0,00" de
      // novo — o mesmo defeito que ela viu em producao em 12/09/2026.
      venda: l.revenueKnown === false || l.revenue == null ? "—" : semMoeda(l.revenue),
      tarifa: l.marketplaceFees == null ? "—" : semMoeda(l.marketplaceFees),
      frete: l.sellerShipping == null || l.sellerShipping === 0 ? "—" : semMoeda(l.sellerShipping),
      custo: l.productCost == null ? "—" : semMoeda(l.productCost),
      custoVazio: l.productCost == null,
      imposto: l.tax == null ? "—" : semMoeda(l.tax),
      impostoVazio: l.tax == null,
      margemPct: l.marginPct,
    }));

  const dadosV3Baixo: DadosV3Baixo = {
    catalogo: null,
    promocoes: null,
    revisar: {
      linhas: ultimosPedidos,
      href: "/amazon/monitor",
      vazio: "Nenhum pedido no período.",
      escopo: scopeSentence(profitabilityScope),
    },
    /**
     * ANUNCIOS PAGOS — o mesmo bloco do Mercado Livre (13/09/2026).
     *
     * ⚠️ NASCEU `null` E ESTAVA ERRADO. Eu justifiquei a ausencia
     * dizendo que `AnunciosPorProduto` (que a Amazon tambem renderiza) e mais
     * rico, por levar os cartoes de ACOS/TACOS/ROI. A justificativa era
     * verdadeira e a conclusao, nao: ela abriu a tela e perguntou *"cade
     * Anuncios pagos?"*. As duas pecas respondem perguntas diferentes — esta
     * lista ANUNCIO POR ANUNCIO com a margem real ao lado; aquela resume a
     * eficiencia do periodo. O Mercado Livre tem as duas conversas.
     *
     * `null` continua valendo para quem NAO tem conta de Ads conectada: bloco
     * vazio prometendo dado que nao existe e pior que bloco ausente.
     */
    anuncios: !profit?.adsConectado || (profit.adsPorProduto ?? []).length === 0 ? null : {
      linhas: (profit.adsPorProduto ?? []).map((a) => ({
        id: a.productId,
        produto: a.title || a.sku || a.productId,
        trafego: `${a.impressions.toLocaleString("pt-BR")} impressões · ${a.clicks.toLocaleString("pt-BR")} cliques`,
        gasto: semMoeda(a.cost),
        vendas: semMoeda(a.sales),
        compras: String(a.purchases),
        // ⚠️ ACOS e ROAS sao `null` quando nao houve venda — divisao
        // por zero nao vira 0%, que afirmaria eficiencia perfeita.
        acos: a.acos == null ? "—" : a.acos.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%",
        roas: a.roas == null ? "—" : a.roas.toLocaleString("pt-BR", { maximumFractionDigits: 2 }),
        semVenda: a.purchases === 0 && a.cost > 0,
        margemPct: a.margemRealPct,
      })),
      resumo: `gasto ${money(profit.ads?.cost ?? 0, currency)}`,
      href: "/amazon/anuncios",
    },
    radar: {
      itens: critical.slice(0, 5).map((r) => ({
        id: r.sellerSku,
        titulo: r.productName || r.sellerSku,
        unidades: r.fulfillable === 0 ? "—" : `${r.fulfillable} un`,
        cobertura: r.status === "out" ? "esgotado" : r.daysRemaining == null ? "—" : `${r.daysRemaining} dias`,
        tom: r.fulfillable === 0 && r.status !== "out" ? "vazio" : tomDaCoberturaAmazon(r.status),
      })),
      href: "/amazon/estoque",
      vazio: "Nenhum SKU em ruptura iminente.",
    },
    /**
     * REPASSES — a MESMA peca compacta do Mercado Livre (13/09/2026).
     *
     * ⚠️ ELA POS AS DUAS TELAS LADO A LADO: no Mercado Livre,
     * uma linha — "Cai na conta ate 13/09", o valor, uma frase de contexto e
     * "Abrir extrato →". Na Amazon, um cartao do tamanho da tela, com duas
     * caixas cinza dentro, a lista das 26 liberacoes e um paragrafo de nota.
     * Mesmo assunto, duas linguagens; a da Amazon era a antiga.
     *
     * ⚠️ A LISTA DE LIBERACOES NAO SE PERDEU — ela mudou de
     * lugar. O detalhe ("quais pagamentos, em que datas") e a pergunta SEGUINTE
     * a este resumo, e mora no extrato: `/amazon/monitor?secao=repasses`, a aba
     * Transacoes. E o mesmo desenho do Mercado Livre, onde o resumo leva ao
     * extrato em vez de o trazer inteiro para o dashboard.
     */
    saldo: saldo ? (
      <EtapaDoCaminhoView
        rotulo={saldo.liberacoes[0] ? `Cai na conta até ${brDate(saldo.liberacoes[0].date)}` : "Cai na conta"}
        valor={money(saldo.retido, saldo.currency)}
        acao={<a className="v3-btn" href="/amazon/monitor?secao=repasses">Abrir extrato →</a>}
        contexto={
          <>
            {/* ⚠️ A REGRA DA AMAZON, NAO A DO MERCADO LIVRE: la o
                dinheiro fica retido no Mercado Pago ate a data de liberacao;
                aqui a Amazon retem ate DEPOIS DA ENTREGA. A frase e a que ja
                estava no cartao antigo — o desenho mudou, o fato nao. */}
            {saldo.liberacoes.length.toLocaleString("pt-BR")} liberação(ões) previstas. A Amazon retém o
            valor de cada venda até depois da entrega.
            {saldo.disponivel != null ? ` Disponível agora: ${money(saldo.disponivel, saldo.currency)}.` : ""}
          </>
        }
      />
    ) : null,
  };
  const pendencias = useAmazonPendencias({ products: products.length, productsLoading, missingCosts: noCost });
  const salesCount = sales?.totalOrders ?? orders?.metrics.totalOrders ?? 0;
  // Ticket e faturamento têm de sair da MESMA base. `revenue`/`salesCount` vêm do
  // orderMetrics (data do pedido, preço de tabela, inclui pendente); o card de
  // Faturamento mostra o conciliado. Misturar os dois exibia R$ 39,80 de
  // faturamento ao lado de um ticket de R$ 21,67 — que é 108,34/5, de um total
  // que não está em lugar nenhum da tela. O ticket real é 39,80/2 = R$ 19,90.
  const vendasConciliadas = profit?.finance.orderCount ?? 0;
  // Quanto dos pedidos recebidos a Amazon ainda não confirmou. As duas bases só
  // podem ser subtraídas no MESMO critério: `revenue` (orderMetrics) é preço de
  // tabela, então o conciliado precisa voltar ao bruto somando o cupom.
  const pedidosAguardando = Math.max(0, salesCount - vendasConciliadas);
  /* ⚠️ A SETA DE TENDENCIA DO FATURAMENTO SAIU DA TELA COM A
     REGUA DE CARTOES (12/09/2026) e NAO tem casa na faixa do periodo: a
     coluna tem rotulo, numero e uma linha de contexto, e a linha ja diz
     quantos pedidos pagos. Registrado como perda para decisao dela — nao
     foi corte por conveniencia. Devolver e uma linha: `getRevenueTrend`
     continua exportado em `Metric`, e a coluna aceitaria o chip no share.
     Ver o relatorio da leva. */

  // Período do filtro vs. histórico já importado (frente K): mês ainda não
  // importado nunca vira cards zerados — "não vendeu" e "não importei" são
  // fatos diferentes.
  const coberturaHistorico = cobertura ? coberturaDoPeriodo({
    periodoDeMs: new Date(cobertura.periodo.from).getTime(),
    periodoAteMs: new Date(cobertura.periodo.to).getTime(),
    coveredFrom: cobertura.sync.coveredFrom,
    status: cobertura.sync.status,
  }) : null;
  if (!loading && coberturaHistorico?.periodoInteiroDescoberto) {
    const desde = coberturaHistorico.cobreDesde ? brDate(new Date(coberturaHistorico.cobreDesde)) : null;
    return (
      <IntegrationDashboardFrame
        className="dashboard-page amazon-dashboard"
        period={<DashboardPeriodFilter {...period.filterProps} onIntent={aquecerAgora} />}
        header={<PageHeader
          eyebrow="Operação Amazon"
          /* ⚠️ "Dashboard Amazon", NAO "Resumo financeiro"
             (13/09/2026). O Mercado Livre diz "Dashboard Mercado Livre" e a
             barra do topo da Amazon ja dizia "Dashboard Amazon" — so o titulo
             da pagina destoava, e as duas telas abriam com nomes diferentes
             para a mesma coisa. Nome diferente para a mesma tela e o que faz o
             produto parecer dois. */
          title="Dashboard Amazon"
          subtitle="Faturamento, pedidos e resultado da sua conta da Amazon."
          icon={pageIcons.dashboard}
          action={<AccountSwitcher appearance="chip" />}
        />}
      >
        <div className="dashboard-sections integration-dashboard-sections">
          <NexoDoDia />
          <EmptyState
            kind="data"
            title={coberturaHistorico.emImportacao ? "Este período ainda está sendo importado" : "Período anterior ao histórico importado"}
            description={coberturaHistorico.emImportacao
              ? `${desde ? `O histórico já cobre a partir de ${desde}. ` : ""}${cobertura?.sync.processedOrders ?? 0} pedido(s) já importado(s) — este período aparece conforme o histórico avança.`
              : `O histórico importado começa em ${desde ?? "—"}. Datas anteriores não foram importadas.`}
          />
        </div>
      </IntegrationDashboardFrame>
    );
  }

  /**
   * ⚠️ OS CARTOES SAO CALCULADOS UMA VEZ, no corpo, e nao
   * dentro do JSX. Dois consumidores leem esta lista — a faixa do periodo e a
   * eficiencia no bloco de anuncios — e duas chamadas do mesmo produtor sao
   * duas verdades esperando divergir no primeiro ajuste.
   */
  const cards = amazonFinancialCards({
          finance: profit?.finance ?? null,
          cogs: profit?.cogs ?? 0,
          estimatedProfit: profit?.estimatedProfit ?? null,
          adsNoLucro: profit?.adsNoLucro ?? null,
          unitsWithoutCost: profit?.unitsWithoutCost ?? 0,
          taxRate: profit?.taxRate ?? null,
          taxes: profit?.taxes ?? null,
          ads: profit?.ads ?? null,
          adsJanela: profit?.adsJanela ?? null,
          adsConectado: profit?.adsConectado ?? false,
          // A base que ela definiu: todos os pedidos do período, pendentes
          // inclusive. `pedidosFeitos` é a Sales API (orderMetrics) — inclui
          // pendente, exclui cancelado, a preço de tabela. É o número que bate
          // com "Vendas hoje até agora" do Seller Central.
          faturamentoTotal: pedidosFeitos?.revenue ?? null,
          pedidosAguardando,
          // A MESMA BASE DO NUMERADOR (31/08/2026). Sem isto a margem volta a
          // sair sobre o apurado e reaparecem os −90,5% / +120,9%.
          //
          // ⚠️ E DESDE 04/09/2026 ELA E A BASE DO RESULTADO, nao o faturamento
          // inteiro: o lucro que o produtor entrega cobre so os pedidos com
          // preco, tarifa e custo conhecidos, e dividir esse numerador pelo
          // faturamento de TODOS deu os 43,7% que a vendedora reprovou contra a
          // planilha dela (16–20%). O faturamento continua no card de
          // Faturamento — o que muda e o denominador da MARGEM.
          baseDoLucro: profit?.baseDoResultado ?? profit?.revenueDoLucro ?? null,
          pedidosCompletos: profit?.pedidosCompletos,
          pedidosSemValor: profit?.pedidosSemValor ?? 0,
          feesDoLucro: profit?.feesDoLucro ?? null,
          pedidosDoPeriodo: profit?.pedidosDoPeriodo ?? 0,
          feesEstimadas: profit?.feesEstimadas ?? null,
          pedidosComTarifaEstimada: profit?.pedidosComTarifaEstimada ?? 0,
          refunds: profit?.refunds ?? 0,
          refundCount: profit?.refundCount ?? 0,
  });

  /**
   * ACOS, TACOS e ROI: a eficiencia do anuncio, que saiu da regua de cartoes
   * e foi para o bloco de anuncios, ao lado das linhas que a explicam. So
   * entra o que TEM numero — card sem valor viraria linha vazia na tela.
   */
  const cardsDaEficiencia = cards
    .filter((c) => ["acos", "tacos", "roiPct"].includes(c.key) && c.raw != null)
    .map((c) => ({ rotulo: c.label, valor: c.value }));

  /**
   * O PAINEL INTEIRO DA AMAZON, no esqueleto do Mercado Livre.
   *
   * Ordem dela em 12/09/2026: *"cara, e replicar a mesma estrutura do mercado
   * livre na amazon"*. A sequencia passa a ser a mesma — faixa, Top 8 + Ritmo
   * lado a lado, o que falta para o numero fechar — e o que este canal tem de
   * proprio entra como DADO, nunca como estrutura paralela.
   */
  const faixaDaAmazon = entradaDaFaixaDosCards(cards, {
    moeda: currency,
    tarifasEstimadas: profit?.feesEstimadas ?? null,
    aliquota: profit?.taxRate ?? null,
    dicaDoFaturamento: legendaFaturamento(faturamento, salesCount),
  });
  // ⚠️ A JANELA, NAO O PERIODO. `sales.points` segue o filtro de
  // data; o titulo do cartao promete sete dias sempre. Ver o hook acima.
  const serieDoRitmo = serieDoBlocoDeLucro({ janelaDeSeteDias: janelaDeSeteDias });
  const diasDoRitmo = diasDoRitmoAmazon(
    serieDoRitmo.map((d) => ({ ...d, profit: d.profit ?? null })),
    {
      metrica: metricaV3,
      moeda: currency,
      hoje: new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }),
      diaDaSemana: (data) =>
        new Date(`${data}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" }).replace(".", ""),
    },
  );
  /**
   * ⚠️ A PARTE CHEIA SO APARECE SE HOUVER LUCRO CONHECIDO EM
   * ALGUM DIA. Sem isso o grafico seria sete contornos — parece defeito, e nao
   * "ainda nao apurado". Quando o produtor comeca a mandar lucro, o verde
   * aparece sozinho, sem tocar em codigo.
   */
  const temLucroNoRitmo = diasDoRitmo.some((d) => d.lucro != null);
  const dadosV3: DadosV3 = {
    periodoLabel: period.label,
    identidadeDoPeriodo: cobertura ? identidadeDePeriodo(cobertura.periodo.from, cobertura.periodo.to) : undefined,
    resumoApuracao:
      !conciliacao || conciliacao.paidOrders === 0
        ? ""
        : conciliacao.complete
          ? `${conciliacao.paidOrders} pedidos apurados`
          : `faltam apurar ${Math.max(0, conciliacao.paidOrders - conciliacao.processedOrders)} de ${conciliacao.paidOrders} pedidos`,
    colunas: colunasDoPeriodoAmazon(faixaDaAmazon),
    margem: margemDoPeriodoAmazon(faixaDaAmazon),
    notaDoImposto: null,
    produtos: produtosDoTopAmazon(top, currency),
    ritmo: {
      metricas: ["Faturamento", "Pedidos", "Unidades"],
      metricaAtiva: metricaV3,
      aoTrocarMetrica: setMetricaV3,
      legendaTotal: metricaV3.toLowerCase(),
      legendaMedia: metricaV3 === "Faturamento" ? "média de lucro do período" : "média de " + metricaV3.toLowerCase() + " por dia",
      mostraLucro: metricaV3 === "Faturamento" && temLucroNoRitmo,
      media: (() => {
        const base = metricaV3 === "Faturamento"
          ? diasDoRitmo.filter((d) => d.lucro != null).map((d) => d.lucro as number)
          : diasDoRitmo.map((d) => d.total);
        return base.length ? base.reduce((soma, v) => soma + v, 0) / base.length : 0;
      })(),
      dias: diasDoRitmo,
      nota: metricaV3 === "Faturamento"
        ? "A parte cheia é o que sobrou do que foi vendido naquele dia. Dia sem apuração fechada fica só com o contorno e não conta na média; dia no vermelho desce abaixo da linha."
        : "Volume por dia, sem valor: serve para ver o ritmo de venda separado do dinheiro.",
    },
    /**
     * As pendencias que viviam na abertura da tela passam para o cartao "O que
     * falta para o numero fechar" — o mesmo lugar do ML. Uma pergunta, um lugar.
     */
    pendencias: [
      ...pendencias.map((p) => ({ id: p.href, titulo: p.label, efeito: "", acao: "Resolver", href: p.href, tom: "atencao" as const })),
      ...(!loading && profit?.taxRate === null
        ? [{ id: "aliquota", titulo: "Cadastrar alíquota", efeito: "Sem ela o lucro sai sem imposto.", acao: "Cadastrar", href: AMAZON_TAX_RATE_HREF, tom: "atencao" as const }]
        : []),
      ...((() => {
        // ⚠️ SAIU DO SUB DA MARGEM E VEIO PARA CA (13/09/2026).
        // E uma falta, e a doutrina dela para falta e esta: dizer O QUE falta,
        // com numero e link, no lugar reservado a isso — nao colada dentro da
        // frase que explica como o numero foi feito.
        const falta = cards.find((c) => c.key === "marginPct")?.faltaOValorDaAmazon;
        return falta
          ? [{ id: "sem-valor", titulo: falta, efeito: "O lucro muda quando a Amazon publicar o valor.", acao: "Ver pedidos", href: "/amazon/monitor", tom: "atencao" as const }]
          : [];
      })()),
      ...(critical.length > 0
        ? [{ id: "estoque", titulo: `${critical.length} produto(s) com estoque crítico`, efeito: "Acaba antes da próxima reposição.", acao: "Ver radar", href: "/amazon/estoque", tom: "neutro" as const }]
        : []),
    ],
    hrefs: { resultado: "/monitor", produtos: "/amazon/anuncios", historico: "/amazon/desempenho", pendencias: "/amazon/anuncios" },
  };

  return (
    <IntegrationDashboardFrame
      className="dashboard-page amazon-dashboard"
      period={<DashboardPeriodFilter
        {...period.filterProps}
        meta={updatedAt ? <>Atualizado às {brTime(updatedAt)}</> : undefined}
      />}
      header={<PageHeader
        eyebrow="Operação Amazon"
        title="Dashboard Amazon"
        subtitle="Faturamento, pedidos e resultado do período selecionado."
        icon={pageIcons.dashboard}
        action={<AccountSwitcher appearance="chip" />}
      />}
    >
      <div className="dashboard-sections integration-dashboard-sections">
      {/* A leitura do NEXO do dia — a MESMA da Visão geral e do Briefing, não uma
          narração própria do canal. Aparece só se já estiver escrita; nenhuma
          tela de canal espera o modelo. */}
      <NexoDoDia />

      {brokenConnection && <ConnectionBroken channel="amazon" message={brokenConnection} />}

      {errors.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          Não foi possível carregar: {errors.join(", ")}.
        </div>
      )}


      {/* ⚠️ A TELA INTEIRA NO ESQUELETO DO MERCADO LIVRE
          (12/09/2026, ordem dela: "replicar a mesma estrutura do mercado livre
          na amazon"). O `PainelV3` e a MESMA peca que o ML monta: faixa do
          periodo, Top 8 produtos e Ritmo lado a lado, e o cartao do que falta
          para o numero fechar. O que este canal tem de proprio — oito colunas,
          tarifa estimada marcada, dia que fecha no vermelho — entra como DADO.

          ⚠️ O QUE ISTO SUBSTITUI SAIU DA TELA, e a lista esta no
          relatorio da leva: a abertura com a frase solta, a tira de indicadores
          complementares, a "Evolucao das vendas" e o donut de repasses. Somar
          em vez de substituir foi o defeito que a v288 do ML cometeu. */}
      <PainelV3 dados={dadosV3} />
      {/* O dashboard conta pela data do PEDIDO; o monitor, pela data do
          LANÇAMENTO. Sem esta linha as duas telas exibiam "hoje" com valores
          diferentes e nenhuma dizia por quê. */}
      {/* Era faixa de largura total para um aviso de PROGRESSO; virou a mesma
          linha discreta do ML, colada na faixa de metricas que ela explica.
          Texto e condicao identicos aos de antes. */}
      <ProgressoDaImportacao
        cobreDesde={coberturaHistorico && !coberturaHistorico.periodoCoberto ? coberturaHistorico.cobreDesde : null}
        emImportacao={coberturaHistorico?.emImportacao}
        pedidosImportados={cobertura?.sync.processedOrders}
      />
      <BaseDeData base="pedido" />




      {/* ⚠️ AQUI MORAVAM TRES BLOCOS PROPRIOS DA AMAZON: o saldo
          solto, e dois `<Panel>` brancos lado a lado — "Estoque critico" e
          "Pedidos recentes". Eles mostravam o MESMO que o Mercado Livre mostra
          em `PainelV3Baixo`, com outra moldura, e era essa a divergencia que
          ela via entre as duas telas (13/09/2026).

          ⚠️ O QUE MUDA DE CONTEUDO, para quem for reverter saber:
          "Pedidos recentes" listava numero do pedido, data, status e o total —
          quatro campos. A linha do `revisar` leva onze: produto, SKU,
          quantidade, logistica, venda, tarifa, frete, custo, imposto e margem.
          Nao se perdeu coluna nenhuma; o numero do pedido continua, abreviado. */}
      <PainelV3Baixo canal={CANAL_AMAZON} dados={dadosV3Baixo} />

      {/* Anúncio contra margem real — o cruzamento que nenhum painel de canal
          faz, porque só nós temos o custo do produto e as tarifas. Só aparece
          com conta de Ads conectada: sem ela, a seção seria uma promessa vazia. */}
      {profit?.adsConectado && (
        <AnunciosPorProduto
          linhas={profit.adsPorProduto ?? []}
          baseDeProdutos="/amazon/anuncios"
          contabilizadoAte={janelaDoAnuncio(profit.ads, profit.adsJanela)}
          /* ⚠️ ACOS, TACOS e ROI MUDARAM DE LUGAR, nao sairam da
             tela: eram cartoes da regua que a faixa do periodo substituiu, e o
             mapa aprovado os manda para o bloco de anuncios, ao lado das linhas
             que os explicam. Os valores sao os MESMOS cards — nada recalculado
             aqui. */
          eficiencia={cardsDaEficiencia}
        />
      )}

      {/* ⚠️ A TABELA CHEIA DE VENDAS SAIU DAQUI (13/09/2026) e
          mora em `/amazon/monitor`, aba "Rentabilidade por venda" — que e onde
          o Mercado Livre sempre a teve. Ela ficava logo abaixo do bloco
          "Pedidos" do `PainelV3Baixo`, e as duas exibiam as MESMAS vendas: dois
          blocos com o mesmo nome na mesma tela.

          ⚠️ NENHUMA COLUNA SE PERDEU: a previa leva as mesmas
          onze, com as cinco vendas mais recentes, e o link do cabecalho
          ("Ver todos os pedidos") vai para a tabela paginada no monitor. O que
          saiu foi a repeticao, nao o dado. */}

      {/* Atalhos: no desktop a sidebar já cobre; no mobile os cartões ajudam. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:hidden">
        <QuickLink href="/amazon/calculadora" label="Calculadora" desc="Lucro por ASIN" />
        <QuickLink href="/amazon/monitor" label="Monitor" desc="Vendas e financeiro" />
        <QuickLink href="/amazon/estoque" label="Radar" desc="Estoque × velocidade" />
        <QuickLink href="/amazon/anuncios" label="Anúncios" desc="Catálogo e custos por SKU" />
      </div>
      </div>
    </IntegrationDashboardFrame>
  );
}





/**
 * Saldo e liberação. Existe porque o dashboard dizia "lucro R$ 20,04" enquanto o
 * app da Amazon dizia "Fundos disponíveis: −R$ 6,12" — os dois certos, e a
 * pessoa sem entender qual acreditar. A Amazon retém o valor das vendas até
 * depois da entrega, então o saldo só enxerga as despesas até lá.
 */
function SaldoNaAmazon({ saldo }: { saldo: SaldoData }) {
  const [todasLiberacoes, setTodasLiberacoes] = useState(false);
  const proxima = saldo.liberacoes[0];
  const liberacoesVisiveis = todasLiberacoes ? saldo.liberacoes : saldo.liberacoes.slice(0, 6);
  const temMaisLiberacoes = saldo.liberacoes.length > liberacoesVisiveis.length;
  return (
    <section className="saldo-panel" aria-labelledby="saldo-title">
      <div>
        <p className="section-kicker">Saldo na Amazon</p>
        <h2 id="saldo-title" className="mt-1 text-lg font-semibold text-[var(--ink)]">O que você tem hoje</h2>
      </div>
      <div className="saldo-grid">
        <div className={`saldo-card${saldo.seraCobrado ? " is-cobranca" : ""}`}>
          <span>Disponível agora</span>
          {/* Sem extrato devolvido não há saldo a afirmar — R$ 0,00 diria que não
              há nada nem a receber nem a pagar, e isso é um fato, não um vazio. */}
          <strong>{saldo.disponivel == null ? "—" : money(saldo.disponivel, saldo.currency)}</strong>
          <small>
            {saldo.disponivel == null
              ? "Aguardando o extrato da Amazon"
              : saldo.seraCobrado
              ? "Negativo: a Amazon cobra no fechamento do extrato"
              : "Liberado para transferência"}
          </small>
        </div>
        <div className="saldo-card">
          <span>Retido pela Amazon</span>
          <strong>{money(saldo.retido, saldo.currency)}</strong>
          <small>{proxima ? `Primeira liberação em ${brDate(proxima.date)}` : "Nenhuma venda retida"}</small>
        </div>
      </div>
      {saldo.liberacoes.length > 0 && (
        <div className="saldo-liberacoes-wrap">
          <ol className="saldo-liberacoes">
            {liberacoesVisiveis.map((l) => (
              <li key={l.date}>
                <span>{brDate(l.date)}</span>
                <strong>{money(l.amount, saldo.currency)}</strong>
                <small>{l.orderIds.length} {l.orderIds.length === 1 ? "pedido" : "pedidos"}</small>
              </li>
            ))}
          </ol>
          {(temMaisLiberacoes || todasLiberacoes) && (
            <button
              type="button"
              className="saldo-liberacoes-toggle"
              aria-expanded={todasLiberacoes}
              onClick={() => setTodasLiberacoes((atual) => !atual)}
            >
              {todasLiberacoes
                ? "Mostrar apenas as próximas liberações"
                : `Ver todas as ${saldo.liberacoes.length} liberações`}
            </button>
          )}
        </div>
      )}
      <p className="saldo-nota">
        A Amazon retém o valor de cada venda até depois da entrega — por isso o saldo disponível pode
        estar negativo enquanto o lucro do período é positivo.
        {saldo.extratoDesde && ` Extrato aberto desde ${brDate(saldo.extratoDesde)}.`}
      </p>
    </section>
  );
}

function Panel({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="work-panel border-t border-[var(--line-strong)] py-5">
      <div className="mb-3 flex items-center justify-between border-b border-[var(--line)] pb-3">
        <h2 className="text-[13px] font-semibold text-[var(--ink-soft)]">{title}</h2>
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--acao)] hover:gap-1.5 hover:opacity-80"
        >
          {linkLabel}
          <span aria-hidden>→</span>
        </Link>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <EmptyState compact title={String(children)} />;
}

function QuickLink({ href, label, desc }: { href: string; label: string; desc: string }) {
  return (
    <Link
      href={href}
      className="quick-command group flex items-center justify-between border-t border-[var(--line-strong)] py-4"
    >
      <div>
        <p className="text-sm font-semibold text-[var(--ink)]">{label}</p>
        <p className="text-xs text-[var(--ink-muted)]">{desc}</p>
      </div>
      <span className="text-[var(--ink-faint)] transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-[var(--acao)]">
        →
      </span>
    </Link>
  );
}

/**
 * Pendências da Amazon como HOOK, não como bloco.
 *
 * Era um componente que renderizava a própria faixa "Pendências da operação".
 * Quando o `BriefingLead` passou a listar o que exige ação, as duas coisas
 * apareceram na tela dizendo "cadastre o custo de 1 produto" com 60px de
 * distância — a mesma pendência, duas vezes.
 *
 * Devolver a LISTA em vez de renderizar resolve na origem: existe um só lugar
 * que responde "o que precisa de mim?", e quem decide como mostrar é a
 * abertura do painel. O componente `OperationPending` continua no repo e em
 * uso nas telas que ainda não têm abertura própria.
 */
function useAmazonPendencias({ products, productsLoading, missingCosts }: { products: number; productsLoading: boolean; missingCosts: number }): OperationPendingItem[] {
  const [connection, setConnection] = useState<"loading" | "connected" | "missing">("loading");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      // Mesma pergunta que o `AccountSwitcher` faz no cabeçalho, na mesma
      // abertura: as duas idas saíam juntas e voltavam idênticas.
      void buscaCompartilhada("auth/accounts", () => fetch("/api/auth/accounts"))
        .then((res) => readJson(res).then((data) => ({ ok: res.ok, data })))
        .then(({ ok, data }) => setConnection(ok && (data.hasOwnerToken || data.accounts?.length > 0) ? "connected" : "missing"))
        .catch(() => setConnection("missing"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (connection === "loading") return [];

  const items: OperationPendingItem[] = [];
  if (connection === "missing") items.push({ label: "Conectar a conta Amazon", href: "/integracoes" });
  if (connection === "connected" && !productsLoading && products === 0) items.push({ label: "Sincronizar os anúncios da Amazon", href: "/amazon/anuncios" });
  if (products > 0 && missingCosts > 0) items.push({ label: `Cadastrar custo de ${missingCosts} produto(s)`, href: "/amazon/anuncios?custo=missing" });

  return items;
}

/**
 * `useSearchParams` obriga a fronteira de Suspense em rota prerenderizada — a
 * mesma razao do monitor, dos modulos da Shopee e da aba de Ads.
 */
export default function AmazonDashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}
