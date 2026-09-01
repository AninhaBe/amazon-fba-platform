"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { RevenueChart, type DailyPoint } from "../components/RevenueChart";
import { PageHeader, pageIcons } from "../components/PageHeader";
import { DashboardSkeleton, InlineLoading } from "../components/LoadingState";
import { LegendaDeVendas } from "../components/LegendaDeVendas";
import { NexoDoDia } from "../components/NexoDoDia";
import { EmptyState } from "../components/EmptyState";
import { DashboardPeriodFilter, useDashboardPeriod } from "../components/DashboardPeriodFilter";
import { periodoNaUrl } from "../components/periodoNaUrl";
import type { OperationPendingItem } from "../components/OperationPending";
import { Metric as Kpi, CompactMetric, getRevenueTrend } from "../components/Metric";
import { MarcaDeEstimativa } from "../components/MarcaDeEstimativa";
import { amazonFinancialCards, lucroDoPeriodo, diasSemAnuncio, type AmazonAdsInput } from "./amazonFinancialCards";
import { AnimatedNumber, identidadeDePeriodo } from "../components/AnimatedNumber";
import { buscaCompartilhada } from "../components/buscaCompartilhada";
import { OrderProfitabilityTable } from "../components/OrderProfitabilityTable";
import { AnunciosPorProduto, type AnuncioDeProduto } from "../components/AnunciosPorProduto";
import { ConnectionBroken, isBrokenConnection } from "../components/ConnectionBroken";
import { TopProductsRanking } from "../components/TopProductsRanking";
import { buildFinancialComposition, FinancialSummaryPanel } from "../components/FinancialSummaryPanel";
import { sinaisDoResultado } from "../components/oQueFaltaNoResultado";
import { SinaisDoResultado } from "../components/SinaisDoResultado";
import { sinaisSilenciadosPorAlarme } from "../components/hierarquiaDeAvisos";
import { BriefingLead } from "../components/BriefingLead";
import { nomeDaTarifa } from "@/lib/nomeDaTarifa";
import { IntegrationDashboardFrame } from "../components/IntegrationDashboardFrame";
import { marginMetricTone } from "@/lib/marginTone";

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
import { usePrefetchDePeriodos } from "../components/prefetchDePeriodos";
import { SincronizacaoCompleta } from "../components/SincronizacaoCompleta";
import { readJson } from "../../lib/readJson";
import { BaseDeData, ProgressoDaImportacao } from "../components/BaseDeData";

// Faixa de cima: o que resume o RESULTADO. Anuncio entrou aqui em 25/08/2026
// porque virou componente do lucro — deixa-lo so na composicao la embaixo
// esconderia justamente o custo que inverteu o sinal do resultado.
const PRIMARY_FINANCIAL_CARDS = new Set([
  "revenue", "fees", "cogs", "ads", "profit", "marginPct", "acos", "tacos",
]);
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
  revenueDoLucro?: number;
  /** Pedidos que a Amazon ainda não valorizou — fora da base, apontados com número. */
  pedidosSemValor?: number;
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
  /** Faturamento bruto do período — espelha o painel do canal (ADR-020). */
  billing: {
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
  dailySales: Array<{ date: string; revenue: number; orders: number; units: number }>;
  topProducts: Array<{ sku: string; title: string; units: number; revenue: number; marginPct: number | null }>;
  profit: { revenueProcessed: number; revenueDoLucro?: number; pedidosNaBase?: number; pedidosSemValor?: number; feesEstimadas?: number; pedidosComTarifaEstimada?: number; fees: number; cogs: number; estimatedProfit: number | null; taxRate?: number | null; taxes?: number | null; refunds?: number; refundCount?: number; ads?: number | null; unitsWithCost: number; unitsWithoutCost: number; skusWithoutCost: number; coverage?: { processedOrders: number; paidOrders: number; complete: boolean } };
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
  faturamento: DashboardPayload["billing"] | null;
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
  // Faturamento do período — o MESMO número que a central mostra. Antes o card
  // exibia a receita conciliada (subconjunto), e por isso três telas do produto
  // mostravam três valores diferentes de "faturamento" (20/08/2026).
  const [faturamentoBruto, setFaturamento] = useState<DashboardPayload["billing"] | null>(initialDash?.faturamento ?? null);
  // O número que ela confere contra o Seller Central. Sem ele na tela, a conta
  // era feita à mão — e foi assim que apareceram os defeitos de 21/08.
  const [pedidosFeitosBruto, setPedidosFeitos] = useState<PedidosFeitosData | null>(initialDash?.pedidosFeitos ?? null);
  // Canceladas entram no bruto (ADR-020); mostrar à parte é o que impede o número
  // de parecer inflado sem explicação — o ML já fazia, a Amazon não tinha.
  const [canceladasBrutas, setCanceladas] = useState<CanceladasData | null>(initialDash?.canceladas ?? null);
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
  const canceladas = naMao ? canceladasBrutas : cacheDoPeriodo?.canceladas ?? null;
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
        pedidosSemValor: payload.profit.pedidosSemValor,
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
      next.faturamento = payload.billing ?? null; setFaturamento(next.faturamento);
      next.pedidosFeitos = payload.ordered ?? null; setPedidosFeitos(next.pedidosFeitos);
      next.canceladas = payload.cancelled ?? null; setCanceladas(next.canceladas);
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
  const pendencias = useAmazonPendencias({ products: products.length, productsLoading, missingCosts: noCost });
  // Faturamento/vendas/unidades pela Sales API (data do pedido) = Seller Central.
  const revenue = sales?.totalRevenue ?? orders?.metrics.totalRevenue ?? 0;
  const salesCount = sales?.totalOrders ?? orders?.metrics.totalOrders ?? 0;
  const unitsCount = sales?.totalUnits ?? 0;
  // ⚠️ `?? 0` só para o ROI abaixo, que é indicador secundário: lucro ausente
  // vira ROI 0%, e o card de lucro (a autoridade) já mostra "—" nesse caso.
  const estProfit = profit?.estimatedProfit ?? 0;
  const cogs = profit?.cogs ?? 0;
  const missingCostUnits = profit?.unitsWithoutCost ?? 0;
  const costsIncomplete = missingCostUnits > 0;
  // ⚠️ 30/08/2026 — custo faltando virou SINAL, nao trava (decisao da
  // vendedora). `costsIncomplete` segue vivo para o CARD de custo e para o selo
  // do painel; o que ele nao faz mais e apagar lucro, margem e ROI.
  const sinais = sinaisDoResultado({
    skusWithoutCost: profit?.skusWithoutCost ?? 0,
    hrefDeCustos: "/amazon/produtos",
  });
  // FONTE ÚNICA do lucro desta tela — a MESMA função que a faixa de cards usa.
  // A rosca de composição e a cascata escrita abaixo dela leem as duas daqui.
  // Ver `lucroDoPeriodo`: três superfícies mostravam este número, e enquanto
  // cada uma fazia a própria subtração, cada conserto alcançava só a cópia que
  // alguém tinha visto.
  const anuncio = lucroDoPeriodo({
    estimatedProfit: profit?.estimatedProfit ?? null,
    adsNoLucro: profit?.adsNoLucro ?? null,
  });
  const anuncioNoLucro = anuncio.gastoComAnuncio || null;
  // Sem subtração aqui, DE PROPÓSITO — e desde 30/08/2026 nem aqui nem no card:
  // o anúncio já saiu do lucro em `profit.ts`, sob a fronteira de
  // `src/lib/financialMath.ts`. A tela mostra o que foi descontado; subtrair
  // outra vez contaria o mesmo dinheiro duas vezes.
  const lucroComAnuncio = anuncio.lucro;
  /** Cupom resgatado pelo comprador — já abatido de `revenue` pela camada financeira. */
  const promocoes = profit?.finance.promotions ?? 0;
  // O financeiro vem das transações, que a Amazon posta na data de POSTAGEM —
  // uma venda recém-feita já conta no faturamento e ainda não tem repasse.
  // Repasse ausente é desconhecido, não zero: exibir "R$ 0,00 / 0,0% de margem"
  // afirmaria que a venda não deu lucro.
  const hasFinance =
    !!profit &&
    (profit.finance.orderCount > 0 ||
      profit.finance.units > 0 ||
      (profit.finance.netProceeds ?? 0) !== 0 ||
      (profit.finance.fees ?? 0) !== 0 ||
      profit.finance.refunds !== 0);
  // Ticket e faturamento têm de sair da MESMA base. `revenue`/`salesCount` vêm do
  // orderMetrics (data do pedido, preço de tabela, inclui pendente); o card de
  // Faturamento mostra o conciliado. Misturar os dois exibia R$ 39,80 de
  // faturamento ao lado de um ticket de R$ 21,67 — que é 108,34/5, de um total
  // que não está em lugar nenhum da tela. O ticket real é 39,80/2 = R$ 19,90.
  const vendasConciliadas = profit?.finance.orderCount ?? 0;
  const faturamentoConciliado = profit?.finance.revenue ?? 0;
  // Decisão dela (22/08): sem base, o cartão mostra R$ 0,00 em vez de "—".
  // Antes disso, porém, tenta o número REAL: quando ainda não há venda conciliada
  // mas o período tem faturamento (pendente com valor de tabela), o ticket existe
  // e é faturamento ÷ vendas — mostrar zero ali seria esconder um número que temos.
  // ⚠️ O SEGUNDO RAMO DIVIDIA UMA RECEITA PARCIAL POR TODAS AS VENDAS
  // (01/09/2026). Ele usava `faturamento.revenue` — o campo `billing`, que só
  // soma pedido com valor JÁ publicado pela Amazon — sobre `salesCount`, que
  // conta TODOS os pedidos. Numerador de um conjunto, denominador de outro: a
  // mesma família da base misturada, agora no ticket.
  //
  // Medido às 12:22 na Silveiras Import: R$ 12,89 (de 1 pedido com valor) ÷ 19
  // vendas = **R$ 0,68**, ao lado de um Faturamento de R$ 348,07. O ticket real
  // era 348,07 ÷ 19 = R$ 18,32.
  //
  // A base do ticket passa a ser a MESMA do card de Faturamento — o
  // `orderMetrics`, que cobre todos os pedidos e é o que bate com o Seller
  // Central. `billing` não serve para isto e não deve ser lido aqui.
  const faturamentoDaTela = pedidosFeitos?.revenue ?? null;
  const ticketMedio =
    vendasConciliadas > 0
      ? faturamentoConciliado / vendasConciliadas
      : (faturamentoDaTela ?? 0) > 0 && salesCount > 0
        ? (faturamentoDaTela ?? 0) / salesCount
        : 0;
  // Quanto dos pedidos recebidos a Amazon ainda não confirmou. As duas bases só
  // podem ser subtraídas no MESMO critério: `revenue` (orderMetrics) é preço de
  // tabela, então o conciliado precisa voltar ao bruto somando o cupom.
  const pedidosAguardando = Math.max(0, salesCount - vendasConciliadas);
  const valorAguardando = Math.max(0, revenue - (faturamentoConciliado + promocoes));
  const roiPct = cogs > 0 ? (estProfit / cogs) * 100 : 0;
  const revenueTrend = getRevenueTrend(sales?.points ?? []);

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
          title="Resumo financeiro"
          subtitle="Faturamento, pedidos e resultado do período selecionado."
          icon={pageIcons.dashboard}
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

  return (
    <IntegrationDashboardFrame
      className="dashboard-page amazon-dashboard"
      period={<DashboardPeriodFilter
        {...period.filterProps}
        meta={updatedAt ? <>Atualizado às {brTime(updatedAt)}</> : undefined}
      />}
      header={<PageHeader
        eyebrow="Operação Amazon"
        title="Resumo financeiro"
        subtitle="Faturamento, pedidos e resultado do período selecionado."
        icon={pageIcons.dashboard}
      />}
    >
      <div className="dashboard-sections integration-dashboard-sections">
      {/* A leitura do NEXO do dia — a MESMA da Visão geral e do Briefing, não uma
          narração própria do canal. Aparece só se já estiver escrita; nenhuma
          tela de canal espera o modelo. */}
      <NexoDoDia />
      {/* A leitura executiva abre todos os canais antes das métricas. */}
      <BriefingLead
        periodo={period.label}
        janela={period.query}
                // ⚠️ A FRASE LE A MESMA BASE DO CARD (01/09/2026). Ela lia o `billing`,
        // que so soma pedido com valor ja publicado: as 12:22 disse "R$ 12,89
        // hoje" com o card ao lado em R$ 348,07 e o Seller Central em R$ 348.
        // Texto e card discordando na mesma tela e o defeito que a vendedora
        // detecta primeiro — e o que ela cobrou.
        faturamento={faturamentoDaTela}
        pedidos={salesCount}
        /**
         * ⚠️ A FRASE NAO AFIRMA LUCRO QUE A TELA NAO MOSTRA (01/09/2026).
         *
         * Achado num print dela das 11:38: os cards de Faturamento, Ads, Custo,
         * Repasse e Margem estavam TODOS em branco — porque `profit.finance`
         * veio `null`, e e dele que os cards saem — e a frase do topo dizia
         * "15 vendas e R$ 12,89 hoje — sobraram R$ 234,71".
         *
         * Duas mentiras na mesma linha:
         *   • afirmava LUCRO numa tela onde o lucro esta em branco;
         *   • afirmava um lucro MAIOR que o faturamento que ela acabara de
         *     dizer — 234,71 sobre 12,89 —, porque os dois numeros vem de
         *     universos diferentes: `billing.revenue` e `profit.estimatedProfit`.
         *
         * A frase e o fallback calculado (`montarFrase`), nao a narracao do
         * modelo. Ela ja tem o ramo certo para isto: sem lucro, escreve "quanto
         * sobrou ainda nao da para dizer — falta custo ou tarifa". O que faltava
         * era CAIR nele quando a base financeira nao existe.
         *
         * Amarrar a frase a MESMA condicao dos cards e o que impede os dois de
         * discordarem de novo: sem `finance`, nem card nem frase afirmam lucro.
         */
        lucro={profit?.finance ? profit?.estimatedProfit ?? null : null}
        loading={loading}
        format={(v) => money(v, currency)}
        escopo="amazon"
        canalNome="Amazon"
        moeda={currency}
        briefingHref="/amazon/briefing"
        // Uma pergunta, um lugar. As pendências de conta e de sincronização
        // vêm do hook; estoque crítico vem do radar já carregado nesta tela.
        acoes={[
          ...pendencias.map((p) => ({ ...p, tone: "pendencia" as const })),
          ...(!loading && profit?.taxRate === null
            ? [{ label: "Cadastrar alíquota", href: AMAZON_TAX_RATE_HREF, tone: "pendencia" as const }]
            : []),
          ...(critical.length > 0
            ? [{ label: `${critical.length} produto(s) com estoque crítico`, href: "/amazon/estoque", tone: "alerta" as const }]
            : []),
        ]}
      />

      {brokenConnection && <ConnectionBroken channel="amazon" message={brokenConnection} />}

      {errors.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          Não foi possível carregar: {errors.join(", ")}.
        </div>
      )}

      {cobertura && (
        <SincronizacaoCompleta
          connectionId={cobertura.sync.connectionId}
          status={cobertura.sync.status}
          coveredFrom={cobertura.sync.coveredFrom}
        />
      )}

      {/* A primeira faixa contém somente os indicadores que resumem o resultado.
          O detalhamento continua abaixo, na composição financeira, sem perder
          nenhuma distinção entre zero e dado ainda desconhecido. */}
      {(() => {
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
          baseDoLucro: profit?.revenueDoLucro ?? null,
          pedidosSemValor: profit?.pedidosSemValor ?? 0,
          feesEstimadas: profit?.feesEstimadas ?? null,
          pedidosComTarifaEstimada: profit?.pedidosComTarifaEstimada ?? 0,
          refunds: profit?.refunds ?? 0,
          refundCount: profit?.refundCount ?? 0,
        });
        const margem = cards.find((c) => c.key === "marginPct");
        const primaryCards = cards.filter((card) => PRIMARY_FINANCIAL_CARDS.has(card.key));
        return (
          <div className="metric-grid" aria-label="Resumo financeiro da Amazon">
            {primaryCards.map((card) =>
              // O bloco de lucro era markup próprio: rótulo 11px maiúsculo,
              // valor 27px e um fundo verde, tudo escrito à mão dentro desta
              // página. Numa faixa contínua ele virava um bloco colorido no
              // meio de nada, e o `overflow: hidden` sobre 132px de largura
              // CORTAVA o valor no meio ("R$ 222,9").
              //
              // Agora usa o `Metric` como todos os outros. O lucro continua se
              // distinguindo — pela cor do número (`tone="positive"`), que é
              // informação, e não pelo fundo, que era decoração.
              card.key === "profit" ? (
                <Kpi
                  key={card.key}
                  label={card.raw == null ? "Repasse líquido" : "Lucro"}
                  tone={card.tone}
                  loading={loading}
                  value={card.raw != null
                    ? <AnimatedNumber periodo={cobertura ? identidadeDePeriodo(cobertura.periodo.from, cobertura.periodo.to) : undefined} id="amz-profit" value={card.raw} format={(amount) => money(amount, currency)} />
                    : card.value}
                  // O texto explicativo saiu de baixo do número e foi para o
                  // "i", a pedido dela em 24/08/2026: "todos esses textos que
                  // estão embaixo... pode colocar no i igual está em pedidos
                  // feitos". O card fica com rótulo e valor; a explicação
                  // aparece ao passar o mouse.
                  // ⚠️ A BASE VAI EM `sub`, QUE RENDERIZA SEM INTERAÇÃO.
                  //
                  // Ela morava só no "i", e em 31/08/2026 a vendedora viu lucro
                  // e margem calculados sobre R$ 748,56 ao lado de um card de
                  // Faturamento de R$ 1.068,37 e concluiu — com razão — que
                  // estava errado. A explicação existia, dentro de um tooltip
                  // que ninguém abre. Declaração que exige hover não declara.
                  sub={card.baseDeclarada}
                  info={card.value === "—" || margem?.value === "—"
                    ? card.context
                    : `${card.context}. Margem de ${margem?.value} sobre vendas.`}
                />
              ) : (
                <Kpi
                  key={card.key}
                  label={card.label}
                  // UMA LINHA POR CARD NA FACE, e quem decide qual e o
                  // construtor (`amazonFinancialCards`): o Faturamento recebe o
                  // cupom ja abatido, os demais recebem a base declarada.
                  sub={card.baseDeclarada}
                  // A marca da ADR-027, colada ao numero. So aparece quando o
                  // construtor disse que ha estimativa embutida — sem pedido
                  // estimado o campo vem `undefined` e o cartao fica igual ao
                  // que era.
                  marca={card.marcaEstimativa ? <MarcaDeEstimativa procedencia={card.marcaEstimativa} /> : undefined}
                  // ⚠️ O CARD NÃO É MAIS SOBRESCRITO AQUI (30/08/2026).
                  //
                  // Esta linha trocava o VALOR do card "Faturamento" mantendo o
                  // RÓTULO, enquanto a margem seguia sendo calculada sobre a base
                  // apurada, dentro de `amazonFinancialCards`. Resultado: lucro e
                  // margem de um universo exibidos ao lado do faturamento de
                  // outro, e a conta não fechava para quem olhasse — foi assim
                  // que ela achou uma "margem de 63,1%" que nenhum par de números
                  // da tela produzia.
                  //
                  // Agora a base entra POR PARÂMETRO (`faturamentoTotal`) e o
                  // módulo dos cards decide o número e declara a base na margem.
                  // Sobrescrever valor de card na renderização é como a conta
                  // volta a ter duas definições.
                  value={loading ? "…" : card.key === "revenue" && card.raw != null
                    ? <AnimatedNumber periodo={cobertura ? identidadeDePeriodo(cobertura.periodo.from, cobertura.periodo.to) : undefined} id="amz-revenue" value={card.raw} format={(amount) => money(amount, currency)} />
                    : card.value}
                  // TUDO que explicava o número embaixo dele agora mora no "i".
                  // O card mostra rótulo e valor; a explicação aparece ao passar
                  // o mouse, como já acontecia em "Pedidos feitos".
                  //
                  // ⚠️ No faturamento, a explicação tem de acompanhar a base do
                  // VALOR. O valor soma só quem tem `gross`; a contagem inclui
                  // pendente sem valor — emparelhar os dois produzia
                  // "R$ 0,00 · 1 pedido", que se contradiz na própria linha
                  // (22/08/2026). Quando há pedido sem valor, o texto DIZ isso
                  // em vez de fingir coerência.
                  info={card.key === "revenue" ? legendaFaturamento(faturamento, salesCount) : card.context}
                  trend={card.key === "revenue" ? revenueTrend : undefined}
                  tone={card.key === "marginPct" ? marginMetricTone(card.raw) : card.tone}
                  loading={loading}
                />
              )
            )}
          </div>
        );
      })()}
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

      {/* Indicadores de contexto: uma faixa, não uma segunda parede de cartões. */}
      <div className="secondary-metrics" aria-label="Indicadores complementares">
        {/*
          Os dois números lado a lado, cada um com nome próprio.
          "Confirmado" é o que o comprador já pagou; "Pedidos feitos" é o que a
          Sales API conta — pendente entra, cancelado não, e a preço de tabela.
          Antes a tela mostrava só o primeiro, sem dizer que era só o primeiro — e
          conferir a diferença exigia somar pedido a pedido no painel da Amazon.
        */}
        <CompactMetric
          label="Pedidos feitos"
          value={
            pedidosFeitos
              ? `${money(pedidosFeitos.revenue, currency)} · ${pedidosFeitos.orders}`
              : "—"
          }
          // ⚠️ NA FACE, NÃO NO "i" (31/08/2026). Esta frase distingue DUAS
          // receitas que convivem na mesma tela: "Pedidos feitos" vem a preço de
          // tabela e "Faturamento" é o que o comprador pagou. Quem não lê isso
          // conclui que um dos dois está errado — e foi o que aconteceu.
          hint={pedidosFeitos ? "Preço de tabela, antes do cupom — é o número do Seller Central." : undefined}
          loading={loading}
        />
        {/*
          CUPOM — a ponte entre os dois números acima. "Pedidos feitos" vem a
          preço de tabela e "Faturamento" é o que o comprador pagou; sem esta
          linha a diferença ficava sem nome na tela e ela conferia à mão contra o
          Seller Central (22/08: R$ 449,94 lá contra R$ 455,01 aqui, em 15 dias).
          Só aparece quando houve cupom — período sem resgate não ganha um card
          de R$ 0,00 ocupando a faixa.
        */}
        {(faturamento?.coupon ?? 0) > 0 && (
          <CompactMetric
            label="Cupom resgatado"
            value={`− ${money(faturamento?.coupon ?? 0, currency)}`}
            // Fecha a conta na tela: este é EXATAMENTE o valor que separa
            // "Pedidos feitos" de "Faturamento". Sem dizer isso, o número fica
            // solto e a pessoa não liga um card ao outro.
            // Só afirma a igualdade quando ela SE SUSTENTA: numa conta com
            // pedidos sem preço de tabela, este valor é piso, não a diferença.
            // ⚠️ UMA LINHA NA FACE, E É A QUE MUDA A LEITURA.
            //
            // "Pode haver mais" é ressalva de COBERTURA: sem ela a pessoa toma
            // um piso por um total. Ela vai na face. Já "a diferença entre
            // Pedidos feitos e Faturamento" só explica o que o número é, sem
            // mudar como ele é lido — essa continua no "i".
            hint={faturamento?.couponPartial
              ? "Apurado só nos pedidos com preço de tabela importado — pode haver mais."
              : undefined}
            info={faturamento?.couponPartial ? undefined : "A diferença entre Pedidos feitos e Faturamento."}
            loading={loading}
          />
        )}
        <CompactMetric label="Vendas" value={String(salesCount)} loading={loading} />
        <CompactMetric label="Unidades" value={String(unitsCount)} loading={loading} />
        <CompactMetric label="Ticket médio" value={money(ticketMedio, currency)} loading={loading} />
        <CompactMetric
          label="ROI"
          value={`${roiPct.toFixed(1)}%`}
          tone={cogs > 0 ? (roiPct > 0 ? "positive" : roiPct < 0 ? "danger" : "default") : "default"}
          loading={loading}
        />
        <CompactMetric
          label="Canceladas"
          // A Amazon ZERA o pedido ao cancelar — some o OrderTotal, some a
          // quantidade, some do orderMetrics. Testado nas quatro fontes em
          // 22/08/2026. O valor só existe se foi capturado antes (migrations/0010,
          // relatório ALL_ORDERS, que é a única fonte que precifica pendente).
          //
          // Daí os três estados, e o do meio é o que quase virou bug: com 160
          // cancelados e 1 com valor, exibir só a soma afirmaria que os 160
          // custaram R$ 89,70. Cobertura parcial tem que aparecer como parcial.
          // SEM cancelamento no período, R$ 0,00 é FATO — "não houve" — e é o que
          // ela pediu ver (22/08). O "—" ali sugeria "não sei", que é pior.
          // Só continua desconhecido quando EXISTE cancelado e a Amazon não
          // informou o valor de nenhum deles: aí zero seria afirmar que cancelar
          // não custou nada, e isso a legenda abaixo explica.
          value={
            !canceladas || canceladas.orders === 0
              ? money(0, currency)
              : canceladas.revenue === null
                ? "—"
                : money(canceladas.revenue, currency)
          }
          tone={canceladas && canceladas.orders > 0 ? "danger" : "default"}
          loading={loading}
        />
      </div>

      {/* Uma única superfície explica desempenho e composição financeira. */}
      <section className="performance-panel">
        <div className="performance-chart">
          <div className="mb-2 flex items-baseline justify-between gap-4">
            <div>
              <p className="section-kicker">Desempenho diário</p>
              {/* NÃO chamar de "faturamento": este total é o orderMetrics (data do
                  pedido, preço de tabela, inclui pendente) e é maior que o card
                  de Faturamento, que mostra o conciliado. Dois números com o
                  mesmo nome na mesma tela era o que confundia. */}
              <h2 className="mt-1 text-lg font-semibold text-[var(--ink)]">Evolução das vendas</h2>
            </div>
            <span className="text-sm font-semibold tabular-nums text-[var(--ink)]">
              {money(revenue, currency)}{" "}
              <span className="font-normal text-[var(--ink-muted)]">
                {pedidosFeitos ? "em pedidos recebidos" : "confirmado (pedidos recebidos indisponível)"}
              </span>
            </span>
          </div>
          {/* Regras e armadilhas moram no componente — ele é o mesmo nos quatro
              canais. O que é da Amazon é só a `nota`. */}
          {!loading && (
            <LegendaDeVendas
              confirmados={{ pedidos: vendasConciliadas, valor: faturamentoConciliado }}
              aguardando={{ pedidos: pedidosAguardando, valor: valorAguardando }}
              cancelados={{ pedidos: canceladas?.orders ?? 0 }}
              nota="A Amazon confirma o pagamento antes de informar o valor, e só libera o repasse depois da entrega."
              money={(valor) => money(valor, currency)}
            />
          )}
          {loading ? (
            <span className="skeleton-chart" role="status" aria-label="Carregando evolução das vendas" />
          ) : (
            <RevenueChart points={sales?.points ?? []} currency={currency} explorable />
          )}
        </div>

        <FinancialSummaryPanel
          // Anúncio desconhecido também deixa a composição incompleta: selo
          // verde em cima de lucro "—" foi o par exato que enganou antes.
          complete={!costsIncomplete && !anuncio.desconhecido && conciliacao?.complete !== false}
          labelledBy="amazon-financial-summary-title"
          description={(
            <>
              <span>Base dos repasses da Amazon (data de postagem) — difere do faturamento acima, que segue a data do pedido como o Seller Central.</span>
              {conciliacao && !conciliacao.complete ? (
                <span className="mt-2 block rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                  {conciliacao.paidOrders - conciliacao.processedOrders} pedido(s) ainda sem repasse postado pela Amazon. Os valores desta seção sobem conforme ela posta.
                </span>
              ) : null}
            </>
          )}
          total={loading ? 0 : faturamentoConciliado}
          totalLabel="Faturamento conciliado"
          format={(value) => money(value, currency)}
          slices={buildFinancialComposition({
            total: faturamentoConciliado,
            costs: [
              ...(profit?.finance.feeBreakdown ?? []).map((fee) => ({ id: fee.type, label: nomeDaTarifa(fee.type), value: fee.amount })),
              // ⚠️ O MESMO tudo-ou-nada da Shopee, achado no mesmo dia (29/08/2026):
              // `costsIncomplete ? null` some com o custo INTEIRO por causa das
              // unidades sem cadastro. A soma das que TÊM custo é fato, e a
              // pendência já aparece nomeada com número e link no rodapé.
              // Lucro e margem seguem esperando — `result` abaixo continua com o
              // portão, porque lucro com custo incompleto é otimista sem aviso.
              { id: "cogs", label: "Custo dos produtos", value: profit?.cogs },
              // ⚠️ ANÚNCIO ENTRA NA COMPOSIÇÃO (29/08/2026). Ele não é repasse da
              // Amazon, e era por isso que estava fora — mas o painel não mostra
              // "repasses", mostra COMO O FATURAMENTO VIRA LUCRO, e anúncio sai
              // do bolso dela no meio desse caminho.
              //
              // Sem esta fatia a tela exibia DOIS números chamados lucro com
              // sinais opostos: −R$ 35,61 na faixa e +R$ 365,53 aqui, e a
              // diferença era a MAIOR despesa do período. Ver ADR-025.
              { id: "ads", label: "Anúncios", value: anuncioNoLucro },
            ],
            // O MESMO lucro da faixa, pela MESMA função. Duas cópias da conta
            // foi o que deixou uma para trás quando a decisão dela de 25/08 foi
            // aplicada só ao card.
            result: lucroComAnuncio,
          })}
          empty={!loading && !hasFinance ? (
            // Sem transação postada não há cascata: zerar receita, taxas e lucro
            // faria a tela afirmar que a venda não rendeu nada.
            <p className="text-sm leading-relaxed text-[var(--ink-muted)]">
              A Amazon ainda não postou repasse deste período. As vendas já aparecem no faturamento
              (data do pedido); taxas e lucro entram aqui quando o pedido é postado e liquidado.
            </p>
          ) : undefined}
        >
              {/* O cupom é dedução de verdade — sai do bolso dela e merece o "−",
                  como qualquer custo. Mas `revenue` já vem líquido dele, então
                  descontá-lo do líquido contaria duas vezes. A cascata parte do
                  preço de tabela, desconta, e FECHA num subtotal igual ao card
                  de Faturamento — a ponte que faltava entre os dois números. */}
              {promocoes > 0 ? (
                <>
                  <Flow label="Faturamento (preço de tabela)" value={loading ? "…" : money(faturamentoConciliado + promocoes, currency)} />
                  <Flow label="Cupons e promoções" value={loading ? "…" : money(promocoes, currency)} muted sign="−" />
                  <Flow label="Faturamento líquido" value={loading ? "…" : money(faturamentoConciliado, currency)} subtotal sign="=" />
                </>
              ) : (
                <Flow label="Faturamento" value={loading ? "…" : money(faturamentoConciliado, currency)} />
              )}
              <Flow label="Taxas Amazon" value={loading ? "…" : money(profit?.finance.fees ?? 0, currency)} muted sign="−" />
              {!loading && (profit?.finance.feeBreakdown ?? []).map((t) => (
                <Flow key={t.type} label={nomeDaTarifa(t.type)} value={money(t.amount, currency)} detail muted />
              ))}
              <Flow label="Custo dos produtos" value={loading ? "…" : money(profit?.cogs ?? 0, currency)} muted sign="−" />
              {/* ⚠️ A CASCATA TAMBÉM DESCONTA O ANÚNCIO (29/08/2026).
                  Era a TERCEIRA cópia da conta de lucro na mesma tela: a faixa
                  já descontava o Ads desde 25/08, a rosca passou a descontar
                  hoje, e estas linhas ainda fechavam no número antigo — maior e
                  positivo. Agora as três leem o MESMO `lucroDoPeriodo` —
                  nenhuma delas refaz a subtração por conta própria. */}
              {!loading && (anuncioNoLucro != null || anuncio.desconhecido) && (
                <Flow
                  label="Anúncios"
                  value={anuncio.desconhecido ? "—" : money(anuncioNoLucro ?? 0, currency)}
                  muted
                  sign="−"
                />
              )}
              <Flow
                label={lucroComAnuncio == null ? "Repasse líquido" : "Lucro estimado"}
                value={loading ? "…" : lucroComAnuncio == null ? "—" : money(lucroComAnuncio, currency)}
                accent
                tone={loading || lucroComAnuncio == null
                  ? "default"
                  : lucroComAnuncio > 0
                    ? "positive"
                    : lucroComAnuncio < 0
                      ? "danger"
                      : "default"}
                sign="="
              />
              {/* Gasto de anúncio desconhecido não vira zero: sem ele, o lucro e
                  a margem são "—" e a tela diz o que falta, com o link. */}
              {!loading && anuncio.desconhecido && (
                <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                  Falta a métrica de gasto do Amazon Ads deste período — lucro e margem entram quando ela sincronizar.{" "}
                  <Link href="/ads" className="underline">Ver Ads</Link>
                </p>
              )}
              {!loading && lucroComAnuncio != null && (profit?.finance.revenue ?? 0) > 0 && (
                <Flow
                  label="Margem"
                  value={`${((lucroComAnuncio / (profit?.finance.revenue || 1)) * 100).toFixed(1).replace(".", ",")}%`}
                  accent
                  tone={marginMetricTone((lucroComAnuncio / (profit?.finance.revenue || 1)) * 100)}
                />
              )}
        </FinancialSummaryPanel>
        {/* ⚠️ OS SINAIS SAIRAM DE DENTRO DO `value` DO FLOW DE MARGEM (01/09/2026).
            Eram o ultimo canal nessa forma: ML, Shopee, o modulo da Shopee e o
            TikTok ja os traziam em bloco proprio. O sinal e do RESULTADO, nao de
            um numero — dentro do `value` ele vira parte do dado. E a Amazon e a
            tela mais olhada, entao e a que mais serve de modelo para copia: era
            daqui que a forma errada ia se espalhar.

            ⚠️ E ELES DEIXARAM DE DEPENDER DO RAMO DA MARGEM. Dentro do `value`
            a condicao era `lucroComAnuncio != null && revenue > 0` — ou seja,
            "3 SKUs sem custo cadastrado" so aparecia quando o lucro JA fechava.
            A pendencia ficava escondida exatamente quando ela e a causa do
            numero que falta. Acoplamento acidental do lugar, nao decisao.

            CORTE 2 DA AUDITORIA: conexao caida cala os sinais. Sem dado,
            "3 SKUs sem custo cadastrado" nao e o problema dela — cadastrar o
            custo nao traz o numero de volta, reconectar traz. Os dois lado a
            lado pedem duas acoes e so uma resolve. Nada some do produto: os
            sinais voltam inteiros quando a conexao volta, porque a condicao e o
            ESTADO da conexao. */}
        {!loading && !sinaisSilenciadosPorAlarme(Boolean(brokenConnection)) && sinais.length > 0 && <SinaisDoResultado sinais={sinais} />}
      </section>

      {/* O ranking ocupa a mesma posição em todos os canais: depois da leitura
          temporal e antes dos módulos operacionais de detalhe. */}
      {productsLoading ? (
        <div className="top-products-loading">
          <InlineLoading label="Carregando produtos com melhor desempenho" />
        </div>
      ) : top.length === 0 ? (
        <div className="top-products-loading"><Empty>Sem vendas no período para ranquear.</Empty></div>
      ) : (
        <TopProductsRanking products={top} currency={currency} productsHref="/amazon/produtos" />
      )}

      {/* Logo abaixo da cascata: é a mesma conversa sobre dinheiro, e responde a
          pergunta que o lucro sozinho deixa no ar — "então cadê?". */}
      {saldo && <SaldoNaAmazon saldo={saldo} />}

      {/* Duas colunas: alertas de estoque + pedidos recentes */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Panel title="Estoque crítico" href="/amazon/estoque" linkLabel="Ver radar">
          {loading ? (
            <InlineLoading label="Carregando estoque crítico" />
          ) : critical.length === 0 ? (
            <Empty>Nenhum SKU em ruptura iminente.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {critical.slice(0, 6).map((r) => (
                <li key={r.sellerSku} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="min-w-0 truncate pr-3">{r.productName || r.sellerSku}</span>
                  <span className="shrink-0 font-semibold text-red-600">
                    {r.status === "out" ? "esgotado" : `${r.daysRemaining} dias`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Pedidos recentes" href="/amazon/monitor?secao=vendas" linkLabel="Ver todos os pedidos">
          {loading ? (
            <InlineLoading label="Carregando pedidos recentes" />
          ) : !orders || orders.orders.length === 0 ? (
            <Empty>Nenhum pedido no período.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {orders.orders.slice(0, 6).map((o) => (
                <li key={o.amazonOrderId} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs text-[var(--ink-muted)]">
                      {o.amazonOrderId}
                    </span>
                    <span className="text-xs text-[var(--ink-muted)]">
                      {brDate(o.purchaseDate)} · {o.orderStatus}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {o.orderTotal
                      ? money(parseFloat(o.orderTotal.Amount), o.orderTotal.CurrencyCode)
                      : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Anúncio contra margem real — o cruzamento que nenhum painel de canal
          faz, porque só nós temos o custo do produto e as tarifas. Só aparece
          com conta de Ads conectada: sem ela, a seção seria uma promessa vazia. */}
      {profit?.adsConectado && (
        <AnunciosPorProduto
          linhas={profit.adsPorProduto ?? []}
          contabilizadoAte={janelaDoAnuncio(profit.ads, profit.adsJanela)}
        />
      )}

      {/* Rentabilidade por venda — a mesma visão do monitor, direto no dashboard. */}
      <OrderProfitabilityTable
        lines={profitability}
        loading={profitabilityLoading}
        scopeNote={scopeSentence(profitabilityScope)}
        pageSize={6}
      />

      {/* Atalhos: no desktop a sidebar já cobre; no mobile os cartões ajudam. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:hidden">
        <QuickLink href="/amazon/calculadora" label="Calculadora" desc="Lucro por ASIN" />
        <QuickLink href="/amazon/monitor" label="Monitor" desc="Vendas e financeiro" />
        <QuickLink href="/amazon/estoque" label="Radar" desc="Estoque × velocidade" />
        <QuickLink href="/amazon/produtos" label="Produtos" desc="Custos por SKU" />
      </div>
      </div>
    </IntegrationDashboardFrame>
  );
}




// A Transactions API nomeia cada tarifa em inglês. "Taxas Amazon" somava tudo num
// número só e a pergunta "qual taxa é essa?" não tinha resposta na tela.
// Tipo desconhecido aparece com o nome original — nunca some nem vira "Outras".

function Flow({
  label,
  value,
  muted,
  accent,
  tone = "default",
  sign,
  detail,
  subtotal,
}: {
  detail?: boolean;
  label: string;
  /** ReactNode desde 30/08/2026: a margem leva o SINAL colado nela. */
  value: React.ReactNode;
  muted?: boolean;
  accent?: boolean;
  tone?: "default" | "positive" | "danger" | "warn";
  sign?: "−" | "=";
  /** Fecha um trecho da cascata sem ser o resultado final (que é verde). */
  subtotal?: boolean;
}) {
  return (
    <div className={`financial-line ${accent ? `is-result is-result-${tone}` : ""} ${subtotal ? "is-subtotal" : ""}`}>
      <span className="financial-sign" aria-hidden="true">{sign}</span>
      <p className={detail ? "pl-3 text-xs text-[var(--ink-muted)]" : "text-xs font-medium text-[var(--ink-muted)]"}>{label}</p>
      <p
        className={`tabular-nums ${detail ? "text-xs text-[var(--ink-muted)]" : "text-sm font-bold"} ${
          accent
            ? tone === "positive"
              ? "text-[var(--positive)]"
              : tone === "danger"
                ? "text-[var(--danger)]"
                : tone === "warn"
                  ? "text-[var(--warning)]"
                : "text-[var(--ink)]"
            : muted && !detail
              ? "text-[var(--ink-soft)]"
              : detail
                ? ""
                : "text-[var(--ink)]"
        }`}
      >
        {value}
      </p>
    </div>
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
  if (connection === "connected" && !productsLoading && products === 0) items.push({ label: "Sincronizar os produtos da Amazon", href: "/amazon/produtos" });
  if (products > 0 && missingCosts > 0) items.push({ label: `Cadastrar custo de ${missingCosts} produto(s)`, href: "/amazon/produtos" });

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
