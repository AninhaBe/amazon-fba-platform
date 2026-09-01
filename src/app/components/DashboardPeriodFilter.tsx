"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowRight, CalendarRange } from "lucide-react";

import { diaEmBrasilia } from "./janelaDeDias";

export type DashboardPeriodOption = "today" | "7" | "15" | "30" | "custom";

/**
 * O PERÍODO PADRÃO É HOJE — pedido da Ana em 31/08/2026:
 *
 *   *"Todo click no dashboard (para Mercado Livre, Amazon, Shopee e TikTok)
 *   precisa entrar com o Hoje clicado ao invés de 30 dias. O carregamento é mais
 *   rápido e a necessidade principal é saber o lucro de hoje."*
 *
 * ⚠️ O padrão vale só para quem NÃO escolheu. A escolha da pessoa vive na URL
 * (`?days=…` ou `?from=&to=`), e o efeito abaixo a respeita: quem está com 30
 * dias no endereço continua com 30 dias, inclusive ao recarregar e ao voltar
 * pelo histórico do navegador.
 *
 * ⚠️ Mudar aqui muda os QUATRO canais de uma vez, porque os quatro usam este
 * mesmo hook. É de propósito: dois dashboards com padrões diferentes seriam a
 * inconsistência que a regra de replicar existe para impedir.
 *
 * ⚠️ DAS DUAS RAZÕES DO PEDIDO, SÓ UMA SOBREVIVEU À MEDIÇÃO (31/08/2026).
 *
 * A razão de PRODUTO — *"a necessidade principal é saber o lucro de hoje"* —
 * está de pé e basta sozinha: é o número que ela abre a tela para ver.
 *
 * A razão de VELOCIDADE — *"o carregamento é mais rápido"* — foi medida e é
 * quase nada. `getAmazonOverviewFromCanonical` nas duas janelas, mesmo
 * workspace, mesmo processo, ordem alternada, 7 voltas, mediana:
 *
 *   workspace 6c877b36 — Hoje 198 ms · 30 dias 205 ms  (+7 ms,  1,04×)
 *   workspace fa6b806b — Hoje 188 ms · 30 dias 215 ms  (+28 ms, 1,15×)
 *
 * Trinta vezes mais dias custam entre 4% e 15% — abaixo do que se percebe num
 * clique. A lentidão que ela relatou ("hoje e 7 rápidos, 15 lento") NÃO vem do
 * tamanho da janela: vem do aquecimento de fundo, que era sequencial e deixava
 * a última janela pronta aos ~3,8 s. São 3.800 ms contra 28 ms — duas ordens de
 * grandeza, e é lá que o conserto mora (`prefetchDePeriodos.ts`).
 *
 * Quem for reabrir esta escolha: o argumento de desempenho não a sustenta, e
 * agora existe o número. A decisão continua sendo de produto.
 */
const PERIODO_PADRAO: Exclude<DashboardPeriodOption, "custom"> = "today";

export function useDashboardPeriod(
  initialQuery = "",
  onQueryChange?: (query: string) => void,
  /**
   * O QUE ESTA TELA OFERECE. Sem isto, unificar o seletor de uma tela que não é
   * dashboard mudaria em silêncio o que ela mostra.
   *
   * ⚠️ Existe por causa da Curva ABC (01/09/2026). Ela tinha um SEGUNDO seletor,
   * escrito à mão com `useState`, com 7/15/30 e padrão 30 — a divergência que a
   * gente já viu virar defeito no default do servidor. Trocar pela peça
   * compartilhada sem esta opção traria dois efeitos que ninguém pediu:
   *
   *   • **padrão viraria "Hoje"**, e uma curva ABC de um dia classifica produto
   *     por uma amostra de um dia. O pedido do "Hoje" foi para os DASHBOARDS de
   *     canal ("saber o lucro de hoje"); ABC é tela de análise, e volume é a
   *     matéria-prima dela;
   *   • **apareceria "Personalizado"**, e as rotas de ABC leem só `days`. A
   *     tela mostraria o botão marcado exibindo outro período — exatamente o
   *     defeito do `from`/`to` da Shopee.
   *
   * Então: uma implementação só, e cada tela declara o que oferece.
   */
  opcoes?: { padrao?: Exclude<DashboardPeriodOption, "custom">; presets?: readonly Exclude<DashboardPeriodOption, "custom">[] },
) {
  const padrao = opcoes?.padrao ?? PERIODO_PADRAO;
  const initial = new URLSearchParams(initialQuery);
  const hasCustomPeriod = Boolean(initial.get("from") && initial.get("to"));
  const [selected, setSelected] = useState<DashboardPeriodOption>(hasCustomPeriod ? "custom" : padrao);
  const [query, setQuery] = useState(hasCustomPeriod ? new URLSearchParams({ from: initial.get("from")!, to: initial.get("to")! }).toString() : `days=${padrao}`);
  const [from, setFrom] = useState(hasCustomPeriod ? initial.get("from")! : "");
  const [to, setTo] = useState(hasCustomPeriod ? initial.get("to")! : "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // URL is an external source of truth; navigation (including popstate) must replace the draft.
    const current = new URLSearchParams(initialQuery);
    const nextFrom = current.get("from") ?? "";
    const nextTo = current.get("to") ?? "";
    if (nextFrom && nextTo) {
      queueMicrotask(() => { setSelected("custom"); setFrom(nextFrom); setTo(nextTo); setQuery(new URLSearchParams({ from: nextFrom, to: nextTo }).toString()); setError(null); }); return;
    }
    const days = current.get("days");
    if (days === "today" || days === "7" || days === "15" || days === "30") {
      queueMicrotask(() => { setSelected(days); setFrom(""); setTo(""); setQuery(`days=${days}`); setError(null); });
    }
  }, [initialQuery]);

  function selectPreset(value: Exclude<DashboardPeriodOption, "custom">) {
    setSelected(value);
    setError(null);
    setQuery(`days=${value}`);
    onQueryChange?.(`days=${value}`);
  }

  function selectCustom() {
    setSelected("custom");
    setError(null);
  }

  function applyCustom() {
    if (!from || !to) {
      setError("Selecione a data inicial e a data final.");
      return;
    }
    const initialDate = new Date(`${from}T00:00:00`);
    const finalDate = new Date(`${to}T00:00:00`);
    if (initialDate > finalDate) {
      setError("A data inicial precisa ser anterior à data final.");
      return;
    }
    if (finalDate.getTime() - initialDate.getTime() > 365 * 86_400_000) {
      setError("O período pode ter no máximo 365 dias.");
      return;
    }
    setError(null);
    const nextQuery = new URLSearchParams({ from, to }).toString();
    setQuery(nextQuery);
    onQueryChange?.(nextQuery);
  }

  // Rótulo do período em prosa, para entrar em FRASE — "3 vendas hoje", "12
  // vendas nos últimos 7 dias". O filtro já sabia o período ativo, mas só como
  // valor ("7"); sem isto, cada canal remontaria o texto por conta e os quatro
  // escreveriam diferente.
  const label =
    selected === "today" ? "hoje"
      : selected === "custom" ? "no período selecionado"
        : `nos últimos ${selected} dias`;

  return {
    query,
    label,
    filterProps: { selected, from, to, error, onPreset: selectPreset, onCustom: selectCustom, onFrom: setFrom, onTo: setTo, onApply: applyCustom, presets: opcoes?.presets },
  };
}

export function DashboardPeriodFilter({ selected, from, to, error, onPreset, onCustom, onFrom, onTo, onApply, onIntent, intencaoPor = "ponteiro-e-foco", presets, meta }: {
  selected: DashboardPeriodOption;
  from: string;
  to: string;
  error: string | null;
  onPreset: (value: Exclude<DashboardPeriodOption, "custom">) => void;
  onCustom: () => void;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  onApply: () => void;
  /**
   * Avisa que a pessoa está PRESTES a escolher este período (ponteiro em cima
   * ou foco pelo teclado), para o canal já ir buscar.
   *
   * Medido em produção em 28/08/2026: o aquecimento de fundo é sequencial e a
   * última janela só ficava pronta aos ~3,8s. Quem clicava antes disso pagava
   * a espera inteira — era o "hoje e 7 rápidos, 15 lento" que ela relatou.
   * Avisar na intenção acerta exatamente o período que ela vai clicar, sem
   * ninguém precisar adivinhar qual ela mais usa (não há telemetria de uso, e
   * chutar seria dado inventado). São ~650ms por janela contra os 300–800ms
   * entre passar o mouse e clicar.
   *
   * Opcional de propósito: tela que não passa nada continua exatamente igual.
   */
  onIntent?: (query: string) => void;
  /**
   * QUEM DISPARA A INTENÇÃO. `"ponteiro-e-foco"` (padrão) mantém as telas que
   * já tinham; `"foco"` liga só o teclado.
   *
   * ⚠️ A DIFERENÇA É DE CUSTO, e ela foi MEDIDA em 31/08/2026 — não é
   * preferência de desenho:
   *
   * | tela | requisições antes → depois |
   * |---|---|
   * | sem cache por período (era o caso de `/ads`) | 4 → 4, não sobe |
   * | com cache por período (`/monitor`, central, módulos) | 3 → **4** |
   *
   * Numa tela que já guarda o período, a antecipação por PONTEIRO não tem o que
   * compensar: ela soma exatamente uma requisição por vez que o ponteiro PARA
   * mais de 120 ms sobre um botão e depois não clica. Com o banco em 6% de
   * folga, aceitar isso exigiria saber quantos hovers viram clique — e esse
   * dado não existe. Chutar seria dado inventado, a mesma proibição que vale
   * para número na tela.
   *
   * ⚠️ O FOCO NÃO É GRÁTIS POR CONSTRUÇÃO — e isto está escrito porque a
   * primeira versão desta nota dizia que era. **Foco e ponteiro são
   * MECANICAMENTE IGUAIS:** os dois só disparam quando o cursor PARA mais de
   * 120 ms sobre o botão (o debounce do hook), e os dois somam uma requisição
   * quando a parada não vira ativação. Tab que passa reto não custa nada, do
   * mesmo jeito que varrer a faixa com o mouse não custa nada. Medido:
   *
   * | sessão de teclado | requisições |
   * |---|---|
   * | todo foco vira Enter | 3 → 3, zero a mais |
   * | um foco parado sem Enter | 3 → **4** |
   *
   * O que separa os dois não é estrutura, é **FREQUÊNCIA**. E por isso o modo
   * `"foco"` está ligado sob **SUPOSIÇÃO COMPORTAMENTAL DECLARADA**, aceita
   * pelo cérebro em 01/09/2026 e não confundida com medição:
   *
   * > *quem chega a um controle pelo teclado chega para usá-lo.*
   *
   * Com ponteiro, parar sobre um controle sem ativar é comportamento normal —
   * ler, hesitar, seguir para outro lugar. Com teclado, o foco é o cursor.
   *
   * **O custo real, se a suposição não valer, é +1 requisição por foco que não
   * vira ativação.** Quem medir e derrubar a suposição volta atrás com um
   * commit: basta tirar `intencaoPor="foco"` das telas. Não reabra isto achando
   * que descobriu que o foco custa alguma coisa — está aqui, com o número.
   *
   * E é a única cobertura de acessibilidade que a antecipação tem.
   *
   * 📌 REABERTURA CONDICIONADA (decidida em 31/08/2026, não esquecida): ligar o
   * ponteiro nas telas com cache volta à mesa **quando existir telemetria de
   * hover** que diga a taxa de conversão. Antes disso, não — e quem ligar sem o
   * número está trocando uma medição por um palpite.
   */
  intencaoPor?: "ponteiro-e-foco" | "foco";
  /**
   * Quais presets a tela oferece. Ausente = os quatro, e o "Personalizado"
   * junto — o comportamento de todos os dashboards.
   *
   * ⚠️ Uma lista sem os quatro ESCONDE o "Personalizado", e não é economia de
   * botão: a tela que declara um subconjunto é a que tem rota lendo só `days`,
   * e oferecer intervalo ali mostraria o botão marcado sobre outro período.
   * Quando a rota aceitar `from`/`to`, some com a lista e os dois voltam juntos.
   */
  presets?: readonly Exclude<DashboardPeriodOption, "custom">[];
  meta?: ReactNode;
}) {
  // O teto dos campos de data é o dia de HOJE em Brasília, e a expressão disso
  // mora num lugar só (`janelaDeDias`) desde 01/09/2026 — era uma cópia aqui e
  // outra, errada, no módulo do TikTok.
  const today = diaEmBrasilia();
  const TODAS = [{ value: "today", label: "Hoje" }, { value: "7", label: "7 dias" }, { value: "15", label: "15 dias" }, { value: "30", label: "30 dias" }] as const;
  const options = presets ? TODAS.filter((o) => presets.includes(o.value)) : TODAS;
  // O intervalo só é oferecido quando a tela oferece os quatro presets — ver a
  // nota em `presets`.
  const ofereceIntervalo = !presets;

  // O filtro é a interação principal do dashboard: fica sticky no desktop e
  // ganha elevação quando "cola" no topo. A sentinela 1px acima dele detecta
  // o momento exato sem escutar scroll.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), { threshold: 0 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return <>
    <div ref={sentinelRef} aria-hidden="true" className="dashboard-period-sentinel" />
    <section className={`dashboard-period-filter${stuck ? " is-stuck" : ""}`} aria-label="Período dos indicadores">
    <div className="dashboard-period-presets" role="group" aria-label="Períodos rápidos">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={selected === option.value}
          className={selected === option.value ? "is-active" : ""}
          onClick={() => onPreset(option.value)}
          onPointerEnter={intencaoPor === "foco" ? undefined : () => onIntent?.(`days=${option.value}`)}
          onFocus={() => onIntent?.(`days=${option.value}`)}
        >
          {option.label}
        </button>
      ))}
      {ofereceIntervalo && <button type="button" aria-pressed={selected === "custom"} className={selected === "custom" ? "is-active" : ""} onClick={onCustom}>Personalizado</button>}
    </div>
    {ofereceIntervalo && selected === "custom" && <div className="dashboard-custom-period">
      <div className="dashboard-custom-period-intro">
        <span><CalendarRange aria-hidden="true" /></span>
        <div><strong>Escolha o intervalo</strong><small>Até 365 dias</small></div>
      </div>
      <div className="dashboard-custom-period-fields">
        <label><span>Data inicial</span><input type="date" value={from} max={to || today} onChange={(event) => onFrom(event.target.value)} /></label>
        <ArrowRight aria-hidden="true" />
        <label><span>Data final</span><input type="date" value={to} min={from} max={today} onChange={(event) => onTo(event.target.value)} /></label>
      </div>
      <button type="button" className="dashboard-period-apply" onClick={onApply}>Aplicar período<ArrowRight aria-hidden="true" /></button>
      {error && <p role="alert">{error}</p>}
    </div>}
    {meta && <div className="dashboard-period-meta">{meta}</div>}
    </section>
  </>;
}
