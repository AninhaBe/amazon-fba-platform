"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, Info, Pin, PinOff, X } from "lucide-react";
import { PageHeader, pageIcons } from "../../components/PageHeader";
import { TableLoading } from "../../components/LoadingState";
import { EmptyState } from "../../components/EmptyState";
import { Pagination } from "../../components/Pagination";
import { readJson } from "../../../lib/readJson";
import { brDate } from "../../../lib/datetime";

interface RankPoint {
  date: string;
  rank: number;
}

interface WatchItem {
  asin: string;
  title?: string;
  brand?: string;
  imageUrl?: string;
  lastSearchTerm?: string;
  firstSeenAt: string;
  pinned: boolean;
  category?: string;
  currentRank?: number;
  currentDate?: string;
  delta7?: number;
  delta30?: number;
  deltaUltima?: number;
  ultimaDe?: string;
  ultimaRank?: number;
  series: RankPoint[];
}

type SortKey = "recentes" | "alta" | "queda";

const PAGE_SIZE = 30;

// Curva de posição dos últimos 30 dias. Posição menor é melhor, então o ponto de
// menor rank fica no topo — como o eixo Y do SVG cresce para baixo, plotar o rank
// direto já produz a leitura certa: linha subindo = produto subindo.
function Sparkline({ points }: { points: RankPoint[] }) {
  const w = 84;
  const h = 26;
  if (points.length < 2) {
    return (
      <span className="text-xs text-slate-300" title="Precisa de pelo menos duas fotos para desenhar a curva">
        —
      </span>
    );
  }
  const ranks = points.map((p) => p.rank);
  const min = Math.min(...ranks);
  const max = Math.max(...ranks);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const coords = points.map((p, i) => [i * step, ((p.rank - min) / span) * (h - 4) + 2] as const);
  const d = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = coords[coords.length - 1];
  // Mesma semântica das setas: verde subiu, vermelho caiu, âmbar manteve.
  const variacao = points[0].rank - points[points.length - 1].rank;
  const cor = variacao > 0 ? "#059669" : variacao < 0 ? "#ef4444" : "#f59e0b";
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Posição de ${points[0].rank} em ${brDate(points[0].date)} para ${points[points.length - 1].rank} em ${brDate(points[points.length - 1].date)}`}
      className="overflow-visible"
    >
      <path d={d} fill="none" stroke={cor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2.2" fill={cor} />
    </svg>
  );
}

function Delta({ value, dias }: { value?: number; dias: number }) {
  // Sem dado e sem movimento são coisas diferentes: o traço cinza significa "ainda não
  // dá para comparar"; o âmbar significa "comparei e não mudou".
  if (value == null) {
    return (
      <span className="text-slate-300" title={`Ainda não há foto de ${dias} dias atrás para comparar`}>
        —
      </span>
    );
  }
  // Setas de verdade (lucide) em vez dos caracteres ↑ ↓ →, que saem finos demais e
  // parecem traço dependendo da fonte.
  const seta = { className: "h-4 w-4 shrink-0", strokeWidth: 3, "aria-hidden": true } as const;
  if (value === 0) {
    return (
      <span
        className="inline-flex items-center justify-center gap-1 font-semibold text-amber-500"
        title={`Manteve a mesma posição em ${dias} dias`}
      >
        <ArrowRight {...seta} />0
      </span>
    );
  }
  // `value` positivo = o NÚMERO da posição diminuiu = melhorou.
  // A seta segue o **número** (que é o que aparece na coluna Posição) e a cor segue a
  // qualidade. Antes a seta seguia a qualidade e discordava do número na tela: o valor
  // ia de #23.238 para #28.853 e a seta apontava para baixo.
  const melhorou = value > 0;
  return (
    <span
      className={`inline-flex items-center justify-center gap-1 font-semibold tabular-nums ${melhorou ? "text-emerald-600" : "text-red-500"}`}
      title={`${melhorou ? "Melhorou" : "Piorou"} ${Math.abs(value).toLocaleString("pt-BR")} posições em ${dias} dias — o número ${melhorou ? "caiu" : "subiu"}`}
    >
      {melhorou ? <ArrowDown {...seta} /> : <ArrowUp {...seta} />}
      {Math.abs(value).toLocaleString("pt-BR")}
    </span>
  );
}

/**
 * "i" de ajuda no cabeçalho. A confusão que ele resolve é real: em BSR número maior é
 * PIOR, então "subiu de posição" significa o número diminuir — e a seta verde aparece
 * quando o valor cai. Sem dizer isso, a tabela é lida ao contrário.
 */
function Ajuda({ texto }: { texto: string }) {
  return (
    <span
      tabIndex={0}
      role="img"
      aria-label={texto}
      title={texto}
      className="ml-1 inline-flex cursor-help align-middle text-slate-400 hover:text-blue-600 focus:text-blue-600 focus:outline-none"
    >
      <Info className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
    </span>
  );
}

/** Variação entre as duas últimas fotos — sem exigir corte de 7 ou 30 dias. */
function DeltaUltima({
  value,
  de,
  ate,
  rankAntes,
  rankAgora,
}: {
  value?: number;
  de?: string;
  ate?: string;
  rankAntes?: number;
  rankAgora?: number;
}) {
  const seta = { className: "h-4 w-4 shrink-0", strokeWidth: 3, "aria-hidden": true } as const;
  if (value == null) {
    return (
      <span className="text-slate-300" title="Só há uma foto até agora — sem comparação possível">
        —
      </span>
    );
  }
  // O tooltip mostra as posições concretas: é o que desfaz a leitura invertida
  // ("perdeu 5.615" fica óbvio como #23.238 → #28.853).
  const posicoes =
    rankAntes != null && rankAgora != null
      ? ` — de #${rankAntes.toLocaleString("pt-BR")} para #${rankAgora.toLocaleString("pt-BR")}`
      : "";
  const periodo = (de && ate ? `de ${brDate(de)} a ${brDate(ate)}` : "entre as duas últimas fotos") + posicoes;
  if (value === 0) {
    return (
      <span className="inline-flex items-center justify-center gap-1 font-semibold text-amber-500" title={`Manteve a posição ${periodo}`}>
        <ArrowRight {...seta} />0
      </span>
    );
  }
  const melhorou = value > 0;
  return (
    <span
      className={`inline-flex items-center justify-center gap-1 font-semibold tabular-nums ${melhorou ? "text-emerald-600" : "text-red-500"}`}
      title={`${melhorou ? "Melhorou" : "Piorou"} ${Math.abs(value).toLocaleString("pt-BR")} posições ${periodo}`}
    >
      {melhorou ? <ArrowDown {...seta} /> : <ArrowUp {...seta} />}
      {Math.abs(value).toLocaleString("pt-BR")}
    </span>
  );
}

export default function HistoricoPage() {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [terms, setTerms] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("recentes");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  // Cada resposta resolve um lote de identidades que ainda faltava (ADR-011), então
  // repetimos enquanto sobrar alguém sem título — a tabela vai se preenchendo à vista.
  // O teto de passadas evita ficar batendo à toa em ASIN que a Amazon não resolve.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      for (let passada = 0; passada < 3; passada++) {
        const res = await fetch("/api/watchlist");
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.error || "Não consegui carregar o histórico.");
        setItems(data.items as WatchItem[]);
        setTerms(data.terms as string[]);
        if (!(data.items as WatchItem[]).some((i) => !i.title)) break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Busca inicial: o estado só muda quando a resposta chega (ou em setLoading, que
    // já nasce true). É sincronização com sistema externo, não render em cascata.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function act(asin: string, action: string) {
    setBusy(asin);
    try {
      const res = await fetch("/api/watchlist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asin, action }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Não consegui salvar.");
      setItems(data.items);
      setTerms(data.terms);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setBusy(null);
    }
  }

  // Fixados sempre no topo — a ordenação escolhida vale dentro de cada bloco.
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("pt-BR");
    // Ordena pelo movimento que existe: 7 dias quando há, senão o das duas últimas
    // fotos. Antes só olhava 7/30 dias e, com a série curta, tudo empatava em zero.
    const mov = (i: WatchItem) => i.delta7 ?? i.deltaUltima ?? i.delta30;
    const peso = (i: WatchItem) => {
      const m = mov(i);
      if (m == null) return Infinity; // sem dado vai para o fim nas duas ordenações
      return sort === "alta" ? -m : sort === "queda" ? m : 0;
    };
    return items
      .filter(
        (i) =>
          !q ||
          `${i.title ?? ""} ${i.brand ?? ""} ${i.asin} ${i.category ?? ""} ${i.lastSearchTerm ?? ""}`
            .toLocaleLowerCase("pt-BR")
            .includes(q)
      )
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return peso(a) - peso(b);
      });
  }, [items, query, sort]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const paged = visible.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inteligência de mercado"
        title="Histórico de pesquisa"
        icon={pageIcons.search}
        subtitle={
          <>
            Tudo que você já pesquisou continua sendo acompanhado todo dia. Aqui você vê como a{" "}
            <strong>posição de vendas</strong> de cada anúncio mudou desde que ele entrou na lista.
          </>
        }
        action={
          <Link
            href="/amazon/pesquisa"
            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Nova pesquisa
          </Link>
        }
      />

      {terms.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Você pesquisou</span>
          {terms.map((t) => (
            <Link
              key={t}
              href={`/amazon/pesquisa?q=${encodeURIComponent(t)}`}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:border-blue-400 hover:text-blue-600"
            >
              {t}
            </Link>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>{error}</p>
          <button type="button" onClick={() => void load()} className="mt-3 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white">
            Tentar novamente
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-[260px] flex-1 flex-col gap-1.5">
            <label>
              <span className="sr-only">Buscar no histórico</span>
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Buscar por título, marca, categoria ou ASIN"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-base focus:border-blue-500 focus:outline-none sm:text-sm"
              />
            </label>
            <p className="text-sm text-slate-500">
              {query.trim()
                ? `${visible.length} de ${items.length} anúncio(s)`
                : `${items.length} anúncio(s) acompanhado(s)`}
            </p>
          </div>
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 text-xs">
            {([["recentes", "Mais recentes"], ["alta", "Maior alta"], ["queda", "Maior queda"]] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setSort(k)}
                className={`rounded-md px-3 py-1.5 font-medium ${sort === k ? "bg-blue-100 text-blue-700" : "text-slate-500 hover:text-slate-900"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white shadow-sm ring-1 ring-slate-900/[0.02]">
        <table className="w-full min-w-[880px] text-sm">
          <caption className="sr-only">Anúncios acompanhados e a variação da posição de vendas</caption>
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-3">Produto</th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 text-center">
                Posição
                <Ajuda texto="Posição de vendas (BSR) na categoria. Quanto MENOR o número, melhor: #1 é o mais vendido. Atenção: é uma foto tirada UMA VEZ POR DIA. A Amazon recalcula o BSR de hora em hora, então este valor pode diferir do que aparece agora na página do produto — os dois estão certos, cada um para o seu momento. Passe o mouse na posição para ver a data da foto." />
              </th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 text-center">
                Variação
                <Ajuda texto="Quanto o número da posição mudou entre as duas últimas fotos. A seta acompanha o número: seta para cima = o número aumentou, e como número maior é pior, ela é vermelha. Seta para baixo = o número caiu, o anúncio melhorou, e ela é verde. Passe o mouse no valor para ver as datas e as posições exatas." />
              </th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 text-center">
                7 dias
                <Ajuda texto="Mesma leitura da Variação, mas comparando com a foto de 7 dias atrás. Fica vazio enquanto não existir foto daquela data — preferimos não mostrar nada a chamar de '7 dias' um intervalo diferente." />
              </th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 text-center">
                30 dias
                <Ajuda texto="Mesma leitura, comparando com a foto de 30 dias atrás." />
              </th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 text-center">
                Curva
                <Ajuda texto="Posição ao longo dos últimos 30 dias. A linha sobe quando o anúncio melhora de posição. Verde = terminou melhor que começou; vermelho = pior; âmbar = igual." />
              </th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 text-center">
                Desde
                <Ajuda texto="Quando este anúncio entrou na lista — normalmente a primeira vez que apareceu numa pesquisa sua." />
              </th>
              <th scope="col" className="px-3 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8"><TableLoading label="Carregando histórico" /></td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6">
                  <EmptyState
                    kind="search"
                    title="Nada acompanhado ainda"
                    description="Faça uma pesquisa: todo anúncio que aparecer entra nesta lista e passa a ser fotografado diariamente."
                    action={
                      <Link href="/amazon/pesquisa" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                        Pesquisar agora
                      </Link>
                    }
                  />
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6">
                  <EmptyState
                    kind="search"
                    title="Nenhum anúncio com esse termo"
                    description="A busca aqui filtra o que você já acompanha. Para procurar produtos novos na Amazon, use a pesquisa."
                    action={
                      <button
                        type="button"
                        onClick={() => setQuery("")}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:border-blue-400 hover:text-blue-600"
                      >
                        Limpar busca
                      </button>
                    }
                  />
                </td>
              </tr>
            ) : (
              paged.map((p) => (
                <tr key={p.asin} className={`hover:bg-slate-50 ${busy === p.asin ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded object-contain ring-1 ring-black/10" />
                      ) : (
                        <span className="h-10 w-10 shrink-0 rounded bg-slate-100" aria-hidden />
                      )}
                      <div className="min-w-0">
                        <p className="flex max-w-[46ch] items-center gap-1.5 truncate font-medium">
                          {p.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-blue-600" strokeWidth={2} aria-label="Fixado" />}
                          {p.title || p.asin}
                        </p>
                        <p className="truncate font-mono text-xs text-slate-400">
                          {p.asin}
                          {p.brand ? ` · ${p.brand}` : ""}
                          {p.lastSearchTerm ? ` · de "${p.lastSearchTerm}"` : ""}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center tabular-nums">
                    {p.currentRank ? (
                      <div className="flex flex-col items-center gap-0.5">
                        {/* A data da foto no tooltip é o que explica uma divergência com o
                            valor ao vivo da Amazon sem precisar poluir a célula. */}
                        <strong
                          className="cursor-help font-semibold text-slate-700"
                          title={p.currentDate ? `Foto de ${brDate(p.currentDate)} — a Amazon recalcula o BSR de hora em hora` : undefined}
                        >
                          #{p.currentRank.toLocaleString("pt-BR")}
                        </strong>
                        {p.category && (
                          <span className="max-w-[22ch] truncate text-[11px] text-slate-400" title={p.category}>
                            em {p.category}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-300" title="Sem posição capturada — o anúncio pode não ter rank na categoria">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <DeltaUltima
                      value={p.deltaUltima}
                      de={p.ultimaDe}
                      ate={p.currentDate}
                      rankAntes={p.ultimaRank}
                      rankAgora={p.currentRank}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-center"><Delta value={p.delta7} dias={7} /></td>
                  <td className="px-3 py-2.5 text-center"><Delta value={p.delta30} dias={30} /></td>
                  <td className="px-3 py-2.5 text-center"><Sparkline points={p.series} /></td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-center text-xs text-slate-500">
                    {brDate(p.firstSeenAt)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => void act(p.asin, p.pinned ? "desafixar" : "fixar")}
                        disabled={busy === p.asin}
                        title={p.pinned ? "Desafixar" : "Fixar — garante a foto diária mesmo com a lista cheia"}
                        aria-label={p.pinned ? `Desafixar ${p.asin}` : `Fixar ${p.asin}`}
                        className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors ${p.pinned ? "text-blue-600 hover:bg-blue-50" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"}`}
                      >
                        {p.pinned ? <PinOff className="h-4 w-4" strokeWidth={1.8} /> : <Pin className="h-4 w-4" strokeWidth={1.8} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => void act(p.asin, "remover")}
                        disabled={busy === p.asin}
                        title="Remover da lista — para de acompanhar, mas o histórico já coletado é preservado"
                        aria-label={`Remover ${p.asin} da lista`}
                        className="flex h-10 w-10 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        <X className="h-4 w-4" strokeWidth={1.8} />
                      </button>
                      <a
                        href={`https://www.amazon.com.br/dp/${p.asin}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="whitespace-nowrap rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-blue-400 hover:text-blue-600"
                      >
                        abrir ↗
                      </a>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="listing-pagination">
          <Pagination page={current} pageCount={pageCount} total={visible.length} pageSize={PAGE_SIZE} onPage={setPage} />
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-1 text-xs text-slate-400">
          <p>
            <strong className="text-slate-500">Posição menor é melhor</strong> — #1 é o mais vendido da categoria.
            A seta segue o número: <strong className="text-red-500">para cima em vermelho</strong> quer dizer que o
            número aumentou e o anúncio piorou; <strong className="text-emerald-600">para baixo em verde</strong>,
            que o número caiu e o anúncio melhorou.
          </p>
          <p>
            <strong className="text-slate-500">É uma foto por dia.</strong> A Amazon recalcula a posição de vendas
            de hora em hora, então o número aqui pode não bater com o que aparece agora na página do produto — e
            isso não é erro: cada um mostra um momento diferente. Passe o mouse na posição para ver a data da foto.
            Uma captura diária é o suficiente para acompanhar tendência; para reagir a oscilação de hora em hora,
            o lugar é a própria Amazon.
          </p>
          <p>
            A variação só aparece quando existe uma foto daquele período — nos primeiros dias de um anúncio novo na
            lista, as colunas ficam vazias em vez de comparar prazos diferentes.
          </p>
          <p>
            <strong className="text-slate-500">Fixar</strong> garante a foto diária: há um teto de anúncios por dia, e o
            que está fixado nunca fica de fora. <strong className="text-slate-500">Remover</strong> só interrompe o
            acompanhamento — o histórico já coletado é preservado e volta se você pesquisar o produto de novo.
          </p>
        </div>
      )}
    </div>
  );
}
