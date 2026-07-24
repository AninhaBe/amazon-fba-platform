"use client";

import Image from "next/image";
import { useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { PanelLoading } from "../../components/LoadingState";
import { PageHeader } from "../../components/PageHeader";

interface RankingListing {
  position: number;
  page: number;
  id: string;
  title: string;
  price: number;
  currency: string;
  permalink: string | null;
  thumbnail: string | null;
}
interface RankingCompetitor {
  sellerId: number;
  nickname: string;
  city: string | null;
  reputation: string | null;
  count: number;
  positions: number[];
  bestPrice: number | null;
  currency: string;
}
interface Ranking {
  term: string;
  total: number;
  scanned: number;
  perPage: number;
  mine: RankingListing[];
  competitors: RankingCompetitor[];
}

function money(value: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

// Cor da posição: página 1 (≤10) é ótima, até a página ~1 estendida (≤50) é ok,
// depois disso já está longe do topo.
function posTone(position: number): string {
  if (position <= 10) return "bg-emerald-50 text-emerald-700";
  if (position <= 50) return "bg-amber-50 text-amber-700";
  return "bg-red-50 text-red-600";
}

function repLevel(reputation: string | null): number {
  if (reputation === "Platinum") return 5;
  if (reputation === "Gold") return 4;
  if (reputation === "Silver") return 3;
  return 2;
}

function Thermometer({ level }: { level: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} className={`h-1.5 w-3.5 rounded-sm ${n <= level ? "bg-emerald-500" : "bg-slate-200"}`} />
      ))}
    </span>
  );
}

export default function RanqueamentoPage() {
  const [term, setTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Ranking | null>(null);

  async function search(event?: React.FormEvent) {
    event?.preventDefault();
    const q = term.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/integrations/mercado-livre/ranking?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Não foi possível consultar o ranqueamento.");
      setData(body as Ranking);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Não foi possível consultar o ranqueamento.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="dashboard-page meli-workspace space-y-6">
      <PageHeader
        eyebrow="Métricas Mercado Livre"
        title="Ranqueamento de anúncios"
        subtitle="Digite um termo de busca e veja em que posição seu anúncio aparece no Mercado Livre, quem são os concorrentes do topo e quantas posições cada um ocupa."
      />

      <form onSubmit={search} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row">
        <input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Digite o termo de busca (ex.: régua elétrica 5 tomadas usb)"
          className="flex-1 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-[15px] text-slate-900 outline-none focus:border-yellow-500 focus:bg-white"
        />
        <button type="submit" disabled={loading || !term.trim()} className="meli-primary-action justify-center disabled:opacity-50">
          {loading ? "Buscando…" : <>Buscar <span aria-hidden="true">🔎</span></>}
        </button>
      </form>
      <p className="-mt-3 px-1 text-xs text-slate-400">
        Varre as primeiras 20 páginas (1000 anúncios) da busca do ML. Anúncios após essa paginação não são rankeados.
      </p>

      {loading ? (
        <PanelLoading label="Varrendo a busca do Mercado Livre…" />
      ) : error ? (
        <EmptyState title="Não foi possível consultar" description={error} />
      ) : !data ? (
        <EmptyState
          kind="search"
          title="Pesquise um termo"
          description="Use as mesmas palavras que um comprador digitaria para encontrar seu produto."
        />
      ) : (
        <Results data={data} />
      )}

      {data && (
        <p className="flex gap-2 px-1 text-xs text-slate-400">
          <span aria-hidden="true">ℹ️</span>
          <span>
            <strong className="text-slate-500">Ranking aproximado:</strong> a busca real do comprador varia por localização,
            histórico e anúncios patrocinados — este é o ranking genérico da API, uma boa estimativa.
          </span>
        </p>
      )}
    </div>
  );
}

function Results({ data }: { data: Ranking }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.35fr_1fr]">
      <div className="space-y-5">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-2 divide-x divide-slate-100">
            <div className="p-5">
              <p className="text-[30px] font-extrabold tabular-nums leading-none tracking-tight text-slate-900">
                {data.total.toLocaleString("pt-BR")}
              </p>
              <p className="mt-1 text-[13px] text-slate-500">Total de anúncios encontrados</p>
            </div>
            <div className="p-5">
              <p className="text-[30px] font-extrabold tabular-nums leading-none tracking-tight text-amber-700">
                {data.mine.length}
              </p>
              <p className="mt-1 text-[13px] text-slate-500">Seus anúncios encontrados</p>
            </div>
          </div>
        </section>

        {data.mine.length === 0 ? (
          <EmptyState
            title="Nenhum anúncio seu no top 1000"
            description="Seus anúncios não apareceram nas primeiras 20 páginas dessa busca. Revise título e palavras-chave."
          />
        ) : (
          data.mine.map((listing) => <MineCard key={listing.id} listing={listing} scanned={data.scanned} perPage={data.perPage} />)
        )}
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-[15px] font-bold text-slate-900">Concorrentes no topo</h2>
          <span className="text-xs tabular-nums text-slate-400">{data.competitors.length} vendedores</span>
        </div>
        {data.competitors.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-400">Nenhum concorrente identificado na primeira página.</p>
        ) : (
          data.competitors.map((competitor) => <CompetitorRow key={competitor.sellerId} competitor={competitor} />)
        )}
      </section>
    </div>
  );
}

function MineCard({ listing, scanned, perPage }: { listing: RankingListing; scanned: number; perPage: number }) {
  const tone = posTone(listing.position);
  const pct = Math.min(100, (listing.position / scanned) * 100);
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-4 p-5">
        <div className="relative h-[74px] w-[74px] shrink-0 overflow-hidden rounded-xl bg-slate-100 outline outline-1 outline-black/10">
          {listing.thumbnail ? (
            <Image src={listing.thumbnail} alt="" fill sizes="74px" className="object-cover" unoptimized />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-2xl">🔌</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-semibold text-slate-900" title={listing.title}>{listing.title}</p>
          <p className="mt-1 text-[13px] text-slate-500">
            <b className="text-[15px] font-bold text-slate-900">{money(listing.price, listing.currency)}</b>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2.5 text-sm text-slate-600">
            Seu anúncio está na
            <span className={`inline-flex items-baseline gap-1 rounded-lg px-2.5 py-1 text-[15px] font-extrabold tabular-nums ${tone}`}>
              {listing.page}<small className="text-[11px] font-semibold opacity-80">página</small>
            </span>
            e na
            <span className={`inline-flex items-baseline gap-1 rounded-lg px-2.5 py-1 text-[15px] font-extrabold tabular-nums ${tone}`}>
              {listing.position}º<small className="text-[11px] font-semibold opacity-80">posição</small>
            </span>
            {listing.permalink && (
              <a href={listing.permalink} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold text-amber-700 hover:underline">
                Ver no ML →
              </a>
            )}
          </div>
        </div>
      </div>
      <div className="mx-5 mb-5 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4">
        <div className="mb-2 flex justify-between text-xs text-slate-500">
          <span>1º (topo)</span>
          <span>onde você está</span>
          <span>{scanned.toLocaleString("pt-BR")}º</span>
        </div>
        <div className="ranking-track">
          <span className="ranking-you" style={{ left: `${pct}%` }} data-label={`${listing.position}º`} />
        </div>
        <div className="mt-6 flex justify-between text-[10.5px] text-slate-400">
          <span>Página 1</span>
          <span>Página {Math.ceil(scanned / perPage)}</span>
        </div>
      </div>
    </section>
  );
}

function CompetitorRow({ competitor }: { competitor: RankingCompetitor }) {
  return (
    <div className="border-b border-slate-100 px-5 py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-[13.5px] font-bold text-amber-700">{competitor.nickname}</span>
        {competitor.reputation && (
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-slate-500">
            <Thermometer level={repLevel(competitor.reputation)} /> {competitor.reputation}
          </span>
        )}
      </div>
      <div className="mt-1 text-xs text-slate-500">
        <span className="font-mono text-[11px]">ID {competitor.sellerId}</span>
        {competitor.city && <> · {competitor.city}</>}
        {" · "}
        {competitor.count} anúncio{competitor.count > 1 ? "s" : ""} na busca
        {competitor.bestPrice != null && <> · a partir de <b className="text-slate-700">{money(competitor.bestPrice, competitor.currency)}</b></>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        Posições:
        {competitor.positions.map((position, index) => (
          <span
            key={`${position}-${index}`}
            className={`rounded-md px-2 py-0.5 text-xs font-bold tabular-nums ${position <= 10 ? "bg-emerald-50 text-emerald-700" : "border border-slate-200 bg-slate-50 text-slate-700"}`}
          >
            {position}º
          </span>
        ))}
      </div>
    </div>
  );
}
