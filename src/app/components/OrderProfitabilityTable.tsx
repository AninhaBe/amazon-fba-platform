"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ProfitabilityLine } from "@/lib/profitability";
import { brDate } from "@/lib/datetime";
import { marginTone } from "@/lib/marginTone";
import { EmptyState } from "./EmptyState";
import { TableLoading } from "./LoadingState";
import { Pagination } from "./Pagination";
import styles from "./OrderProfitabilityTable.module.css";

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

/**
 * Por que o cálculo não fechou — e, sobretudo, DE QUEM depende. "Aguardando
 * dados" fazia parecer falha nossa; na maioria das vezes é o marketplace que
 * ainda não liberou o número (a Amazon só informa o valor do pedido depois de
 * aprovar o pagamento, e a tarifa só entra quando liquida). Quando a pendência
 * é da vendedora — custo não cadastrado — a tela precisa dizer isso e não
 * esconder no meio do mesmo rótulo genérico.
 */
function motivoPendente(line: ProfitabilityLine): { titulo: string; ajuda: string; deNos: boolean } {
  if (line.revenueKnown === false)
    return { titulo: "Aguardando pagamento", ajuda: "O canal informa o valor ao aprovar o pagamento", deNos: false };
  if (line.productCost == null)
    return { titulo: "Custo não cadastrado", ajuda: `Cadastre o custo de ${line.sku || "este produto"}`, deNos: true };
  return { titulo: "Tarifas não postadas", ajuda: "Entram quando o canal liquida o pedido", deNos: false };
}

function Margin({ line }: { line: ProfitabilityLine }) {
  if (line.contribution == null || line.marginPct == null) {
    const motivo = motivoPendente(line);
    return <div className={`profit-pending ${styles.pending}${motivo.deNos ? " is-acao" : ""}`}>
      <strong>{motivo.titulo}</strong>
      <span>{motivo.ajuda}</span>
    </div>;
  }
  const tone = profitabilityMarginTone(line);
  return <div className={`profit-result ${styles.result} is-${tone}`}><strong>{money(line.contribution, line.currency)}</strong><span>{percent(line.marginPct)}</span></div>;
}

function profitabilityMarginTone(line: ProfitabilityLine): "positive" | "warning" | "negative" | "pending" {
  if (line.contribution == null || line.marginPct == null) return "pending";
  const tone = marginTone(line.marginPct);
  return tone === "danger" ? "negative" : tone === "unknown" ? "pending" : tone;
}

function Breakdown({ line }: { line: ProfitabilityLine }) {
  const tone = profitabilityMarginTone(line);
  return <div className={`profit-breakdown ${styles.breakdown}`}>
    {line.listPrice != null && line.promotions != null && line.promotions > 0 && <>
      <div className="is-muted"><span>Preço de tabela</span><strong>{money(line.listPrice, line.currency)}</strong></div>
      <div className="is-muted"><span>Cupom aplicado</span><strong>− {money(line.promotions, line.currency)}</strong></div>
    </>}
    <div><span>{line.promotions ? "Pago pelo comprador" : "Receita da venda"}</span><strong>{line.revenueKnown === false || line.revenue == null ? "Aguardando envio" : money(line.revenue, line.currency)}</strong></div>
    {line.buyerShipping != null && <div><span>Frete pago pelo comprador</span><strong>{line.buyerShippingIsRevenue === false ? "" : "+ "}{money(line.buyerShipping, line.currency)}</strong></div>}
    <div><span>Custo dos produtos</span><strong>{line.productCost == null ? "Não cadastrado" : `− ${money(line.productCost, line.currency)}`}</strong></div>
    <div><span>Tarifas do canal</span><strong>{line.marketplaceFees == null ? "Ainda não conciliadas" : `− ${money(line.marketplaceFees, line.currency)}`}</strong></div>
    {line.sellerShipping != null && <div><span>Frete assumido pelo vendedor</span><strong>− {money(line.sellerShipping, line.currency)}</strong></div>}
    {line.netReceived != null && <div className="is-subtotal"><span>Líquido repassado antes do produto</span><strong>{money(line.netReceived, line.currency)}</strong></div>}
    {line.tax != null && <div><span>Impostos</span><strong>− {money(line.tax, line.currency)}</strong></div>}
    <div className={`is-total ${styles.total} ${styles[tone]}`}><span>Margem de contribuição</span><strong>{line.contribution == null ? motivoPendente(line).titulo : money(line.contribution, line.currency)}</strong></div>
  </div>;
}

// `scopeNote` é uma FRASE pronta, não a estrutura de cobertura da API. Quem
// consome `/api/order-profitability` recebe `scope` como objeto e precisa
// formatá-lo antes — renderizar o objeto cru derruba a página (React #31).
export function OrderProfitabilityTable({
  lines,
  loading = false,
  error = null,
  scopeNote,
  pageSize = PAGE_SIZE,
}: {
  lines: ProfitabilityLine[];
  loading?: boolean;
  error?: string | null;
  scopeNote?: string;
  /** Dashboards usam uma prévia curta; o monitor mantém a paginação operacional. */
  pageSize?: number;
}) {
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState<"all" | "positive" | "negative" | "incomplete">("all");
  // Conjunto, não um id só: comparar dois pedidos lado a lado é o uso normal
  // desta tela, e o acordeão fechava o anterior a cada clique.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggleExpanded = (id: string) => setExpanded((atual) => {
    const proximo = new Set(atual);
    if (!proximo.delete(id)) proximo.add(id);
    return proximo;
  });
  const [pagination, setPagination] = useState<{ lines: ProfitabilityLine[]; page: number }>({ lines, page: 1 });
  const page = pagination.lines === lines ? pagination.page : 1;
  const visible = useMemo(() => lines.filter((line) => {
    const matches = `${line.product} ${line.sku || ""} ${line.orderId}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"));
    const resultMatches = resultFilter === "all" || (resultFilter === "incomplete" ? !line.complete : resultFilter === "positive" ? (line.contribution ?? 0) >= 0 && line.complete : (line.contribution ?? 0) < 0 && line.complete);
    return matches && resultMatches;
  }), [lines, query, resultFilter]);
  const complete = lines.filter((line) => line.complete).length;
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const current = Math.min(page, pageCount);
  const paged = visible.slice((current - 1) * pageSize, current * pageSize);

  return <section className={`profitability-view ${styles.view}`} aria-labelledby="profitability-title">
    <header className="profitability-heading">
      <div><p className="section-kicker">Resultado por venda</p><h2 id="profitability-title">Rentabilidade dos pedidos</h2><p>{scopeNote || "Veja o que entrou, os custos identificados e quanto sobrou em cada produto vendido."}</p></div>
      {!loading && lines.length > 0 && <span>{complete} de {lines.length} vendas com cálculo completo</span>}
    </header>
    <div className="profitability-filters">
      <label><span className="sr-only">Buscar produto, SKU ou pedido</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPagination({ lines, page: 1 }); }} placeholder="Buscar produto, SKU ou pedido" /></label>
      <select value={resultFilter} onChange={(event) => { setResultFilter(event.target.value as typeof resultFilter); setPagination({ lines, page: 1 }); }} aria-label="Filtrar resultado das vendas"><option value="all">Todos os resultados</option><option value="positive">Margem positiva</option><option value="negative">Margem negativa</option><option value="incomplete">Cálculo incompleto</option></select>
      {/* Só aparece quando há o que recolher — com vários abertos, fechar um a um cansa. */}
      {expanded.size > 0 && <button type="button" className="profit-collapse-all" onClick={() => setExpanded(new Set())}>Recolher {expanded.size} {expanded.size === 1 ? "aberto" : "abertos"}</button>}
    </div>

    {error ? <div role="alert" className="profitability-error">{error}</div> : loading ? <TableLoading label="Calculando rentabilidade das vendas" /> : lines.length === 0 ? <EmptyState title="Nenhuma venda no período" description="Amplie o período para consultar vendas anteriores." /> : visible.length === 0 ? <EmptyState kind="search" title="Nenhuma venda encontrada" description="Ajuste a busca ou altere o filtro de resultado." /> : <><div className={`profitability-list ${styles.list}`}>{paged.map((line) => <ProfitabilitySale key={line.id} line={line} expanded={expanded.has(line.id)} onToggle={() => toggleExpanded(line.id)} />)}</div><Pagination page={current} pageCount={pageCount} total={visible.length} pageSize={pageSize} onPage={(nextPage) => setPagination({ lines, page: nextPage })} /></>}
  </section>;
}

export function ProfitabilitySale({ line, expanded, onToggle }: { line: ProfitabilityLine; expanded: boolean; onToggle: () => void }) {
  // O cupom NÃO entra aqui: `line.revenue` já é o valor pago pelo comprador,
  // líquido dele. Somá-lo descontaria o desconto duas vezes.
  const deductions = line.productCost == null || line.marketplaceFees == null
    ? null
    : line.productCost + line.marketplaceFees + (line.sellerShipping ?? 0) + (line.tax ?? 0);
  const vendaConhecida = line.revenueKnown !== false;
  // "Incompleto" não pode culpar o custo quando o custo é conhecido. Em pedido
  // ainda não enviado, o que falta é o valor da venda e a tarifa que a Amazon
  // só posta depois — e o custo do produto continua sabido.
  const custoRotulo = deductions != null
    ? money(deductions, line.currency)
    : line.productCost != null
    ? `${money(line.productCost, line.currency)} + tarifas`
    : "Não cadastrado";
  return <article className={`profit-sale ${styles.sale}${expanded ? ` is-expanded ${styles.expanded}` : ""}`}>
    <div className={`profit-sale-main ${styles.saleMain}`}>
      <div className={`profit-sale-product ${styles.product}`}>
        <strong title={line.product}>{line.product}</strong>
        <span className="profit-sale-sku">{line.sku || "Sem SKU"}</span>
        <small>Pedido #{line.orderId}</small>
      </div>
      <div className={`profit-sale-meta ${styles.saleMeta}`} aria-label="Informações da venda">
        <span>{brDate(line.date)}</span>
        {/* Logística e status são fatos distintos. Mostrar só um escondia que o
            pedido está pendente — a Amazon exibe os dois lado a lado. */}
        {line.fulfillment && <span>{line.fulfillment}</span>}
        <span className={line.revenueKnown === false ? "is-pendente" : undefined}>{statusLabel(line.status)}</span>
        <span>{line.quantity} {line.quantity === 1 ? "unidade" : "unidades"}{line.revenueKnown === false || line.unitPrice == null ? "" : ` × ${money(line.unitPrice, line.currency)}`}</span>
      </div>
      <div className={`profit-equation ${styles.equation}`} aria-label="Resumo financeiro da venda">
        <div><span>Venda</span><strong>{vendaConhecida && line.revenue != null ? money(line.revenue, line.currency) : "—"}</strong></div>
        <i aria-hidden="true">−</i>
        <div className="is-cost"><span>Custos</span><strong>{custoRotulo}</strong></div>
        <i aria-hidden="true">=</i>
        <div className="is-margin"><span>Margem</span><Margin line={line} /></div>
      </div>
      <button type="button" className={`profit-expand ${styles.expand}`} aria-label={`${expanded ? "Ocultar" : "Mostrar"} composição da venda`} aria-expanded={expanded} onClick={onToggle}><ChevronDown aria-hidden="true" /></button>
    </div>
    {expanded && <div className={`profit-sale-details ${styles.details}`}><Breakdown line={line} /></div>}
  </article>;
}
