"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import {
  ArrowRight,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDot,
  ExternalLink,
  MousePointer2,
  Pause,
  Play,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { MarketplaceIcon } from "../components/MarketplaceIcon";
import { NexoWordmark } from "../components/NexoWordmark";
import { RevenueChart, type ChartMetric } from "../components/RevenueChart";
import { NexoDemoMessage } from "./NexoDemoMessage";
import {
  DEMO_CHANNELS,
  DEMO_PERIODS,
  aggregateChannel,
  aggregateProducts,
  dailyChart,
  demoOperation,
  derivePriorities,
  formatMoney,
  formatPercent,
  percentageChange,
  type DemoChannelId,
  type DemoPeriod,
  type DemoPriority,
} from "./operacaoDemo";
import styles from "./landing-v2.module.css";

const SEVERITY_ICON = {
  critical: CircleAlert,
  attention: CircleDot,
  observe: CircleCheck,
};

type SortKey = "revenueCents" | "productCostCents" | "marginPct";

const GUIDED_STEPS: Array<{
  target: string;
  period?: DemoPeriod;
  channel?: DemoChannelId;
  metric?: ChartMetric;
}> = [
  { target: "period-15", period: 15 },
  { target: "channel-mercado_livre", channel: "mercado_livre" },
  { target: "landing-v2-metric-orders", metric: "orders" },
  { target: "period-30", period: 30 },
  { target: "channel-shopee", channel: "shopee" },
  { target: "landing-v2-metric-units", metric: "units" },
  { target: "channel-tiktok_shop", channel: "tiktok_shop" },
  { target: "period-7", period: 7 },
  { target: "channel-amazon", channel: "amazon" },
  { target: "landing-v2-metric-revenue", metric: "revenue" },
];

function moveTabFocus(event: KeyboardEvent<HTMLButtonElement>, index: number, total: number) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const direction = event.key === "ArrowRight" ? 1 : -1;
  const next = (index + direction + total) % total;
  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']")[next]?.focus();
}

function PriorityCard({
  priority,
  expanded,
  selectedAction,
  revealDelay,
  onToggle,
  onAction,
}: {
  priority: DemoPriority;
  expanded: boolean;
  selectedAction: boolean;
  revealDelay: string;
  onToggle: () => void;
  onAction: () => void;
}) {
  const Icon = SEVERITY_ICON[priority.severity];
  const detailsId = `prioridade-${priority.id}`;
  return (
    <article
      className={`${styles.priorityCard} ${styles[priority.severity]}`}
      data-reveal
      style={{ "--reveal-delay": revealDelay } as CSSProperties}
    >
      <button
        type="button"
        className={styles.prioritySummary}
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={onToggle}
      >
        <span className={styles.priorityOrder}>{priority.order}</span>
        <span className={styles.priorityTitleGroup}>
          <span className={styles.severityLabel}><Icon aria-hidden="true" />{priority.label}</span>
          <strong>{priority.title}</strong>
        </span>
        <span className={styles.priorityHeadline}>
          <small>Impacto</small>
          <strong>{priority.impact}</strong>
        </span>
        <ChevronDown className={styles.chevron} aria-hidden="true" />
      </button>
      {expanded && (
        <div id={detailsId} className={styles.priorityDetails}>
          <div>
            <span>Evidência</span>
            <strong>{priority.evidence}</strong>
            <p>{priority.evidenceDetail}</p>
          </div>
          <div>
            <span>Leitura do impacto</span>
            <strong>{priority.impact}</strong>
            <p>{priority.impactDetail}</p>
          </div>
          <button type="button" className={styles.nextAction} onClick={onAction}>
            {priority.nextStep}<ArrowRight aria-hidden="true" />
          </button>
        </div>
      )}
      {selectedAction && (
        <div className={styles.inlineConversion} role="status">
          <div>
            <span>Próximo passo</span>
            <strong>Quer {priority.actionIntent}?</strong>
            <p>Conecte sua operação ao NEXO e leve esta leitura para os seus dados.</p>
          </div>
          <Link href="/login?mode=signup" className={styles.primaryButton}>
            Conectar minha operação<ArrowRight aria-hidden="true" />
          </Link>
        </div>
      )}
    </article>
  );
}

export function LandingV2Experience() {
  const [period, setPeriod] = useState<DemoPeriod>(7);
  const [channel, setChannel] = useState<DemoChannelId>("amazon");
  const [metric, setMetric] = useState<ChartMetric>("revenue");
  const [sortKey, setSortKey] = useState<SortKey>("revenueCents");
  const [expandedPriority, setExpandedPriority] = useState<string>("mercado-livre");
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [guidedDemo, setGuidedDemo] = useState(false);
  const [guidedStepIndex, setGuidedStepIndex] = useState(0);
  const [cursorClicking, setCursorClicking] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0, ready: false });
  const pageRef = useRef<HTMLElement>(null);
  const explorationRef = useRef<HTMLElement>(null);
  const guidedEnabledRef = useRef(true);
  const priorities = useMemo(() => derivePriorities(demoOperation), []);
  const activeChannel = DEMO_CHANNELS.find((item) => item.id === channel)!;
  const totals = aggregateChannel(demoOperation, channel, period);
  const previous = aggregateChannel(demoOperation, channel, period, period);
  const revenueChange = percentageChange(totals.revenueCents, previous.revenueCents);
  const chart = dailyChart(demoOperation, channel, period);
  const products = aggregateProducts(demoOperation, channel, period).sort((a, b) => {
    const av = a[sortKey] ?? Number.NEGATIVE_INFINITY;
    const bv = b[sortKey] ?? Number.NEGATIVE_INFINITY;
    return bv - av;
  });

  useEffect(() => {
    const root = pageRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    root.classList.add(styles.motionReady);
    const revealable = root.querySelectorAll<HTMLElement>("[data-reveal]");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add(styles.revealed);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );

    revealable.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const exploration = explorationRef.current;
    if (
      !exploration
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches
      || window.matchMedia("(max-width: 700px)").matches
    ) {
      guidedEnabledRef.current = false;
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        setGuidedDemo(entry.isIntersecting && guidedEnabledRef.current);
      },
      { threshold: 0.12, rootMargin: "-10% 0px -10% 0px" },
    );
    observer.observe(exploration);
    return () => observer.disconnect();
  }, []);

  const guidedStep = GUIDED_STEPS[guidedStepIndex % GUIDED_STEPS.length];

  useEffect(() => {
    if (!guidedDemo) return;

    const clickTimer = window.setTimeout(() => {
      if (guidedStep.period) setPeriod(guidedStep.period);
      if (guidedStep.channel) setChannel(guidedStep.channel);
      if (guidedStep.metric) setMetric(guidedStep.metric);
      setCursorClicking(true);
    }, 820);
    const releaseTimer = window.setTimeout(() => setCursorClicking(false), 1_100);
    const nextTimer = window.setTimeout(
      () => setGuidedStepIndex((current) => (current + 1) % GUIDED_STEPS.length),
      2_300,
    );

    return () => {
      window.clearTimeout(clickTimer);
      window.clearTimeout(releaseTimer);
      window.clearTimeout(nextTimer);
    };
  }, [guidedDemo, guidedStep]);

  useEffect(() => {
    if (!guidedDemo) return;
    const frame = window.requestAnimationFrame(() => {
      const exploration = explorationRef.current;
      const target = exploration?.querySelector<HTMLElement>(`[data-demo-target="${guidedStep.target}"]`);
      if (!exploration || !target) return;
      const explorationRect = exploration.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      setCursorPosition({
        x: targetRect.left - explorationRect.left + targetRect.width * 0.68,
        y: targetRect.top - explorationRect.top + targetRect.height * 0.7,
        ready: true,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [channel, guidedDemo, guidedStep, metric, period]);

  function stopGuidedDemo() {
    guidedEnabledRef.current = false;
    setGuidedDemo(false);
    setCursorClicking(false);
    setCursorPosition((current) => ({ ...current, ready: false }));
  }

  function toggleGuidedDemo() {
    if (guidedDemo) {
      stopGuidedDemo();
      return;
    }
    guidedEnabledRef.current = true;
    setGuidedStepIndex(0);
    setGuidedDemo(true);
  }

  function choosePeriod(nextPeriod: DemoPeriod) {
    stopGuidedDemo();
    setPeriod(nextPeriod);
  }

  function chooseChannel(nextChannel: DemoChannelId) {
    stopGuidedDemo();
    setChannel(nextChannel);
    setMetric("revenue");
  }

  return (
    <>
      <header className={styles.topbar}>
        <Link href="/landing-v2" aria-label="NEXO — início" className={styles.brandLink}>
          <NexoWordmark as="span" className={styles.brand} />
        </Link>
        <p>Operação demonstrativa <span>·</span> 4 canais <span>·</span> 38 SKUs</p>
        <Link href="/login" className={styles.loginLink}>Entrar<ArrowRight aria-hidden="true" /></Link>
      </header>

      <main ref={pageRef} className={styles.page}>
        <section className={styles.intro} aria-labelledby="landing-v2-title">
          <div className={styles.introCopy}>
            <p className={styles.eyebrow}>Uma operação. Uma leitura.</p>
            <h1 id="landing-v2-title">O NEXO mostra onde agir antes de mostrar mais um painel.</h1>
            <p className={styles.lede}>
              A demonstração abaixo lê uma operação multicanal fictícia. Explore períodos e canais;
              todos os números se recalculam a partir das mesmas vendas.
            </p>
            <button type="button" className={styles.textButton} onClick={() => explorationRef.current?.scrollIntoView({ behavior: "smooth" })}>
              Explorar os dados<ArrowRight aria-hidden="true" />
            </button>
          </div>
          <div className={styles.messageStage} aria-label="Leitura do NEXO">
            <NexoDemoMessage />
          </div>
        </section>

        <section className={styles.priorities} aria-labelledby="priorities-title">
          <div className={styles.sectionHeading} data-reveal>
            <div>
              <p className={styles.eyebrow}>Leitura rápida</p>
              <h2 id="priorities-title">O que pede atenção hoje</h2>
            </div>
            <p>Abra cada ponto para conferir a evidência antes de decidir.</p>
          </div>
          <div className={styles.priorityList}>
            {priorities.map((priority) => (
              <PriorityCard
                key={priority.id}
                priority={priority}
                expanded={expandedPriority === priority.id}
                selectedAction={selectedAction === priority.id}
                revealDelay={`${(priority.order - 1) * 70}ms`}
                onToggle={() => setExpandedPriority((current) => current === priority.id ? "" : priority.id)}
                onAction={() => setSelectedAction((current) => current === priority.id ? null : priority.id)}
              />
            ))}
          </div>
        </section>

        <section ref={explorationRef} className={styles.exploration} aria-labelledby="exploration-title">
          <span
            className={`${styles.guidedCursor}${guidedDemo && cursorPosition.ready ? ` ${styles.cursorReady}` : ""}${cursorClicking ? ` ${styles.cursorClicking}` : ""}`}
            style={{ left: cursorPosition.x, top: cursorPosition.y }}
            aria-hidden="true"
          >
            <MousePointer2 />
          </span>
          <div className={styles.sectionHeading} data-reveal>
            <div>
              <p className={styles.eyebrow}>Explore a operação</p>
              <h2 id="exploration-title">Uma fonte, todos os recortes</h2>
            </div>
            <div className={styles.headingAside}>
              <p>Trocar período ou canal atualiza métricas, gráfico e produtos juntos.</p>
              <button type="button" className={styles.guidedToggle} aria-pressed={guidedDemo} onClick={toggleGuidedDemo}>
                {guidedDemo ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                {guidedDemo ? "Pausar demonstração" : "Reproduzir demonstração"}
              </button>
            </div>
          </div>

          <div className={styles.controlBar} data-reveal style={{ "--reveal-delay": "70ms" } as CSSProperties}>
            <div className={styles.periodTabs} role="tablist" aria-label="Período da demonstração">
              {DEMO_PERIODS.map((item, index) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={period === item}
                  tabIndex={period === item ? 0 : -1}
                  key={item}
                  data-demo-target={`period-${item}`}
                  onClick={() => choosePeriod(item)}
                  onKeyDown={(event) => {
                    moveTabFocus(event, index, DEMO_PERIODS.length);
                    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                      const direction = event.key === "ArrowRight" ? 1 : -1;
                      choosePeriod(DEMO_PERIODS[(index + direction + DEMO_PERIODS.length) % DEMO_PERIODS.length]);
                    }
                  }}
                >
                  {item} dias
                </button>
              ))}
            </div>
            <div className={styles.channelTabs} role="tablist" aria-label="Canal da demonstração">
              {DEMO_CHANNELS.map((item, index) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={channel === item.id}
                  tabIndex={channel === item.id ? 0 : -1}
                  key={item.id}
                  data-demo-target={`channel-${item.id}`}
                  onClick={() => chooseChannel(item.id)}
                  onKeyDown={(event) => {
                    moveTabFocus(event, index, DEMO_CHANNELS.length);
                    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                      const direction = event.key === "ArrowRight" ? 1 : -1;
                      chooseChannel(DEMO_CHANNELS[(index + direction + DEMO_CHANNELS.length) % DEMO_CHANNELS.length].id);
                    }
                  }}
                >
                  <MarketplaceIcon provider={item.provider} size={18} app />
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div
            className={styles.dataSurface}
            data-reveal
            style={{ "--channel-accent": activeChannel.accent, "--reveal-delay": "120ms" } as CSSProperties}
          >
            <div key={`${channel}-${period}-${metric}`} className={styles.dataRefresh}>
            <div className={styles.contextLine}>
              <span><MarketplaceIcon provider={activeChannel.provider} size={20} app />{activeChannel.label}</span>
              <span>Últimos {period} dias · até {new Date(`${demoOperation.generatedFor}T12:00:00`).toLocaleDateString("pt-BR")}</span>
            </div>

            <div className={styles.kpiBand}>
              <div>
                <span>Faturamento</span>
                <strong>{formatMoney(totals.revenueCents)}</strong>
                <small className={revenueChange !== null && revenueChange >= 0 ? styles.positive : styles.negative}>
                  {revenueChange !== null && revenueChange >= 0 ? <TrendingUp aria-hidden="true" /> : <TrendingDown aria-hidden="true" />}
                  {revenueChange === null ? "sem comparação" : `${Math.abs(revenueChange).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% no período`}
                </small>
              </div>
              <div>
                <span>Custos + tarifas</span>
                <strong className={styles.cost}>{formatMoney((totals.productCostCents ?? 0) + totals.feeCents)}</strong>
                <small>{formatMoney(totals.productCostCents)} em produtos</small>
              </div>
              <div>
                <span>Lucro</span>
                <strong className={styles.profit}>{formatMoney(totals.profitCents)}</strong>
                <small>{formatPercent(totals.marginPct)} de margem</small>
              </div>
              <div>
                <span>Pedidos</span>
                <strong>{totals.orders.toLocaleString("pt-BR")}</strong>
                <small>{totals.units.toLocaleString("pt-BR")} unidades</small>
              </div>
            </div>

            <div className={styles.analysisGrid}>
              <article className={styles.chartPanel}>
                <div className={styles.panelHeading}>
                  <div>
                    <p className={styles.eyebrow}>Desempenho diário</p>
                    <h3>Evolução das vendas</h3>
                  </div>
                  <strong>{metric === "revenue" ? formatMoney(totals.revenueCents) : metric === "orders" ? `${totals.orders} pedidos` : `${totals.units} unidades`}</strong>
                </div>
                <div className={styles.chartWrap} style={{ "--rev": activeChannel.accent } as CSSProperties}>
                  <RevenueChart
                    points={chart}
                    explorable
                    metric={metric}
                    demoTargetPrefix="landing-v2-metric"
                    onMetricChange={(nextMetric) => {
                      stopGuidedDemo();
                      setMetric(nextMetric);
                    }}
                  />
                </div>
              </article>

              <article className={styles.decisionPanel}>
                <p className={styles.eyebrow}>Leitura do período</p>
                <h3>{revenueChange !== null && revenueChange >= 0 ? "O canal ganhou ritmo" : "O canal perdeu ritmo"}</h3>
                <p>
                  {revenueChange === null
                    ? "Ainda não há um período anterior comparável."
                    : `${activeChannel.label} ${revenueChange >= 0 ? "cresceu" : "recuou"} ${Math.abs(revenueChange).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% contra os ${period} dias anteriores.`}
                </p>
                <dl>
                  <div><dt>Ticket médio</dt><dd>{formatMoney(totals.orders ? Math.round(totals.revenueCents / totals.orders) : null)}</dd></div>
                  <div><dt>Descontos</dt><dd>{formatMoney(totals.discountCents)}</dd></div>
                  <div><dt>Margem</dt><dd className={totals.marginPct !== null && totals.marginPct >= 0 ? styles.profit : styles.cost}>{formatPercent(totals.marginPct)}</dd></div>
                </dl>
              </article>
            </div>

            <article className={styles.productsPanel}>
              <div className={styles.panelHeading}>
                <div>
                  <p className={styles.eyebrow}>Produtos do canal</p>
                  <h3>De onde vem o resultado</h3>
                </div>
                <div className={styles.sortControls} aria-label="Ordenar produtos">
                  <span>Ordenar por</span>
                  {([
                    ["revenueCents", "Faturamento"],
                    ["productCostCents", "Custo"],
                    ["marginPct", "Margem"],
                  ] as Array<[SortKey, string]>).map(([key, label]) => (
                    <button type="button" key={key} aria-pressed={sortKey === key} onClick={() => setSortKey(key)}>{label}</button>
                  ))}
                </div>
              </div>
              <div className={styles.tableScroller}>
                <table>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Pedidos</th>
                      <th aria-sort={sortKey === "revenueCents" ? "descending" : "none"}>Faturamento</th>
                      <th aria-sort={sortKey === "productCostCents" ? "descending" : "none"}>Custo</th>
                      <th>Lucro</th>
                      <th aria-sort={sortKey === "marginPct" ? "descending" : "none"}>Margem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((row) => (
                      <tr key={row.product.id}>
                        <th scope="row"><strong>{row.product.name}</strong><span>{row.product.sku}</span></th>
                        <td>{row.orders.toLocaleString("pt-BR")}</td>
                        <td>{formatMoney(row.revenueCents)}</td>
                        <td className={styles.cost}>{formatMoney(row.productCostCents)}</td>
                        <td className={styles.profit}>{formatMoney(row.profitCents)}</td>
                        <td className={row.marginPct !== null && row.marginPct >= 0 ? styles.profit : styles.cost}>{formatPercent(row.marginPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>Total do canal</th>
                      <td>{totals.orders.toLocaleString("pt-BR")}</td>
                      <td>{formatMoney(totals.revenueCents)}</td>
                      <td className={styles.cost}>{formatMoney(totals.productCostCents)}</td>
                      <td className={styles.profit}>{formatMoney(totals.profitCents)}</td>
                      <td className={styles.profit}>{formatPercent(totals.marginPct)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className={styles.dataNote}>Dados fictícios para demonstração. Nenhuma conta ou integração é acessada nesta página.</p>
            </article>
            </div>
          </div>
        </section>

        <section className={styles.support} aria-labelledby="support-title">
          <div className={styles.sectionHeading} data-reveal>
            <div>
              <p className={styles.eyebrow}>Além da leitura diária</p>
              <h2 id="support-title">A conta continua até o dinheiro fechar.</h2>
            </div>
            <p>O NEXO mantém venda, recebimento e conferência ligados ao mesmo pedido.</p>
          </div>
          <div className={styles.supportGrid}>
            <article data-reveal>
              <span>Financeiro</span>
              <h3>Fecha a conta com a tarifa real</h3>
              <p>Faturamento, desconto, comissão e custo aparecem separados. Se o custo não existe, o lucro não vira zero.</p>
            </article>
            <article data-reveal style={{ "--reveal-delay": "70ms" } as CSSProperties}>
              <span>Saldo</span>
              <h3>Acompanha quando o dinheiro libera</h3>
              <p>Cada venda preserva sua própria data e seu valor líquido, sem transformar o repasse em média.</p>
            </article>
            <article data-reveal style={{ "--reveal-delay": "140ms" } as CSSProperties}>
              <span>Auditoria</span>
              <h3>Compara o frete pedido a pedido</h3>
              <p>O valor cobrado fica ao lado do valor declarado no envio para você decidir o que precisa ser revisto.</p>
            </article>
          </div>
        </section>

        <section className={styles.process} aria-labelledby="process-title">
          <div data-reveal>
            <p className={styles.eyebrow}>Como o NEXO trabalha</p>
            <h2 id="process-title">Você vende. O NEXO confere.</h2>
          </div>
          <ol>
            <li data-reveal><span>1</span><div><strong>Lê cada venda</strong><p>Pedido, tarifa, desconto e custo entram no mesmo contexto.</p></div></li>
            <li data-reveal style={{ "--reveal-delay": "70ms" } as CSSProperties}><span>2</span><div><strong>Fecha a conta</strong><p>Faturamento, custo e lucro usam a mesma base, sem estimar o que falta.</p></div></li>
            <li data-reveal style={{ "--reveal-delay": "140ms" } as CSSProperties}><span>3</span><div><strong>Mostra onde agir</strong><p>A evidência aparece antes do próximo passo.</p></div></li>
          </ol>
        </section>

        <section className={styles.measured} aria-label="Números medidos da plataforma" data-reveal>
          <div><strong>70.479</strong><span>pedidos já conferidos</span></div>
          <div><strong>4</strong><span>canais acompanhados</span></div>
          <div><strong>1</strong><span>visão para a operação</span></div>
        </section>

        <section className={styles.finalCta} data-reveal>
          <p className={styles.eyebrow}>Próxima decisão</p>
          <h2>Veja a sua operação com o mesmo contexto.</h2>
          <p>Conecte um canal e veja o que pede atenção na sua operação.</p>
          <Link href="/login?mode=signup" className={styles.primaryButton}>Conectar minha operação<ArrowRight aria-hidden="true" /></Link>
        </section>
      </main>

      <footer className={styles.footer}>
        <NexoWordmark as="span" className={styles.footerBrand} />
        <span>Operação multicanal com dados explícitos.</span>
        <nav aria-label="Links institucionais">
          <Link href="/privacidade">Privacidade</Link>
          <Link href="/login">Entrar<ExternalLink aria-hidden="true" /></Link>
        </nav>
      </footer>
    </>
  );
}
