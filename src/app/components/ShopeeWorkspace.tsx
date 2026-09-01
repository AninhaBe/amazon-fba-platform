"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatedNumber, identidadeDePeriodo } from "./AnimatedNumber";
import { EmptyState } from "./EmptyState";
import { DashboardSkeleton } from "./LoadingState";
import { PageHeader } from "./PageHeader";
import { RevenueChart, type DailyPoint } from "./RevenueChart";
import { LegendaDeVendas } from "./LegendaDeVendas";
import { DashboardPeriodFilter, useDashboardPeriod } from "./DashboardPeriodFilter";
import { periodoNaUrl } from "./periodoNaUrl";
import { OrderProfitabilityTable } from "./OrderProfitabilityTable";
import { TopProductsRanking } from "./TopProductsRanking";
import { BriefingLead } from "./BriefingLead";
import { NexoDoDia } from "./NexoDoDia";
import { IntegrationDashboardFrame } from "./IntegrationDashboardFrame";
import { ConnectionBroken } from "./ConnectionBroken";
import { ChannelConnectionEmpty } from "./ChannelConnectionEmpty";
import { CompactMetric, Flow, FlowExpandable, Metric, getRevenueTrend } from "./Metric";
import { escolherConexaoPadrao } from "@/lib/integrations/conexaoPadrao";
import { buildFinancialComposition, FinancialSummaryPanel } from "./FinancialSummaryPanel";
import { brDate, brTime } from "@/lib/datetime";
import { coberturaDoPeriodo } from "@/lib/coberturaPeriodo";
import { SincronizacaoCompleta } from "./SincronizacaoCompleta";
import { ChevronDown, FlaskConical } from "lucide-react";
import type { ProfitabilityLine } from "@/lib/profitability";
import type { ShopeeSyncStatus } from "@/lib/integrations/shopeeSync";
import { SHOPEE_CATALOG_CAPABILITIES } from "@/lib/integrations/shopeeCapabilities";
import {
  resolveShopeeConnectionState,
  shopeeProviderIssueContent,
  shopeeSyncContent,
  shopeeTaxLabel,
  type ShopeeProviderIssue,
} from "./ShopeeWorkspaceModel";
import { acoesDeSaude } from "@/lib/integrations/shopeeAccountHealthMapa";
import type { ShopeeSaudeDaConta } from "@/lib/integrations/shopeeAccountHealth";
import type { PublicIntegrationConnection } from "@/lib/integrations/types";
import { marginMetricTone } from "@/lib/marginTone";
import { comSemImposto } from "@/lib/semImposto";
import { rotuloStatusShopee } from "./statusDeExibicao";
import { shopeeTaxRateHref } from "./ShopeeSettingsModel";
import { BaseDeData, ProgressoDaImportacao } from "./BaseDeData";
import { chaveDaBusca } from "./chaveDaBusca";
import { usePrefetchDePeriodos } from "./prefetchDePeriodos";
import { sinaisDoResultado, rodapeDasTaxas } from "./oQueFaltaNoResultado";
import { SinaisDoResultado } from "./SinaisDoResultado";
import { declaracaoDeBase } from "./baseDaMargem";

interface Overview {
  account: { id: string; name: string; region: string };
  period: { from: string; to: string; label: string };
  metrics: {
    activeListings: number;
    productsWithoutCost: number;
    orders30d: number;
    paidOrders: number;
    revenue30d: number;
    cancelledRevenue: number;
    cancelledOrders: number;
    lastSaleAt: string | null;
    currency: string;
    revenueCoverage: { capturedOrders: number; totalOrders: number; complete: boolean };
  };
  notasPendentes?: { pedidos: number; motivos: Array<{ motivo: string | null; pedidos: number }> };
  profit: {
    fees: number | null; ads: number | null; taxesWithheld: number | null; refunds: number | null;
    cogs: number | null; taxes: number | null; taxRate: number | null;
    sellerShipping: number | null; buyerShipping: number | null; feesComplete: boolean;
    revenueProcessed: number;
    /** A receita que o lucro cobre — o denominador da margem e a base declarada. */
    revenueDoLucro?: number;
    /** Pedidos pagos ainda sem tarifa apurada: o que falta, com número, na face do card. */
    pedidosSemApuracao?: number;
    coverage: { processedOrders: number; paidOrders: number; ordersWithFees: number; complete: boolean };
    estimatedProfit: number | null; marginPct: number | null; unitsWithoutCost: number; skusWithoutCost: number;
  };
  dailySales: DailyPoint[];
  topProducts: Array<{ id: string; sku: string | null; title: string; units: number; revenue: number; cost: number; contribution: number; complete: boolean; marginPct: number | null }>;
  stockRadar: Array<{ id: string; sku: string | null; title: string; availableQuantity: number; unitsSold: number; calculationDays: number; daysRemaining: number | null; status: "out" | "critical" | "ok" }>;
  profitabilityLines: ProfitabilityLine[];
  profitabilityPage: { limit: number; offset: number; totalOrders: number; returnedOrders: number; hasMore: boolean; complete: boolean };
  recentOrders: Array<{ id: string; status: string; createdAt: string; total: number; currency: string; items: number }>;
}

interface ProviderStatus {
  configured: boolean;
  connected: boolean;
  connectionStatus: "connected" | "attention" | "disconnected" | "missing";
  connectHref?: string;
  connectionCount: number;
  demo: boolean;
  connections: PublicIntegrationConnection[];
  issue?: ShopeeProviderIssue;
}

interface OverviewResponse {
  pending?: boolean;
  overview?: Overview;
  sync: ShopeeSyncStatus;
  selectedConnectionId?: string;
  connections?: Array<{ id: string; name: string; externalAccountId: string }>;
}

function money(value: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

function percent(value: number) {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

// Status da Shopee (v2) traduzidos; o que não estiver mapeado aparece legível.
// O mapa saiu daqui para `statusDeExibicao` porque o MONITOR da Shopee mostrava
// os mesmos status crus que esta tela já traduzia — duas telas do mesmo canal
// liam o mesmo pedido de dois jeitos.
const orderStatus = rotuloStatusShopee;

interface PeriodoEmCache {
  overview: Overview;
  sync: ShopeeSyncStatus | null;
  updatedAt: Date;
}

/**
 * Mesmo padrao do `periodCache` do Mercado Livre e do `dashCache` da Amazon: o
 * periodo ja visto pinta no primeiro paint e a revalidacao corre em segundo
 * plano. A Shopee tinha ficado de fora, e por isso trocar Hoje/7/15/30 aqui
 * parecia mais lento que nos outros canais mesmo em periodo ja aberto.
 *
 * ⚠️ A CHAVE INCLUI A LOJA. Cache de periodo sem `connection_id` misturaria
 * numeros de lojas diferentes ao trocar no seletor — seria pior que a lentidao
 * que ele resolve. `offset` entra pelo mesmo motivo: a pagina de detalhamento
 * faz parte do que foi buscado.
 *
 * Escopo de modulo: sobrevive a navegacao entre canais. Um reload limpa tudo —
 * o cache nunca e a fonte da verdade, so evita a tela em branco enquanto a
 * resposta nova nao chega.
 */
const periodCache = new Map<string, PeriodoEmCache>();

function chaveDoPeriodo(connectionId: string, periodQuery: string, offset: string) {
  return `${connectionId}:${periodQuery}:${offset}`;
}

export function ShopeeWorkspace() {
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
        // ⚠️ O `offset=0` VAI NA MESMA NAVEGACAO, e nao numa segunda.
      //
      // O efeito logo abaixo ja zerava a pagina ao trocar de periodo, com um
      // `router.replace` proprio. Com o periodo indo para a URL, o mesmo clique
      // produziria DUAS navegacoes.
      //
      // ⚠️ E NAO uma requisicao a mais — a primeira versao deste comentario
      // afirmava isso e a medicao desmentiu: a chave de busca
      // (`chaveDoPeriodo`) so muda quando o offset muda, e na navegacao
      // intermediaria ele ainda e o antigo. Duas navegacoes, duas chaves, duas
      // requisicoes? Nao: duas navegacoes e DUAS chaves distintas, as mesmas
      // que ja existiam antes. O ganho e outro e continua valendo: uma entrada
      // no historico por troca de periodo em vez de duas, para o botao voltar
      // desfazer um clique com um clique.
      //
      // O efeito continua onde esta: ele cobre a troca de periodo que vem da
      // URL (voltar pelo historico), onde nao ha clique nenhum para carregar o
      // offset junto. Aqui ele encontra o offset ja zerado e sai na primeira
      // linha.
      router.push(`${location.pathname}?${periodoNaUrl(searchParams.toString(), query, { offset: "0" })}`, { scroll: false }),
      [router, searchParams],
    ),
  );
  const previousPeriod = useRef(period.query);
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [carregado, setCarregado] = useState<{ chave: string; overview: Overview; sync: ShopeeSyncStatus | null; updatedAt: Date } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  // Bruto = ultima resposta, usada pela polling da 1a sincronizacao. O que a
  // TELA le e `sync`, derivado abaixo e sempre do periodo exibido.
  const [syncBruto, setSyncBruto] = useState<ShopeeSyncStatus | null>(null);
  const [syncPoll, setSyncPoll] = useState(0);

  useEffect(() => {
    if (previousPeriod.current === period.query) return;
    previousPeriod.current = period.query;
    if (searchParams.get("offset") === "0" || !searchParams.has("offset")) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("offset", "0");
    router.replace(`/shopee?${next}`, { scroll: false });
  }, [period.query, router, searchParams]);

  useEffect(() => {
    if (!status?.connections.length) return;
    const requested = searchParams.get("connection_id");
    // A MESMA função que o servidor usa para resolver a loja padrão. Duas
    // cópias da regra é como o seletor acaba discordando do dado exibido.
    const selected = escolherConexaoPadrao(status.connections, requested);
    if (!selected || requested === selected.id) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("connection_id", selected.id);
    next.set("offset", "0");
    router.replace(`/shopee?${next}`, { scroll: false });
  }, [router, searchParams, status]);

  // ⚠️ O DADO EXIBIDO E DERIVADO NO RENDER, nao sincronizado por efeito.
  //
  // Medido em 28/08/2026 na v149: com o repaint saindo por `setTimeout(0)`,
  // existiam de 2 a 5 quadros em que o botao ja dizia "7 dias" e os numeros
  // ainda eram os de "hoje" — a tela afirmando um valor que nao e daquele
  // periodo. Derivar aqui elimina o VAO em vez de tapa-lo com esqueleto: no
  // mesmo render em que o periodo muda, o valor exibido ja e o daquele periodo
  // (do cache, quando ha) ou `null` (carregamento honesto, quando nao ha).
  // Nunca o do periodo anterior.
  const chaveAtual = status?.connections.length
    ? chaveDoPeriodo(
        (status.connections.find((c) => c.id === searchParams.get("connection_id")) ?? status.connections[0]).id,
        period.query,
        searchParams.get("offset") ?? "0",
      )
    : null;
  const exibido = chaveAtual
    ? (carregado?.chave === chaveAtual ? carregado : periodCache.get(chaveAtual) ?? null)
    : null;
  const overview = exibido?.overview ?? null;
  const sync = exibido?.sync ?? syncBruto;
  const updatedAt = exibido?.updatedAt ?? null;

  // Aquece os outros periodos padrao depois da primeira pintura, um por vez.
  // So escreve no `periodCache`; a tela continua derivando do periodo
  // selecionado, entao nada aquecido aparece sob rotulo errado.
  const lojaAtual = status?.connections.length
    ? (status.connections.find((c) => c.id === searchParams.get("connection_id")) ?? status.connections[0]).id
    : "";
  const offsetAtual = searchParams.get("offset") ?? "0";
  const jaTemPeriodo = useCallback(
    (q: string) => periodCache.has(chaveDoPeriodo(lojaAtual, q, offsetAtual)),
    [lojaAtual, offsetAtual],
  );
  const buscarPeriodo = useCallback(async (q: string, signal: AbortSignal) => {
    const query = new URLSearchParams(q);
    query.set("connection_id", lojaAtual);
    query.set("limit", "100");
    query.set("offset", offsetAtual);
    const resposta = await fetch(`/api/integrations/shopee/overview?${query}`, { cache: "no-store", signal });
    if (!resposta.ok) return;
    const corpo = await resposta.json() as OverviewResponse;
    if (corpo.pending || !corpo.overview) return;
    periodCache.set(chaveDoPeriodo(lojaAtual, q, offsetAtual), {
      overview: corpo.overview, sync: corpo.sync, updatedAt: new Date(),
    });
  }, [lojaAtual, offsetAtual]);
  const { aquecerAgora } = usePrefetchDePeriodos({
    // So depois de a tela ter algo — aquecer nao disputa com a primeira pintura.
    ativo: !!overview && !!lojaAtual,
    atual: period.query,
    escopo: lojaAtual,
    jaTem: jaTemPeriodo,
    buscar: buscarPeriodo,
  });

  // ⚠️ DEPENDENCIA DE EFEITO E POR VALOR, NAO POR OBJETO.
  //
  // Medido em producao em 28/08/2026: a Shopee pedia o overview TRES VEZES
  // antes da primeira pintura (1050ms, 1706ms, 2142ms) — e e a rota mais cara
  // que medimos (1457ms em 30 dias na conta real). O efeito dependia de
  // `status` e de `searchParams`, que sao objetos: referencia nova a cada
  // resposta ou a cada render do roteador refazia o MESMO pedido.
  //
  // O que o efeito de fato usa sao tres strings. Elas entram na dependencia; os
  // objetos ficam de fora.
  const connectionPedido = searchParams.get("connection_id");
  const offsetPedido = searchParams.get("offset") ?? "0";
  const statusPronto = status !== null;
  const lojaPedida = status ? escolherConexaoPadrao(status.connections, connectionPedido)?.id ?? null : null;

  function retry() {
    setError(null);
    setPending(false);
    setCarregado(null);
    setStatus(null);
    setSyncBruto(null);
    setRetryKey((key) => key + 1);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const response = await fetch("/api/integrations", { cache: "no-store" });
        if (!response.ok) throw new Error("Não foi possível carregar as integrações.");
        const data = await response.json();
        const provider = (data.providers ?? []).find((item: { id: string }) => item.id === "shopee");
        const issue = provider?.issue as ShopeeProviderIssue | undefined;
        const connections = (issue ? [] : provider?.connections ?? []) as PublicIntegrationConnection[];
        const resolved = resolveShopeeConnectionState(connections);
        if (cancelled) return;
        setStatus({
          configured: Boolean(provider?.configured),
          connected: resolved.connectionStatus === "connected",
          connectionStatus: resolved.connectionStatus,
          connectHref: provider?.connectHref,
          connectionCount: resolved.connectionCount,
          demo: resolved.demo,
          connections: connections.filter((connection) => connection.status === "connected"),
          issue,
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar.");
      }
    })();
    return () => { cancelled = true; };
  }, [retryKey]);

  // Ultima busca ja RESPONDIDA, identificada pela loja que o servidor resolveu
  // — nao pela que supomos antes de perguntar.
  const ultimaBusca = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const requested = connectionPedido;
    // ⚠️ ABERTURA SEM ESPERAR O /api/integrations (28/08/2026).
    //
    // Antes, este efeito só rodava depois que o status chegava — e o status
    // existia só para descobrir QUAL loja pedir. Eram dois RTTs em série: ~500ms
    // para saber a loja, ~600ms para buscar o dado, e o primeiro número da tela
    // aparecia em ~1,7s (medido em produção, acima do orçamento do ADR-017).
    //
    // Agora, quando ninguém escolheu loja ainda, pedimos o overview SEM
    // `connection_id` e o SERVIDOR resolve a padrão — com a MESMA regra do
    // seletor (`escolherConexaoPadrao`), e devolvendo qual resolveu. A verdade
    // sobre a loja exibida passa a ser a resposta, nunca uma suposição daqui.
    const selected = status ? escolherConexaoPadrao(status.connections, requested) : null;
    // Sem loja E com o status já carregado = não há o que buscar. Com o status
    // ainda em voo, seguimos: o servidor sabe escolher.
    if (!selected && status) return;
    const offset = offsetPedido;
    // ⚠️ A CHEGADA DO STATUS NAO PEDE DE NOVO O QUE JA FOI PEDIDO.
    //
    // Este efeito roda ANTES do `/api/integrations` de proposito (a nota acima
    // explica: eram dois RTTs em serie). Quando o status chega, ele traz a
    // mesma loja que o servidor ja tinha resolvido — e o efeito refazia o
    // pedido identico. Era a segunda das tres idas medidas.
    //
    // A comparacao usa a loja RESOLVIDA da resposta anterior, entao ela so
    // silencia a repeticao: `retryKey`, `syncPoll`, periodo, offset e loja
    // diferente continuam entrando aqui, cada um com alvo proprio. Em especial,
    // o `syncPoll` — que existe para a tela acompanhar a sincronizacao — muda o
    // alvo a cada volta e nunca e barrado.
    const { alvo } = chaveDaBusca({
      loja: selected?.id ?? null, periodo: period.query, offset,
      tentativa: retryKey, sincronizacao: syncPoll,
    });
    if (selected && ultimaBusca.current === alvo) return;
    // ⚠️ NAO ACRESCENTE AQUI UMA GUARDA POR BUSCA "NO AR". Eu acrescentei duas
    // (a identica em voo e a que reconhecia a ida sem loja) e as duas DEIXARAM
    // A TELA EM BRANCO — medido em 28/08/2026, 45s sem numero nenhum.
    //
    // O motivo nao esta na guarda, esta na semantica de cancelamento deste
    // efeito: o `cancelled` la embaixo significa "o efeito rodou de novo", nao
    // "esta resposta nao interessa mais". Quando a rodada seguinte e pulada, a
    // anterior ja foi marcada como cancelada pela limpeza e a resposta dela e
    // descartada — entao ninguem entrega o dado. Hoje a repeticao ESCONDE isso:
    // e a ida repetida que repoe o que a cancelada jogou fora.
    //
    // Por isso a unica guarda segura aqui e a de busca ja RESPONDIDA (acima):
    // resposta aplicada nao depende de ninguem repor. Para pular tambem o que
    // esta em voo, o cancelamento precisa virar por ALVO ("esta resposta ainda
    // e a que a tela quer?") em vez de por rodada. E mudanca de desenho, esta
    // proposta, e nao entra junto com uma medicao de fim de turno.
    // Sem id conhecido ainda, a chave sai da resposta (`selectedConnectionId`).
    const chave = selected ? chaveDoPeriodo(selected.id, period.query, offset) : null;
    // Pinta o periodo ja visto ANTES de buscar. A resposta nova sobrescreve
    // quando chegar — o cache nunca fica na tela como se fosse o dado fresco.
    // Se ja ha dado deste periodo, falha de revalidacao nao apaga a tela.
    const emCache = chave ? periodCache.get(chave) : undefined;
    (async () => {
      try {
        setError(null);
        const query = new URLSearchParams(period.query);
        // Sem loja escolhida, NÃO mandamos `connection_id`: é o servidor que
        // resolve a padrão e devolve qual foi.
        if (selected) query.set("connection_id", selected.id);
        query.set("limit", "100");
        query.set("offset", offset);
        const response = await fetch(`/api/integrations/shopee/overview?${query}`, { cache: "no-store" });
        const data = await response.json() as OverviewResponse & { error?: string };
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || "Erro ao carregar a Shopee.");
        // ⚠️ A loja EXIBIDA é a que o servidor resolveu, não a que supomos aqui.
        // Sem isso, a tela poderia pintar o número da loja A e o seletor, ao
        // chegar, dizer loja B — a mesma classe de defeito do número sob o
        // rótulo errado, só que com loja, e num app multi-loja é pior.
        const idExibido = data.selectedConnectionId ?? selected?.id ?? null;
        // Registrado com o id RESOLVIDO: e assim que a chegada do status, que
        // resolve para a mesma loja, reconhece que nao ha o que buscar.
        if (idExibido) {
          ultimaBusca.current = chaveDaBusca({
            loja: idExibido, periodo: period.query, offset,
            tentativa: retryKey, sincronizacao: syncPoll,
          }).alvo;
        }
        const chaveFinal = idExibido ? chaveDoPeriodo(idExibido, period.query, offset) : null;
        setSyncBruto(data.sync);
        if (data.pending) {
          setPending(true);
          setCarregado(null);
          if (chaveFinal) periodCache.delete(chaveFinal);
        } else {
          setPending(false);
          const quando = new Date();
          if (data.overview && chaveFinal) {
            periodCache.set(chaveFinal, { overview: data.overview, sync: data.sync, updatedAt: quando });
            setCarregado({ chave: chaveFinal, overview: data.overview, sync: data.sync, updatedAt: quando });
          } else {
            setCarregado(null);
          }
        }
      } catch (err) {
        // Falha na revalidacao de um periodo que ja esta na tela nao apaga o
        // que a pessoa esta lendo — mesma regra do Mercado Livre.
        if (!cancelled && !emCache) setError(err instanceof Error ? err.message : "Erro ao carregar.");
      }
    })();
    return () => { cancelled = true; };
  }, [status, statusPronto, lojaPedida, connectionPedido, offsetPedido, period.query, retryKey, syncPoll]);

  // Enquanto a primeira sincronização roda, a tela se atualiza sozinha — o
  // vendedor vê o número de pedidos crescer em vez de recarregar a página.
  useEffect(() => {
    if (!status?.connected || !sync) return;
    const primeiraSincronizacao = (sync.phase === "idle" || sync.phase === "syncing") && (pending || !overview);
    if (!primeiraSincronizacao) return;
    const timer = setTimeout(() => setSyncPoll((value) => value + 1), 5_000);
    return () => clearTimeout(timer);
  }, [status, sync, pending, overview, syncPoll]);

  if (error) {
    return (
      <ShopeeFrame>
        <EmptyState
          title="Não foi possível carregar"
          description={error}
          kind="permission"
          action={<button type="button" className="meli-primary-action" onClick={retry}>Tentar novamente</button>}
        />
      </ShopeeFrame>
    );
  }

  if (!status) {
    return (
      <ShopeeFrame>
        <DashboardSkeleton />
      </ShopeeFrame>
    );
  }

  const providerIssue = shopeeProviderIssueContent(status.issue);
  if (providerIssue) {
    return (
      <ShopeeFrame subtitle="O canal requer atenção antes de continuar.">
        <EmptyState
          kind="permission"
          title={providerIssue.title}
          description={providerIssue.description}
          action={<Link className="meli-primary-action" href="/integracoes">{providerIssue.actionLabel}</Link>}
        />
      </ShopeeFrame>
    );
  }

  if (status.demo && status.connectionStatus !== "connected") {
    return (
      <ShopeeFrame subtitle="Ambiente de demonstração — sem loja real autorizada.">
        <ShopeeDemoNotice connectHref={status.configured ? status.connectHref : undefined} />
        <EmptyState title="Demonstração indisponível" description="Os dados sintéticos não estão ativos. Conecte uma loja real quando a autorização da Shopee estiver disponível." />
      </ShopeeFrame>
    );
  }

  if (status.connectionStatus === "attention" || status.connectionStatus === "disconnected") {
    return (
      <ShopeeFrame subtitle="A loja precisa ser reconectada para retomar a sincronização.">
        <ConnectionBroken channel="shopee" />
      </ShopeeFrame>
    );
  }

  // As credenciais do servidor habilitam *conectar* uma loja nova — não são
  // requisito para *ver* o canal. Uma loja já conectada lê tudo do modelo
  // canônico, então o dashboard renderiza mesmo sem SHOPEE_PARTNER_ID no
  // ambiente. Checar credencial antes da conexão escondia o dashboard de quem
  // já tinha dados.
  if (!status.connected) {
    if (!status.configured) {
      return (
        <ShopeeFrame subtitle="Canal ainda não configurado no servidor.">
          <EmptyState
            kind="permission"
            title="Credenciais da Shopee ausentes"
            description="Defina SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY no ambiente para habilitar a conexão."
          />
        </ShopeeFrame>
      );
    }
    return (
      <ShopeeFrame subtitle="Conecte uma loja para começar a sincronizar pedidos e taxas.">
        <ChannelConnectionEmpty
          channel="Shopee"
          description="Ao autorizar, o NEXO passa a ler pedidos, produtos e o extrato financeiro de cada venda."
          action={
            <Link className="meli-primary-action" href={status.connectHref || "/integracoes"}>
              Conectar loja Shopee <span aria-hidden="true">→</span>
            </Link>
          }
        />
      </ShopeeFrame>
    );
  }

  // A resposta do overview ainda não chegou: enquanto busca, é CARREGAMENTO —
  // nunca uma afirmação de ausência de dado. Sem este gate, entre o status das
  // integrações chegar e o overview responder, a tela afirmava "Ainda sem dados
  // sincronizados" por um instante numa loja com 10 mil pedidos (27/08/2026).
  // Toda resposta do overview traz `sync`, então sync nulo = ainda buscando.
  if (!sync && !overview && !pending) {
    return (
      <ShopeeFrame>
        <DashboardSkeleton />
      </ShopeeFrame>
    );
  }

  // REGRA DE PRODUTO (28/08/2026, correção da regressão da UTILEIRA): a tela
  // cheia de sincronização SÓ aparece quando não há pedido nenhum para mostrar
  // (pending || !overview). Com overview presente, o dashboard SEMPRE renderiza
  // — o progresso vive nas faixas internas de cobertura. Antes, a fase 'idle'
  // (status pending entre passos do cron) tomava a tela inteira de uma loja com
  // 22 mil pedidos e o dashboard cheio sumia atrás de "Importando...".
  if (sync && sync.phase !== "ready" && (pending || !overview)) {
    const state = shopeeSyncContent(sync.phase);
    const detail = sync.error?.message || state.description;
    const action = state.action === "refresh"
      ? <button type="button" className="meli-primary-action" onClick={retry}>Atualizar estado</button>
      : state.action === "reconnect"
        ? <Link className="meli-primary-action" href={status.connectHref || "/api/integrations/shopee/connect"}>Reconectar loja <span aria-hidden="true">→</span></Link>
        : state.action === "manage" ? <Link className="meli-primary-action" href="/integracoes">Gerenciar conexão <span aria-hidden="true">→</span></Link> : undefined;
    return (
      <ShopeeFrame subtitle={status.demo ? `Demonstração · ${sync.progress}% concluído` : `Loja conectada · ${sync.progress}% concluído`}>
        {status.demo && <ShopeeDemoNotice connectHref={status.configured ? status.connectHref : undefined} />}
        <section aria-live="polite" aria-labelledby="shopee-sync-title">
          <EmptyState title={state.title} description={detail} kind={sync.phase === "idle" ? "data" : "permission"} action={action} />
          {sync.phase === "idle" || sync.phase === "syncing" ? (
            // Progresso honesto, com o número real — não um spinner mudo.
            <p className="integration-message" id="shopee-sync-title">
              {sync.processedOrders} pedido(s) já importado(s) · {sync.progress}% do período coberto.
            </p>
          ) : (
            <p className="sr-only" id="shopee-sync-title">Progresso da sincronização: {sync.progress}%. {sync.processedOrders} pedidos processados.</p>
          )}
        </section>
      </ShopeeFrame>
    );
  }

  if (pending || !overview) {
    return (
      <ShopeeFrame subtitle={status.demo ? "Ambiente de demonstração — dados sintéticos." : "Loja conectada — primeira sincronização pendente."}>
        {status.demo && <ShopeeDemoNotice connectHref={status.configured ? status.connectHref : undefined} />}
        <EmptyState
          title="Ainda sem dados sincronizados"
          description="A loja está autorizada. Assim que a primeira sincronização rodar, os indicadores, o gráfico e a rentabilidade por pedido aparecem aqui."
          action={<Link className="meli-primary-action" href="/integracoes">Gerenciar conexão <span aria-hidden="true">→</span></Link>}
        />
      </ShopeeFrame>
    );
  }

  return (
    <IntegrationDashboardFrame
      className="channel-dashboard shopee-dashboard-page"
      period={<DashboardPeriodFilter
        {...period.filterProps}
        onIntent={aquecerAgora}
        meta={updatedAt ? <>Atualizado às {brTime(updatedAt)}{overview.metrics.lastSaleAt ? ` · última venda às ${brTime(overview.metrics.lastSaleAt, true)}` : ""}</> : undefined}
      />}
      header={<PageHeader
        eyebrow="Shopee"
        title={status.demo ? "Visão de demonstração" : overview.account.name}
        subtitle={status.demo ? `Dados sintéticos · ${overview.period.label}` : `Loja ${overview.account.id} · ${overview.account.region} · ${overview.period.label}`}
        action={status.connections.length > 1 && <label className="channel-store-selector">Loja<select aria-label="Loja Shopee" value={status.connections.find((item)=>item.id===searchParams.get("connection_id"))?.id??status.connections[0]?.id} onChange={(event)=>{const next=new URLSearchParams(searchParams.toString());next.set("connection_id",event.target.value);next.set("offset","0");router.push(`/shopee?${next}`,{scroll:false})}}>{status.connections.map((item)=><option key={item.id} value={item.id}>{item.displayName||item.externalAccountId||item.id}</option>)}</select></label>}
      />}
    >
      {status.demo && <ShopeeDemoNotice connectHref={status.configured ? status.connectHref : undefined} compacto />}
      <Dashboard
        overview={overview}
        sync={sync}
        periodoLabel={period.label}
        periodoQuery={period.query}
        onPage={(offset) => {
          const next = new URLSearchParams(searchParams.toString());
          next.set("offset", String(offset));
          router.push(`/shopee?${next}`, { scroll: false });
        }}
      />
    </IntegrationDashboardFrame>
  );
}

/**
 * `compacto` existe porque o MESMO aviso tem dois papeis. Numa tela vazia ou de
 * erro ele e o conteudo principal e merece o bloco inteiro. No dashboard cheio
 * ele e uma faixa constante que nunca muda de estado — e o cabecalho ja diz
 * "Visao de demonstracao / Dados sinteticos" logo acima. Ali vira linha
 * discreta, sem perder o link de conectar loja real.
 */
function ShopeeDemoNotice({ connectHref, compacto = false }: { connectHref?: string; compacto?: boolean }) {
  if (compacto) {
    return (
      <p className="base-de-data" role="note">
        Os pedidos, produtos e valores desta tela são sintéticos. Nenhuma loja Shopee real está autorizada neste workspace.
        {connectHref && (
          <> <Link className="font-semibold text-[var(--acao)] underline-offset-2 hover:underline" href={connectHref}>Conectar loja real <span aria-hidden="true">→</span></Link></>
        )}
      </p>
    );
  }
  return (
    <aside className="channel-module-notice is-warning shopee-demo-notice" aria-labelledby="shopee-demo-title">
      <div className="flex gap-3">
        <FlaskConical className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div>
          <h2 id="shopee-demo-title" className="text-sm font-bold">Dados de demonstração</h2>
          <p className="mt-1 text-sm leading-relaxed">Os pedidos, produtos e valores desta tela são sintéticos. Nenhuma loja Shopee real está autorizada neste workspace.</p>
        </div>
      </div>
      {connectHref && (
        <Link className="meli-primary-action shrink-0" href={connectHref}>
          Conectar loja real <span aria-hidden="true">→</span>
        </Link>
      )}
    </aside>
  );
}

function Dashboard({ overview, sync, onPage, periodoLabel, periodoQuery }: { overview: Overview; sync: ShopeeSyncStatus | null; onPage: (offset: number) => void; periodoQuery: string; periodoLabel: string }) {
  const [costsOpen, setCostsOpen] = useState(false);
  // Saúde da conta é acessória aqui: alimenta as ações do BriefingLead com
  // número e o-que-fazer. Falha de leitura (ou demo) = sem ação — degradação
  // limpa, nunca alarme inventado.
  const [saude, setSaude] = useState<ShopeeSaudeDaConta | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/integrations/shopee/saude?connection_id=${encodeURIComponent(`shopee:${overview.account.id}`)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (live && body?.availability === "AVAILABLE" && body.saude) setSaude(body.saude); })
      .catch(() => { /* sem saúde, sem ação */ });
    return () => { live = false; };
  }, [overview.account.id]);
  // Período do filtro vs. histórico já importado (frente K): mês ainda não
  // importado nunca vira cards zerados — "não vendeu" e "não importei" são
  // fatos diferentes.
  const cobertura = sync ? coberturaDoPeriodo({
    periodoDeMs: new Date(overview.period.from).getTime(),
    periodoAteMs: new Date(overview.period.to).getTime(),
    coveredFrom: sync.coveredFrom,
    status: sync.status,
  }) : null;
  if (cobertura?.periodoInteiroDescoberto) {
    const desde = cobertura.cobreDesde ? brDate(new Date(cobertura.cobreDesde)) : null;
    return (
      <div className="dashboard-sections integration-dashboard-sections shopee-dashboard-body">
        <NexoDoDia />
        <EmptyState
          kind="data"
          title={cobertura.emImportacao ? "Este período ainda está sendo importado" : "Período anterior ao histórico importado"}
          description={cobertura.emImportacao
            ? `${desde ? `O histórico já cobre a partir de ${desde}. ` : ""}${sync?.processedOrders ?? 0} pedido(s) já importado(s) — este período aparece conforme o histórico avança.`
            : `O histórico importado começa em ${desde ?? "—"}. Datas anteriores não foram importadas.`}
        />
      </div>
    );
  }
  const profitCoverage = overview.profit.coverage;
  // O QUE FALTA, com número e link — nunca "aguardando" seco. Ver
  // `oQueFaltaNoResultado.ts`: os dois textos que moravam aqui eram falsos.
  const sinais = sinaisDoResultado({
    skusWithoutCost: overview.profit.skusWithoutCost,
    ordersWithFees: profitCoverage.ordersWithFees,
    ordersProcessed: profitCoverage.processedOrders,
    paidOrders: profitCoverage.paidOrders,
    hrefDeCustos: "/shopee/produtos",
  });
  // Bases já coincidem (receita e contagem usam o mesmo filtro de status).
  // `null` sem venda: R$ 0,00 afirmaria que cada venda rendeu zero.
  const ticket = overview.metrics.paidOrders > 0 ? overview.metrics.revenue30d / overview.metrics.paidOrders : null;
  const units = overview.dailySales.reduce((total, point) => total + point.units, 0);
  const critical = overview.stockRadar.filter((product) => product.status === "critical" || product.status === "out");
  const roi = overview.profit.cogs != null && overview.profit.cogs > 0 && overview.profit.estimatedProfit != null ? (overview.profit.estimatedProfit / overview.profit.cogs) * 100 : null;
  const costsIncomplete = overview.profit.unitsWithoutCost > 0;
  // `overview.profit.taxes == null` saiu daqui em 26/08/2026: alíquota não
  // cadastrada é configuração da vendedora, não dado que faltou da Shopee. O
  // lucro sai sem o imposto e a tela rotula "(sem imposto)"; o CTA "Cadastrar
  // alíquota →" continua no painel. Tarifa, frete, ads, retenção, estorno e
  // custo seguem bloqueando.
  const semAliquota = overview.profit.taxRate == null;
  // ⚠️ `costsIncomplete` SAIU DAQUI em 30/08/2026 (decisao da vendedora): custo
  // faltando virou SINAL ao lado do numero, nao trava. Ver `sinaisDoResultado`.
  // ⚠️ `!profitCoverage.complete` E `!feesComplete` SAIRAM DAQUI em 31/08/2026,
  // pela mesma decisão que já tirou o custo em 30/08: cobertura incompleta vira
  // SINAL ao lado do número, não trava. Era o último tudo-ou-nada dos quatro
  // canais — na conta real dava travessão com 9.027 de 9.877 vendas apuradas
  // (91% do período) e a tela não mostrava nada.
  //
  // O que continua bloqueando é COMPONENTE DESCONHECIDO: `fees == null` não é
  // "não cobraram", é "não sei quanto", e aí o lucro seria otimista.
  // Ausência de componente ≠ ausência de cobertura.
  const resultIncomplete = overview.profit.fees == null || overview.profit.sellerShipping == null || overview.profit.ads == null || overview.profit.taxesWithheld == null || overview.profit.refunds == null || overview.profit.cogs == null || overview.profit.estimatedProfit == null || overview.profit.marginPct == null;
  const knownCosts = resultIncomplete ? null : overview.profit.fees! + overview.profit.sellerShipping! + overview.profit.ads! + overview.profit.taxesWithheld! + overview.profit.refunds! + overview.profit.cogs! + (overview.profit.taxes ?? 0);
  const ordersAwaitingCapture = Math.max(0, overview.metrics.revenueCoverage.totalOrders - overview.metrics.revenueCoverage.capturedOrders);
  // ⚠️ 29/08/2026 — ERA `paidOrders - processedOrders`, e os dois são o mesmo
  // número: "processado" significa que o pedido entrou no canônico, não que a
  // tarifa chegou. A conta dava ZERO em 9.849 vendas e a tela caía numa frase
  // sem número — exatamente o que a regra da casa proíbe ("diga o que falta,
  // com número e link"). O que falta é tarifa, então a conta é sobre tarifa.
  const vendasSemTarifa = Math.max(0, profitCoverage.processedOrders - profitCoverage.ordersWithFees);
  // ═══ A DECLARACAO DE BASE, A MESMA PECA DOS OUTROS TRES CANAIS ════════════
  //
  // ⚠️ ELA VEM JUNTO COM O DESBLOQUEIO, e não depois. Mostrar margem sobre uma
  // receita menor que o card de Faturamento ao lado, sem dizer sobre o quê, é
  // trocar travessão por número que se contradiz na própria tela — foi o que
  // aconteceu na Amazon em 31/08/2026 e a vendedora concluiu, com razão, que a
  // tela estava errada.
  //
  // `declaracaoDeBase` devolve `null` quando as bases coincidem: explicar
  // diferença que não existe treina a pessoa a ignorar a frase no dia em que ela
  // importa. E vai no `sub` (visível), nunca no tooltip.
  const baseDoResultado = declaracaoDeBase({
    baseApurada: overview.profit.revenueDoLucro ?? null,
    faturamentoExibido: overview.metrics.revenue30d,
    moeda: overview.metrics.currency,
    pedidosAguardando: overview.profit.pedidosSemApuracao ?? 0,
  });

  return (
    <div className="dashboard-sections integration-dashboard-sections shopee-dashboard-body">
      {/* A MESMA leitura do NEXO dos outros canais — uma narracao por dia por
      workspace, nao uma por canal. So aparece se ja estiver escrita. */}
      <NexoDoDia />
      {/* Mesma abertura dos outros três canais. A Shopee ainda não tem loja
          real conectada, e é justamente por isso que ela precisa nascer com a
          composição igual: no dia em que o Go Live sair, a tela já está pronta
          em vez de virar uma quarta variação. */}
      <BriefingLead
        periodo={periodoLabel}
        janela={periodoQuery}
        faturamento={overview.metrics.revenue30d}
        pedidos={overview.metrics.paidOrders}
        // ⚠️ ERA `revenueCoverage.complete ? estimatedProfit : null`, com o
        // argumento "cobertura parcial é motivo suficiente para não afirmar
        // lucro". A decisão dela derrubou isso em 31/08/2026, pela terceira vez
        // no mesmo mês: o número sai e a tela DECLARA a base ao lado.
        //
        // A trava morava em dois lugares — aqui e no produtor. Consertar só um
        // deixaria a narração muda com o card ao lado mostrando número, que é
        // pior que os dois calados.
        lucro={overview.profit.estimatedProfit}
        format={(v) => money(v, overview.metrics.currency)}
        escopo="shopee"
        canalNome="Shopee"
        moeda={overview.metrics.currency}
        briefingHref="/shopee/monitor"
        briefingLabel="Ver detalhes"
        acoes={[
          ...(overview.profit.taxRate == null
            ? [{ label: "Cadastrar alíquota", href: shopeeTaxRateHref(overview.account.id), tone: "pendencia" as const }]
            : []),
          ...(overview.metrics.productsWithoutCost > 0
            ? [{ label: `Cadastrar custo de ${overview.metrics.productsWithoutCost} produto(s)`, href: "/shopee/produtos", tone: "pendencia" as const }]
            : []),
          ...(critical.length > 0
            ? [{ label: `${critical.length} produto(s) em estoque crítico`, href: "/shopee/estoque", tone: "alerta" as const }]
            : []),
          // Saúde da conta: número + o que fazer (a métrica mais distante do
          // alvo, com valor e alvo da própria Shopee).
          ...acoesDeSaude(saude),
        ]}
      />

      {/* Alerta vermelho só com contagem REAL: disparar por cobertura de data
          exibindo uma subtração que é zero por construção (capturedOrders ==
          totalOrders, ambos do canônico) era alarme falso — visto em produção
          em 27/08/2026 ("0 pedido(s) aguardam captura"). O caso de cobertura
          por data já é coberto pela faixa honesta "os números abaixo cobrem a
          partir de DD/MM" acima. */}
      {/* Duas pendencias que eram DOIS blocos vermelhos de largura total, um
          debaixo do outro, viraram UM agrupador colapsado — o mesmo padrao que
          o TikTok ja usa em producao (`tiktok-attention-summary`). Nenhum texto
          mudou: numero, motivo informado pela Shopee e link continuam iguais,
          agora dentro do bloco em vez de gritando lado a lado. Separados por
          DONO DA ESPERA, como no TikTok. */}
      {(ordersAwaitingCapture > 0 || (overview.notasPendentes?.pedidos ?? 0) > 0) && (
        <details className="pendencias-agrupadas">
          <summary>
            <span>
              <strong>
                {(ordersAwaitingCapture > 0 ? 1 : 0) + ((overview.notasPendentes?.pedidos ?? 0) > 0 ? 1 : 0)}
                {(ordersAwaitingCapture > 0 ? 1 : 0) + ((overview.notasPendentes?.pedidos ?? 0) > 0 ? 1 : 0) === 1 ? " pendência" : " pendências"} no período
              </strong>
              <small>Abra para separar o que depende de você do que depende da Shopee.</small>
            </span>
            <ChevronDown aria-hidden="true" />
          </summary>
          <div className="pendencias-agrupadas-detalhe">
            {(overview.notasPendentes?.pedidos ?? 0) > 0 && (
              <aside className="channel-module-notice is-warning" role="status">
                <strong>Falta você resolver</strong>
                <p>
                  {overview.notasPendentes!.pedidos} pedido(s) aguardando NF-e — a Shopee bloqueia o envio até a nota ser validada.
                  {overview.notasPendentes!.motivos.some((item) => item.motivo != null) && (
                    <> Motivo informado pela Shopee: {overview.notasPendentes!.motivos.filter((item) => item.motivo != null).map((item) => `${item.motivo} (${item.pedidos})`).join("; ")}.</>
                  )}{" "}
                  <Link href="/shopee/monitor" className="font-semibold text-[var(--acao)] underline-offset-2 hover:underline">Ver pedidos <span aria-hidden="true">→</span></Link>
                </p>
              </aside>
            )}
            {ordersAwaitingCapture > 0 && (
              <aside className="channel-module-notice is-warning" role="status">
                <strong>Aguardando a sincronização</strong>
                <p>
                  {ordersAwaitingCapture} pedido(s) do período aguardam captura pela sincronização do NEXO.{" "}
                  <Link href="/shopee/monitor" className="font-semibold text-[var(--acao)] underline-offset-2 hover:underline">Ver pedidos <span aria-hidden="true">→</span></Link>
                </p>
              </aside>
            )}
          </div>
        </details>
      )}

      {/* Mesma fusao feita no ML e na Amazon: as duas faixas de PROGRESSO
          viraram uma linha discreta, colada na faixa de metricas. Toda frase
          antiga sobrevive, nas mesmas condicoes. */}
      <ProgressoDaImportacao
        progresso={sync?.phase === "syncing" ? sync.progress : null}
        cobreDesde={cobertura && !cobertura.periodoCoberto ? cobertura.cobreDesde : null}
        emImportacao={cobertura?.emImportacao}
        pedidosImportados={sync?.processedOrders}
      />

      {sync && (
        <SincronizacaoCompleta
          connectionId={`shopee:${overview.account.id}`}
          status={sync.status}
          coveredFrom={sync.coveredFrom}
        />
      )}

      {/* Era caixa azul de largura total para uma constante de capacidade que
          NUNCA muda de estado — o tipo de aviso que ensina a ignorar a regiao
          inteira. Mesmo texto, agora linha discreta ao lado da base de data. */}
      {!SHOPEE_CATALOG_CAPABILITIES.models && (
        <p className="base-de-data" role="note">
          As quantidades são agregadas por anúncio — o detalhamento por variação ainda não está disponível nesta integração.
        </p>
      )}

      {/* Go Live da Shopee ainda nao saiu: nao ha repasse observado, entao
          este canal so tem base pedido — nada aqui pode dizer "conciliado". */}
      <BaseDeData base="pedido" />
      <section className="metric-grid shopee-dashboard-metrics" aria-label="Resumo financeiro Shopee">
        <Metric label="Faturamento" value={<AnimatedNumber periodo={identidadeDePeriodo(overview.period.from, overview.period.to)} id="shopee-dash-revenue" value={overview.metrics.revenue30d} format={(amount) => money(amount, overview.metrics.currency)} />} sub={`${overview.metrics.paidOrders} pedido(s) no período`} trend={getRevenueTrend(overview.dailySales)} />
        <Metric label="Taxas" value={overview.profit.fees == null ? "—" : money(overview.profit.fees, overview.metrics.currency)} sub={rodapeDasTaxas({ feesComplete: overview.profit.feesComplete, ordersWithFees: profitCoverage.ordersWithFees, ordersProcessed: profitCoverage.processedOrders })} />
        <Metric label="Custo dos produtos" value={overview.profit.cogs == null ? "—" : money(overview.profit.cogs, overview.metrics.currency)} sub={costsIncomplete ? `${overview.profit.unitsWithoutCost} unidade(s) sem custo` : "custos cadastrados"} tone={costsIncomplete ? "warn" : "default"} />
        <Metric label={overview.profit.estimatedProfit == null ? "Resultado processado" : "Lucro estimado"} value={overview.profit.estimatedProfit == null ? "—" : <AnimatedNumber periodo={identidadeDePeriodo(overview.period.from, overview.period.to)} id="shopee-dash-profit" value={overview.profit.estimatedProfit} format={(amount) => money(amount, overview.metrics.currency)} />} sub={<>{baseDoResultado && <>{baseDoResultado} · </>}{comSemImposto("após todos os custos", semAliquota)}</>} tone={overview.profit.estimatedProfit == null ? "default" : overview.profit.estimatedProfit > 0 ? "positive" : overview.profit.estimatedProfit < 0 ? "danger" : "default"} />
        <Metric label="Margem" value={overview.profit.marginPct == null ? "—" : percent(overview.profit.marginPct)} sub={<>{baseDoResultado && <>{baseDoResultado} · </>}{comSemImposto(baseDoResultado ? "" : "sobre o faturamento", semAliquota)}</>} tone={overview.profit.marginPct == null ? "default" : marginMetricTone(overview.profit.marginPct)} />
      </section>
      {/* ⚠️ OS SINAIS APARECEM UMA VEZ POR TELA — corte 1 da auditoria de
          empilhamento (01/09/2026).

          A MESMA lista era passada para QUATRO pontos desta tela, e como ela tem
          até 3 sinais, a Shopee mostrava até 12 marcas "⚠" dizendo TRÊS coisas.
          Não era excesso de informação: era a mesma informação repetida, e
          repetição ensina a varrer a faixa sem ler nenhuma.

          Nada sumiu — os três sinais continuam aqui, uma vez cada, com número e
          link. O que saiu foi a repetição, e os cartões voltaram a mostrar a
          declaração de base que ela escondia. */}
      {sinais.length > 0 && <SinaisDoResultado sinais={sinais} />}

      <section className="secondary-metrics" aria-label="Indicadores operacionais Shopee">
        <CompactMetric label="Vendas" value={overview.metrics.paidOrders.toLocaleString("pt-BR")} />
        <CompactMetric label="Unidades" value={units.toLocaleString("pt-BR")} />
        <CompactMetric label="Ticket médio" value={ticket == null ? "—" : money(ticket, overview.metrics.currency)} />
        <CompactMetric label="ROI" value={roi == null ? "—" : `${roi.toFixed(1)}%`} tone={roi == null ? "default" : roi > 0 ? "positive" : roi < 0 ? "danger" : "default"} />
        <CompactMetric label="Canceladas" value={`${money(overview.metrics.cancelledRevenue, overview.metrics.currency)} · ${overview.metrics.cancelledOrders}`} tone={overview.metrics.cancelledOrders > 0 ? "danger" : "default"} />
        <CompactMetric label="Estoque crítico" value={critical.length.toLocaleString("pt-BR")} tone={critical.length > 0 ? "danger" : "default"} />
      </section>

      <section className="performance-panel shopee-performance-panel">
        <div className="performance-chart">
          <div className="mb-2 flex items-baseline justify-between gap-4">
            <div>
              <p className="section-kicker">Desempenho diário</p>
              <h2 className="mt-1 text-lg font-semibold text-[var(--ink)]">Evolução do faturamento</h2>
            </div>
            <span className="text-sm font-semibold tabular-nums text-[var(--ink)]">
              {money(overview.metrics.revenue30d, overview.metrics.currency)} <span className="font-normal text-[var(--ink-muted)]">no período</span>
            </span>
          </div>
          {/* Mesma legenda dos outros canais. A nota é o que muda: na Shopee o
              dinheiro fica no escrow até a entrega ser confirmada. */}
          <LegendaDeVendas
            confirmados={{ pedidos: overview.metrics.paidOrders, valor: overview.metrics.revenue30d }}
            aguardando={{
              pedidos: Math.max(0, overview.metrics.orders30d - overview.metrics.paidOrders - overview.metrics.cancelledOrders),
              // O canônico da Shopee não separa o valor dos pendentes. `null` e
              // não zero: a legenda mostra a quantidade e omite o valor.
              valor: null,
            }}
            cancelados={{ pedidos: overview.metrics.cancelledOrders }}
            nota="A Shopee retém o valor da venda no escrow até a entrega ser confirmada."
            money={(valor) => money(valor, overview.metrics.currency)}
          />
          <RevenueChart points={overview.dailySales} currency={overview.metrics.currency} explorable />
        </div>
        <FinancialSummaryPanel
          complete={!resultIncomplete}
          labelledBy="shopee-financial-summary-title"
          description={profitCoverage.complete ? "Valores efetivamente identificados no período." : `Detalhamento processado em ${profitCoverage.processedOrders} de ${profitCoverage.paidOrders} vendas.`}
          total={overview.profit.revenueProcessed}
          totalLabel="Receita processada"
          format={(value) => money(value, overview.metrics.currency)}
          slices={buildFinancialComposition({
            total: overview.profit.revenueProcessed,
            costs: [
              { id: "fees", label: "Taxas da Shopee", value: overview.profit.fees },
              { id: "shipping", label: "Frete do vendedor", value: overview.profit.sellerShipping },
              { id: "ads", label: "Anúncios", value: overview.profit.ads },
              { id: "withheld", label: "Impostos retidos", value: overview.profit.taxesWithheld },
              { id: "refunds", label: "Estornos", value: overview.profit.refunds },
              { id: "cogs", label: "Custo dos produtos", value: overview.profit.cogs },
              { id: "taxes", label: "Impostos", value: overview.profit.taxes },
            ],
            result: resultIncomplete ? null : overview.profit.estimatedProfit,
          })}
          footer={(
            <>
              <Link href="/shopee/monitor" className="meli-financial-link">Ver composição completa no monitor <span aria-hidden="true">→</span></Link>
              <Link href="/shopee/produtos" className="meli-financial-link">Configurar custos e imposto <span aria-hidden="true">→</span></Link>
              {overview.profit.taxRate == null && <Link href={shopeeTaxRateHref(overview.account.id)} className="meli-financial-link">Cadastrar alíquota <span aria-hidden="true">→</span></Link>}
              {!overview.profit.feesComplete && (
                <p className="text-xs leading-relaxed text-amber-700">
                  {/* ⚠️ A frase NÃO ATRIBUI CAUSA, e isso é decisão, não descuido.
                      A anterior dizia "a Shopee ainda não postou" — culpava o
                      fornecedor dela por algo que em boa parte é nosso: o cursor
                      do escrow pulava pedidos e `settlement_attempt_at` estava
                      nulo em 20.162 de 20.162, então NÃO HÁ COMO SABER de quem é
                      a espera. É o mesmo defeito das três telas da manhã com a
                      fralda trocada: no escuro o sistema escolhe uma explicação,
                      e nunca escolhe a si mesmo.
                      Quando o carimbo tiver histórico, isto volta a distinguir —
                      "a Shopee ainda não liberou" e "ainda não consultamos" —
                      porque a ação dela é diferente em cada caso. */}
                  {vendasSemTarifa > 0
                    ? `${vendasSemTarifa} de ${profitCoverage.processedOrders} vendas do período ainda estão sem a tarifa da Shopee registrada — sem ela não dá para fechar o lucro.`
                    : "Ainda falta a tarifa da Shopee de parte das vendas do período — sem ela não dá para fechar o lucro."} <Link href="/shopee/monitor" className="font-semibold text-[var(--acao)] underline-offset-2 hover:underline">Ver no monitor <span aria-hidden="true">→</span></Link>
                </p>
              )}
              {overview.profit.unitsWithoutCost > 0 && (
                <p className="text-xs leading-relaxed text-amber-700">{overview.profit.unitsWithoutCost} unidade(s) vendida(s) ainda estão sem custo cadastrado.</p>
              )}
            </>
          )}
        >
            <Flow label={profitCoverage.complete ? "Receita paga" : "Receita processada"} value={money(overview.profit.revenueProcessed, overview.metrics.currency)} />
            <FlowExpandable
              label="Custos do canal e do produto"
              value={knownCosts == null ? "—" : money(knownCosts, overview.metrics.currency)}
              open={costsOpen}
              onToggle={() => setCostsOpen((open) => !open)}
              items={[
                { label: "Taxas da Shopee", value: overview.profit.fees == null ? "—" : money(overview.profit.fees, overview.metrics.currency) },
                { label: "Frete pago pelo vendedor", value: overview.profit.sellerShipping == null ? "—" : money(overview.profit.sellerShipping, overview.metrics.currency) },
                { label: "Anúncios", value: overview.profit.ads == null ? "—" : money(overview.profit.ads, overview.metrics.currency) },
                { label: "Impostos retidos", value: overview.profit.taxesWithheld == null ? "—" : money(overview.profit.taxesWithheld, overview.metrics.currency) },
                { label: "Estornos", value: overview.profit.refunds == null ? "—" : money(overview.profit.refunds, overview.metrics.currency) },
                { label: "Custo dos produtos", value: overview.profit.cogs == null ? "—" : money(overview.profit.cogs, overview.metrics.currency) },
                { label: shopeeTaxLabel(overview.profit.taxRate), value: overview.profit.taxes == null ? "—" : money(overview.profit.taxes, overview.metrics.currency) },
              ]}
            />
            <Flow label={overview.profit.estimatedProfit == null ? "Lucro indisponível" : comSemImposto("Lucro estimado", semAliquota)} value={overview.profit.estimatedProfit == null ? "—" : <>{money(overview.profit.estimatedProfit, overview.metrics.currency)}</>} sign="=" accent tone={overview.profit.estimatedProfit == null ? "default" : overview.profit.estimatedProfit > 0 ? "positive" : overview.profit.estimatedProfit < 0 ? "danger" : "default"} />
            <Flow
              label={comSemImposto("Margem", semAliquota)}
              value={overview.profit.marginPct == null ? "—" : <>{percent(overview.profit.marginPct)}</>}
              accent
              tone={overview.profit.marginPct == null ? "default" : marginMetricTone(overview.profit.marginPct)}
            />
        </FinancialSummaryPanel>
      </section>

      <TopProductsRanking
        products={overview.topProducts.map((product) => ({ sku: product.sku || product.id, title: product.title, units: product.units, revenue: product.revenue, marginPct: product.marginPct }))}
        currency={overview.metrics.currency}
        productsHref="/shopee/produtos"
      />

      <div className="shopee-detail-grid">
        <Panel title="Estoque crítico" href="/shopee/estoque" linkLabel="Ver radar">
          {critical.length === 0 ? <Empty>Nenhum produto em ruptura iminente.</Empty> : (
            <ul className="divide-y divide-[var(--line)]">
              {critical.slice(0, 6).map((product) => (
                <li key={product.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="min-w-0 truncate pr-3">{product.title || product.sku || product.id}</span>
                  <span className="shrink-0 font-semibold text-red-600">{product.status === "out" ? "esgotado" : `${product.daysRemaining} dias`}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Pedidos recentes" href="/shopee/monitor?secao=vendas" linkLabel="Ver todos os pedidos">
          {overview.recentOrders.length === 0 ? <Empty>Nenhum pedido no período.</Empty> : (
            <ul className="divide-y divide-[var(--line)]">
              {overview.recentOrders.slice(0, 6).map((order) => (
                <li key={order.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs text-[var(--ink-muted)]">#{order.id}</span>
                    <span className="text-xs text-[var(--ink-muted)]">{brDate(order.createdAt)} · {orderStatus(order.status)}</span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">{money(order.total, order.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <section className="shopee-profitability-section">
        {!overview.profitabilityPage.complete && <div role="status" className="mb-3 integration-message is-error">Exibindo {overview.profitabilityPage.offset + 1}–{overview.profitabilityPage.offset + overview.profitabilityPage.returnedOrders} de {overview.profitabilityPage.totalOrders} pedido(s). Há mais resultados.</div>}
        <OrderProfitabilityTable lines={overview.profitabilityLines} />
        <nav aria-label="Paginação da rentabilidade" className="mt-3 flex justify-end gap-2"><button type="button" className="min-h-11 rounded-lg px-4 shadow-[inset_0_0_0_1px_rgb(203_213_225)] active:scale-[0.96] transition-transform disabled:opacity-40" disabled={overview.profitabilityPage.offset===0} onClick={()=>onPage(Math.max(0,overview.profitabilityPage.offset-overview.profitabilityPage.limit))}>Anterior</button><button type="button" className="min-h-11 rounded-lg px-4 shadow-[inset_0_0_0_1px_rgb(203_213_225)] active:scale-[0.96] transition-transform disabled:opacity-40" disabled={!overview.profitabilityPage.hasMore} onClick={()=>onPage(overview.profitabilityPage.offset+overview.profitabilityPage.limit)}>Próxima</button></nav>
      </section>

    </div>
  );
}

function Panel({ title, href, linkLabel, children }: { title: string; href: string; linkLabel: string; children: React.ReactNode }) {
  return (
    <section className="shopee-detail-panel">
      <div className="mb-3 flex items-center justify-between border-b border-[var(--line)] pb-3">
        <h2 className="text-[13px] font-semibold text-[var(--ink-soft)]">{title}</h2>
        <Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--acao)] hover:gap-1.5 hover:opacity-80">{linkLabel}<span aria-hidden="true">→</span></Link>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <EmptyState compact title={String(children)} />;
}

function ShopeeFrame({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <IntegrationDashboardFrame
      className="channel-dashboard shopee-dashboard-page"
      header={<PageHeader eyebrow="Shopee" title="Visão do canal" subtitle={subtitle} />}
    >
      {children}
    </IntegrationDashboardFrame>
  );
}
