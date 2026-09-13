"use client";

import { useEffect, useState } from "react";
import { PageHeader, pageIcons } from "../../components/PageHeader";
import { PanelLoading } from "../../components/LoadingState";
import { EmptyState } from "../../components/EmptyState";
import { readJson } from "../../../lib/readJson";
import { Pagination } from "../../components/Pagination";
import { SeletorNexo } from "../../components/SeletorNexo";
import { AccountSwitcher } from "../../components/AccountSwitcher";
import { ORDEM_DO_RADAR, ROTULO_DE_COBERTURA, type StockStatus } from "@/lib/coberturaDeEstoque";

const PAGE_SIZE = 15;

interface RadarRow {
  sellerSku: string;
  asin?: string;
  productName?: string;
  fulfillable: number;
  inbound: number;
  reserved: number;
  unitsSold: number;
  perDay: number;
  daysRemaining: number | null;
  status: StockStatus;
}

const tomDaCobertura = (status: StockStatus) =>
  status === "out" || status === "critical" ? "critico" : status === "low" ? "atencao" : "saudavel";

export default function EstoquePage() {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RadarRow[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StockStatus | "all">("all");
  const [sort, setSort] = useState<"urgency" | "stock" | "sales">("urgency");
  const [page, setPage] = useState(1);

  async function load(d: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/radar?days=${d}`);
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Erro ao carregar o radar.");
      setRows(data.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(days), 0);
    return () => window.clearTimeout(timer);
  }, [days]);

  const counts = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {} as Partial<Record<StockStatus, number>>);
  const attention = (counts.critical || 0) + (counts.out || 0);
  const unidadesVendidas = rows.reduce((total, row) => total + row.unitsSold, 0);
  const periodoLabel = `Últimos ${days} dias`;
  const visibleRows = [...rows]
    .filter((row) => `${row.productName || ""} ${row.sellerSku} ${row.asin || ""}`.toLowerCase().includes(query.toLowerCase()) && (statusFilter === "all" || row.status === statusFilter))
    .sort((a, b) => sort === "stock"
      ? b.fulfillable - a.fulfillable
      : sort === "sales"
        ? b.unitsSold - a.unitsSold
        : (ORDEM_DO_RADAR[a.status] - ORDEM_DO_RADAR[b.status]) || ((a.daysRemaining ?? Number.POSITIVE_INFINITY) - (b.daysRemaining ?? Number.POSITIVE_INFINITY)));
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const pagedRows = visibleRows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <div className="v3 inventory-family-body">
      <PageHeader eyebrow="Operação Amazon" title="Radar de estoque" subtitle="Cobertura do estoque FBA com base no ritmo de vendas do período." icon={pageIcons.radar} action={<AccountSwitcher appearance="chip" />} />

      {error && <div role="alert" className="listing-error"><div><strong>Não foi possível carregar o radar.</strong><p>{error}</p></div><button type="button" onClick={() => void load(days)}>Tentar novamente</button></div>}

      {!loading && !error && rows.length > 0 && (
        <section className="v3-card v3-faixa" aria-label="Resumo do risco de estoque">
          <div className="v3-card-cab"><h2>Radar de estoque</h2><span className="v3-meta">{periodoLabel}</span></div>
          <div className="v3-colunas amazon-inventory-faixa">
            <div className="v3-coluna"><p className="v3-coluna-rotulo">Produtos ativos</p><strong className="v3-coluna-valor">{rows.length.toLocaleString("pt-BR")}</strong><span className="v3-coluna-share">monitorados no radar</span></div>
            <div className="v3-coluna is-tom-vermelho"><p className="v3-coluna-rotulo">Ação imediata</p><strong className={`v3-coluna-valor${attention ? " is-negativo" : ""}`}>{attention.toLocaleString("pt-BR")}</strong><span className="v3-coluna-share">esgotados ou críticos</span></div>
            <div className="v3-coluna is-tom-verde"><p className="v3-coluna-rotulo">Saudáveis</p><strong className="v3-coluna-valor is-positivo">{(counts.ok || 0).toLocaleString("pt-BR")}</strong><span className="v3-coluna-share">com cobertura</span></div>
            <div className="v3-coluna"><p className="v3-coluna-rotulo">Unidades vendidas</p><strong className="v3-coluna-valor">{unidadesVendidas.toLocaleString("pt-BR")}</strong><span className="v3-coluna-share">{periodoLabel}</span></div>
          </div>
        </section>
      )}

      {loading ? <PanelLoading label="Carregando estoque e velocidade de venda" /> : rows.length === 0 && !error ? (
        <EmptyState title="Seu estoque FBA aparecerá aqui" description="Quando houver mercadoria e vendas, o radar calcula automaticamente quantos dias restam para cada SKU." />
      ) : !error ? (
        <section className="v3-card" aria-labelledby="inventory-results-title">
          <div className="v3-card-cab"><h2 id="inventory-results-title">{visibleRows.length.toLocaleString("pt-BR")} {visibleRows.length === 1 ? "produto encontrado" : "produtos encontrados"}</h2><span className="v3-meta">{periodoLabel}</span></div>
          <p className="v3-nota">Cobertura = estoque disponível ÷ média diária de vendas no período. Estoque a caminho aparece separado porque ainda não pode atender um pedido.</p>
          <div className="v3-filtros" role="search" aria-label="Filtros de estoque">
            <label className="v3-busca"><span className="sr-only">Buscar no estoque</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Buscar SKU, ASIN ou produto" /></label>
            <SeletorNexo valor={String(days)} rotuloAcessivel="Período do ritmo de vendas" aoEscolher={(valor) => { setDays(Number(valor)); setPage(1); }} opcoes={[{ valor: "7", rotulo: "Ritmo dos últimos 7 dias" }, { valor: "30", rotulo: "Ritmo dos últimos 30 dias" }, { valor: "90", rotulo: "Ritmo dos últimos 90 dias" }]} />
            <SeletorNexo valor={statusFilter} rotuloAcessivel="Filtrar status do estoque" aoEscolher={(valor) => { setStatusFilter(valor as StockStatus | "all"); setPage(1); }} opcoes={[{ valor: "all", rotulo: "Todos os status" }, ...Object.entries(ROTULO_DE_COBERTURA).map(([valor, rotulo]) => ({ valor, rotulo }))]} />
            <SeletorNexo valor={sort} rotuloAcessivel="Ordenar estoque" aoEscolher={(valor) => { setSort(valor as typeof sort); setPage(1); }} opcoes={[{ valor: "urgency", rotulo: "Maior urgência" }, { valor: "stock", rotulo: "Maior estoque" }, { valor: "sales", rotulo: "Mais vendidos" }]} />
          </div>
          {visibleRows.length === 0 ? <EmptyState kind="search" title="Nenhum produto encontrado" description="Limpe a busca ou selecione outro status." /> : (
            <div className="v3-tabela v3-tabela-estoque v3-tabela-estoque-amazon">
              <div className="v3-estoque-cab"><span>Produto</span><span>SKU</span><span>Disponível</span><span>A caminho</span><span>Vendidos</span><span>Vende/dia</span><span>Cobertura</span><span>Status</span></div>
              {pagedRows.map((r) => (
                <div className="v3-estoque-linha" key={r.sellerSku}>
                  <span className="v3-cel-nome"><span className="v3-margem-titulo" title={r.productName || r.sellerSku}>{r.productName || r.sellerSku}</span><span className="v3-cel-sub">{r.asin ? `ASIN ${r.asin}` : "Estoque FBA"}</span></span>
                  <span className="v3-cel-pedido">{r.sellerSku}</span>
                  <span className="v3-cel-num">{r.fulfillable.toLocaleString("pt-BR")}</span>
                  <span className="v3-cel-num">{r.inbound.toLocaleString("pt-BR")}</span>
                  <span className="v3-cel-num">{r.unitsSold.toLocaleString("pt-BR")}</span>
                  <span className="v3-cel-num">{r.perDay.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                  <span className={`v3-cel-num${r.daysRemaining == null ? " is-vazio" : ""}`}>{r.daysRemaining == null ? "—" : r.daysRemaining === 0 ? "esgotado" : `${r.daysRemaining} dias`}</span>
                  <span className="v3-cel-fim"><em className={`v3-chip v3-cobertura is-${tomDaCobertura(r.status)}`}>{ROTULO_DE_COBERTURA[r.status]}</em></span>
                </div>
              ))}
            </div>
          )}
          {pageCount > 1 && <div className="v3-paginacao"><Pagination page={current} pageCount={pageCount} total={visibleRows.length} pageSize={PAGE_SIZE} onPage={setPage} /></div>}
        </section>
      ) : null}
    </div>
  );
}
