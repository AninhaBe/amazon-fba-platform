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
    <div className="dashboard-sections space-y-8">
      <PageHeader
        icon={pageIcons.monitor}
        eyebrow="Mercado Livre"
        title="Pedidos a revisar"
        subtitle="Compara o frete que o Mercado Pago descontou com o que o envio do Mercado Livre declara. Diferença não é erro provado — o frete pode ser reprecificado depois da pesagem. Use a lista para decidir o que contestar."
      />

      <div className="profitability-filters">
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
          <section className="metric-grid grid grid-cols-1 gap-0 sm:grid-cols-3" aria-label="Resumo da auditoria">
            <div className="metric-cell p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">A contestar</p>
              <p className="mt-2 text-[27px] font-bold leading-none tabular-nums text-slate-900">
                {money(dados.totalACustestar, dados.currency)}
              </p>
              <p className="mt-1.5 text-xs text-slate-400">soma do que foi cobrado a mais</p>
            </div>
            <div className="metric-cell p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Pedidos a revisar</p>
              <p className="mt-2 text-[27px] font-bold leading-none tabular-nums text-slate-900">{dados.pedidos.length}</p>
              <p className="mt-1.5 text-xs text-slate-400">de {dados.comparados} comparados</p>
            </div>
            <div className="metric-cell p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Sem comparação</p>
              <p className="mt-2 text-[27px] font-bold leading-none tabular-nums text-slate-900">{dados.semReferencia}</p>
              <p className="mt-1.5 text-xs text-slate-400">pagamento sem envio conhecido</p>
            </div>
          </section>

          {dados.parcial && (
            <p className="saldo-nota">
              Leitura parcial: o período tem mais pagamentos do que foi possível ler de uma vez. Reduza o
              período para cobrir tudo.
            </p>
          )}

          {dados.pedidos.length === 0 ? (
            <EmptyState
              title="Nenhuma divergência no período"
              description={`Comparamos ${dados.comparados} pedido(s) e o frete cobrado bateu com o declarado no envio.`}
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white shadow-sm">
              <table className="w-full min-w-[720px] table-fixed text-sm">
                <caption className="sr-only">Pedidos com frete cobrado diferente do declarado</caption>
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-3 py-3">Pedido</th>
                    <th scope="col" className="w-28 px-3 py-3 text-right">Previsto</th>
                    <th scope="col" className="w-28 px-3 py-3 text-right">Cobrado</th>
                    <th scope="col" className="w-32 px-3 py-3 text-right">Diferença</th>
                    <th scope="col" className="w-28 px-3 py-3 text-right">Venda</th>
                    <th scope="col" className="w-28 px-3 py-3 text-right">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dados.pedidos.map((p) => (
                    <tr key={p.orderId}>
                      <td className="px-3 py-2.5">
                        <span className="block truncate font-mono text-xs">{p.orderId}</span>
                        {p.shipmentId && <span className="block truncate text-[11px] text-slate-400">envio {p.shipmentId}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{money(p.esperado, dados.currency)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">{money(p.cobrado, dados.currency)}</td>
                      <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${p.diferenca > 0 ? "text-red-600" : "text-emerald-700"}`}>
                        {p.diferenca > 0 ? "+" : ""}{money(p.diferenca, dados.currency)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                        {p.transactionAmount == null ? "—" : money(p.transactionAmount, dados.currency)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs text-slate-500">
                        {p.paidAt ? brDate(p.paidAt) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="saldo-nota">
            <strong>Previsto</strong> vem de <code>senders[].cost</code> do envio no Mercado Livre.
            <strong> Cobrado</strong> vem de <code>charges_details</code> do pagamento no Mercado Pago.
            Diferença negativa significa cobrança a menor, a seu favor — aparece na lista, mas não entra no total a contestar.
          </p>
        </>
      )}
    </div>
  );
}
