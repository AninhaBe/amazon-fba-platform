"use client";

import { useMemo, useState } from "react";
import type { ProfitabilityLine } from "@/lib/profitability";
import { brDate } from "@/lib/datetime";
import { EmptyState } from "./EmptyState";
import { TableLoading } from "./LoadingState";
import { Pagination } from "./Pagination";

// Contas movimentadas trazem até 1000 vendas por período. Renderizar todos os
// cards de uma vez travava a thread (o /monitor "congelava"). Paginamos em
// blocos para manter a montagem barata; busca e filtro agem sobre o total.
const PAGE_SIZE = 30;

function money(value: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

function percent(value: number) {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = { paid: "Pago", confirmed: "Confirmado", Shipped: "Enviado", Unshipped: "A enviar", PartiallyShipped: "Envio parcial", Pending: "Pendente" };
  return labels[status] || status.replaceAll("_", " ");
}

function Margin({ line }: { line: ProfitabilityLine }) {
  if (line.contribution == null || line.marginPct == null) return <span className="profit-pending">Aguardando dados</span>;
  // Mesma faixa da curva ABC: ≥18% verde, 12–18% âmbar, abaixo vermelho.
  const tone = line.marginPct >= 18 ? "positive" : line.marginPct >= 12 ? "warning" : "negative";
  return <div className={`profit-result is-${tone}`}><strong>{money(line.contribution, line.currency)}</strong><span>{percent(line.marginPct)}</span></div>;
}

function Breakdown({ line }: { line: ProfitabilityLine }) {
  return <div className="profit-breakdown">
    <div><span>Receita da venda</span><strong>{money(line.revenue, line.currency)}</strong></div>
    {line.buyerShipping != null && <div><span>Frete pago pelo comprador</span><strong>{line.buyerShippingIsRevenue === false ? "" : "+ "}{money(line.buyerShipping, line.currency)}</strong></div>}
    <div><span>Custo dos produtos</span><strong>{line.productCost == null ? "Não cadastrado" : `− ${money(line.productCost, line.currency)}`}</strong></div>
    <div><span>Tarifas do canal</span><strong>{line.marketplaceFees == null ? "Ainda não conciliadas" : `− ${money(line.marketplaceFees, line.currency)}`}</strong></div>
    {line.sellerShipping != null && <div><span>Frete assumido pelo vendedor</span><strong>− {money(line.sellerShipping, line.currency)}</strong></div>}
    {line.netReceived != null && <div className="is-subtotal"><span>Líquido repassado antes do produto</span><strong>{money(line.netReceived, line.currency)}</strong></div>}
    {line.tax != null && <div><span>Impostos</span><strong>− {money(line.tax, line.currency)}</strong></div>}
    <div className="is-total"><span>Margem de contribuição</span><strong>{line.contribution == null ? "Cálculo incompleto" : money(line.contribution, line.currency)}</strong></div>
  </div>;
}

// `scopeNote` é uma FRASE pronta, não a estrutura de cobertura da API. Quem
// consome `/api/order-profitability` recebe `scope` como objeto e precisa
// formatá-lo antes — renderizar o objeto cru derruba a página (React #31).
export function OrderProfitabilityTable({ lines, loading = false, error = null, scopeNote }: { lines: ProfitabilityLine[]; loading?: boolean; error?: string | null; scopeNote?: string }) {
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState<"all" | "positive" | "negative" | "incomplete">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pagination, setPagination] = useState<{ lines: ProfitabilityLine[]; page: number }>({ lines, page: 1 });
  const page = pagination.lines === lines ? pagination.page : 1;
  const visible = useMemo(() => lines.filter((line) => {
    const matches = `${line.product} ${line.sku || ""} ${line.orderId}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"));
    const resultMatches = resultFilter === "all" || (resultFilter === "incomplete" ? !line.complete : resultFilter === "positive" ? (line.contribution ?? 0) >= 0 && line.complete : (line.contribution ?? 0) < 0 && line.complete);
    return matches && resultMatches;
  }), [lines, query, resultFilter]);
  const complete = lines.filter((line) => line.complete).length;
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const paged = visible.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return <section className="profitability-view" aria-labelledby="profitability-title">
    <header className="profitability-heading">
      <div><p className="section-kicker">Resultado por venda</p><h2 id="profitability-title">Rentabilidade dos pedidos</h2><p>{scopeNote || "Veja o que entrou, os custos identificados e quanto sobrou em cada produto vendido."}</p></div>
      {!loading && lines.length > 0 && <span>{complete} de {lines.length} vendas com cálculo completo</span>}
    </header>
    <div className="profitability-filters">
      <label><span className="sr-only">Buscar produto, SKU ou pedido</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPagination({ lines, page: 1 }); }} placeholder="Buscar produto, SKU ou pedido" /></label>
      <select value={resultFilter} onChange={(event) => { setResultFilter(event.target.value as typeof resultFilter); setPagination({ lines, page: 1 }); }} aria-label="Filtrar resultado das vendas"><option value="all">Todos os resultados</option><option value="positive">Margem positiva</option><option value="negative">Margem negativa</option><option value="incomplete">Cálculo incompleto</option></select>
    </div>

    {error ? <div role="alert" className="profitability-error">{error}</div> : loading ? <TableLoading label="Calculando rentabilidade das vendas" /> : lines.length === 0 ? <EmptyState title="Nenhuma venda no período" description="Amplie o período para consultar vendas anteriores." /> : visible.length === 0 ? <EmptyState kind="search" title="Nenhuma venda encontrada" description="Ajuste a busca ou altere o filtro de resultado." /> : <><div className="profitability-list">{paged.map((line) => <ProfitabilitySale key={line.id} line={line} expanded={expanded === line.id} onToggle={() => setExpanded(expanded === line.id ? null : line.id)} />)}</div><Pagination page={current} pageCount={pageCount} total={visible.length} pageSize={PAGE_SIZE} onPage={(nextPage) => setPagination({ lines, page: nextPage })} /></>}
  </section>;
}

export function ProfitabilitySale({ line, expanded, onToggle }: { line: ProfitabilityLine; expanded: boolean; onToggle: () => void }) {
  const deductions = line.productCost == null || line.marketplaceFees == null
    ? null
    : line.productCost + line.marketplaceFees + (line.sellerShipping ?? 0) + (line.tax ?? 0);
  return <article className={`profit-sale${expanded ? " is-expanded" : ""}`}>
    <div className="profit-sale-main">
      <div className="profit-sale-product">
        <strong title={line.product}>{line.product}</strong>
        <span className="profit-sale-sku">{line.sku || "Sem SKU"}</span>
        <small>Pedido #{line.orderId}</small>
      </div>
      <div className="profit-sale-meta" aria-label="Informações da venda">
        <span>{brDate(line.date)}</span>
        <span>{line.fulfillment || statusLabel(line.status)}</span>
        <span>{line.quantity} {line.quantity === 1 ? "unidade" : "unidades"} × {money(line.unitPrice, line.currency)}</span>
      </div>
      <div className="profit-equation" aria-label="Resumo financeiro da venda">
        <div><span>Venda</span><strong>{money(line.revenue, line.currency)}</strong></div>
        <i aria-hidden="true">−</i>
        <div className="is-cost"><span>Custos</span><strong>{deductions == null ? "Incompleto" : money(deductions, line.currency)}</strong></div>
        <i aria-hidden="true">=</i>
        <div className="is-margin"><span>Margem</span><Margin line={line} /></div>
      </div>
      <button type="button" className="profit-expand" aria-label={`${expanded ? "Ocultar" : "Mostrar"} composição da venda`} aria-expanded={expanded} onClick={onToggle}><span aria-hidden="true">⌄</span></button>
    </div>
    {expanded && <div className="profit-sale-details"><Breakdown line={line} /></div>}
  </article>;
}
