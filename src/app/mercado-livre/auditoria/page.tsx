"use client";

import { useEffect, useState } from "react";
import { PageHeader, pageIcons } from "../../components/PageHeader";
import { TableLoading } from "../../components/LoadingState";
import { EmptyState } from "../../components/EmptyState";
import { brDate } from "@/lib/datetime";
import { readJson } from "../../../lib/readJson";

interface PedidoARevisar {
  orderId: string;
  paymentId: string | null;
  esperado: number;
  esperadoVendedor: number;
  esperadoComprador: number;
  cobrado: number;
  diferenca: number;
  freteCheio: number | null;
  shipmentId: string | null;
  transactionAmount: number | null;
  netReceived: number | null;
  paidAt: string | null;
}

interface Auditoria {
  currency: string;
  pedidos: PedidoARevisar[];
  totalACustestar: number;
  comparados: number;
  semReferencia: number;
  parcial: boolean;
  dias: number;
}

const money = (v: number, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);

/**
 * Pedidos a revisar — frete cobrado pelo Mercado Pago contra o frete que o
 * shipment do Mercado Livre declara.
 *
 * Deliberadamente NÃO se chama "cobranças indevidas". O shipment é uma foto e o
 * ML pode reprecificar o frete depois da pesagem; divergência é candidata a
 * revisão, não erro provado. Mostrar os dois números lado a lado e deixar a
 * decisão com a vendedora é o que mantém a tela confiável — uma tela que grita
 * "erro" em toda diferença vira geradora de falso positivo e é ignorada.
 */
export default function AuditoriaPage() {
  const [dados, setDados] = useState<Auditoria | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [dias, setDias] = useState(30);
  const [copiado, setCopiado] = useState(false);
  const totalEsperado = dados?.pedidos.reduce((total, pedido) => total + pedido.esperado, 0) ?? 0;
  const totalCobrado = dados?.pedidos.reduce((total, pedido) => total + pedido.cobrado, 0) ?? 0;
  const maiorTotal = Math.max(totalEsperado, totalCobrado, 1);

  useEffect(() => {
    const controller = new AbortController();
    // `Promise.resolve()` antes do setState: chamar direto no efeito dispara
    // render em cascata (regra react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setCarregando(true);
      setErro(null);
    });
    fetch(`/api/integrations/mercado-livre/auditoria?dias=${dias}`, { cache: "no-store", signal: controller.signal })
      .then((r) => readJson(r).then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error((d as { error?: string }).error || "Não foi possível auditar os fretes.");
        setDados(d as Auditoria);
      })
      .catch((motivo) => {
        if (motivo instanceof DOMException && motivo.name === "AbortError") return;
        setErro(motivo instanceof Error ? motivo.message : "Não foi possível auditar os fretes.");
      })
      .finally(() => { if (!controller.signal.aborted) setCarregando(false); });
    return () => controller.abort();
  }, [dias]);

  // Texto pronto para colar na contestação — é o que a pessoa faz com a lista.
  function copiarCasos() {
    if (!dados?.pedidos.length) return;
    const linhas = dados.pedidos
      .filter((p) => p.diferenca > 0)
      .map((p) => `Pedido ${p.orderId} — frete previsto ${money(p.esperado, dados.currency)}, cobrado ${money(p.cobrado, dados.currency)} (diferença ${money(p.diferenca, dados.currency)})`);
    const texto = [
      `Divergências de frete — últimos ${dados.dias} dias`,
      ...linhas,
      ``,
      `Total a contestar: ${money(dados.totalACustestar, dados.currency)}`,
    ].join("\n");
    void navigator.clipboard.writeText(texto).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    });
  }

  return (
    <div className="analysis-page audit-page">
      <PageHeader
        icon={pageIcons.monitor}
        eyebrow="Mercado Livre"
        title="Pedidos a revisar"
        subtitle="Compara o frete que o Mercado Pago descontou com o que o envio do Mercado Livre declara. Diferença não é erro provado — o frete pode ser reprecificado depois da pesagem. Use a lista para decidir o que contestar."
      />

      <div className="listing-controls audit-controls">
        <label>
          <span className="sr-only">Período</span>
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Período da auditoria">
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={60}>Últimos 60 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>
        </label>
        {dados && dados.pedidos.some((p) => p.diferenca > 0) && (
          <button type="button" className="profit-collapse-all" onClick={copiarCasos}>
            {copiado ? "Copiado" : "Copiar para contestação"}
          </button>
        )}
      </div>

      {erro ? (
        <div role="alert" className="profitability-error">{erro}</div>
      ) : carregando ? (
        <TableLoading label="Comparando fretes" />
      ) : !dados ? null : (
        <>
          <section className="listing-summary-band is-4 audit-summary-band" aria-label="Resumo da auditoria">
            <div className={dados.totalACustestar > 0 ? "is-danger" : "is-positive"}><span>A contestar</span><strong>{money(dados.totalACustestar, dados.currency)}</strong><small>soma do que foi cobrado a mais</small></div>
            <div><span>Pedidos a revisar</span><strong>{dados.pedidos.length}</strong><small>casos com alguma divergência</small></div>
            <div><span>Comparados</span><strong>{dados.comparados}</strong><small>pedidos com referência de envio</small></div>
            <div className={dados.semReferencia > 0 ? "is-warning" : ""}><span>Sem comparação</span><strong>{dados.semReferencia}</strong><small>pagamentos sem envio conhecido</small></div>
          </section>

          {dados.parcial && (
            <p className="audit-partial-note">
              Leitura parcial: o período tem mais pagamentos do que foi possível ler de uma vez. Reduza o
              período para cobrir tudo.
            </p>
          )}

          {dados.pedidos.length > 0 && (
            <section className="audit-comparison" aria-labelledby="audit-comparison-title">
              <header>
                <div><p className="section-kicker">Composição dos casos</p><h2 id="audit-comparison-title">Previsto versus cobrado</h2></div>
                <p>Somente os {dados.pedidos.length} pedidos listados abaixo</p>
              </header>
              <div className="audit-comparison-bars">
                <div><span>Frete previsto</span><i><b style={{ width: `${(totalEsperado / maiorTotal) * 100}%` }} /></i><strong>{money(totalEsperado, dados.currency)}</strong></div>
                <div className={totalCobrado > totalEsperado ? "is-danger" : ""}><span>Frete cobrado</span><i><b style={{ width: `${(totalCobrado / maiorTotal) * 100}%` }} /></i><strong>{money(totalCobrado, dados.currency)}</strong></div>
              </div>
            </section>
          )}

          {dados.pedidos.length === 0 ? (
            <EmptyState
              title="Nenhuma divergência no período"
              description={`Comparamos ${dados.comparados} pedido(s) e o frete cobrado bateu com o declarado no envio.`}
            />
          ) : (
            <section className="listing-table-shell audit-table-shell" aria-labelledby="audit-table-title">
              <header>
                <div><p className="section-kicker">Drill-down</p><h2 id="audit-table-title">Pedidos candidatos à revisão</h2></div>
                <p>{dados.pedidos.length} de {dados.comparados} comparados</p>
              </header>
              <div className="overflow-x-auto">
              <table className="listing-table audit-table table-fixed">
                <caption className="sr-only">Pedidos com frete cobrado diferente do declarado</caption>
                <thead className="bg-[var(--ink-03)] text-left text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                  <tr>
                    <th scope="col" className="px-3 py-3">Pedido</th>
                    <th scope="col" className="w-28 px-3 py-3 text-right">Previsto</th>
                    <th scope="col" className="w-28 px-3 py-3 text-right">Cobrado</th>
                    <th scope="col" className="w-32 px-3 py-3 text-right">Diferença</th>
                    <th scope="col" className="w-28 px-3 py-3 text-right">Venda</th>
                    <th scope="col" className="w-28 px-3 py-3 text-right">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {dados.pedidos.map((p) => (
                    <tr key={p.orderId}>
                      <td className="px-3 py-2.5">
                        <span className="block truncate font-mono text-xs">{p.orderId}</span>
                        {p.shipmentId && <span className="block truncate text-[12px] text-[var(--ink-muted)]">envio {p.shipmentId}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--ink-soft)]">
                        {money(p.esperado, dados.currency)}
                        <span className="block text-[12px] text-[var(--ink-muted)]">
                          você {money(p.esperadoVendedor, dados.currency)} + comprador {money(p.esperadoComprador, dados.currency)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--ink)]">{money(p.cobrado, dados.currency)}</td>
                      <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${p.diferenca > 0 ? "text-red-600" : "text-emerald-700"}`}>
                        {p.diferenca > 0 ? "+" : ""}{money(p.diferenca, dados.currency)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[var(--ink-muted)]">
                        {p.transactionAmount == null ? "—" : money(p.transactionAmount, dados.currency)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs text-[var(--ink-muted)]">
                        {p.paidAt ? brDate(p.paidAt) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </section>
          )}

          <p className="audit-method-note">
            <strong>Previsto</strong> é o frete cheio do envio: a sua parte (<code>senders[].cost</code>)
            mais a do comprador (<code>receiver.cost</code>). O Mercado Livre debita o cheio e credita de
            volta a parte do comprador, então comparar só com a sua parte acusaria divergência em todo
            pedido com frete dividido.
            <strong> Cobrado</strong> vem de <code>charges_details</code> do pagamento no Mercado Pago.
            Diferença negativa significa cobrança a menor, a seu favor — aparece na lista, mas não entra no total a contestar.
          </p>
        </>
      )}
    </div>
  );
}
