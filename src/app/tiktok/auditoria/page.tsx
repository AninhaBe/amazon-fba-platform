"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, pageIcons } from "../../components/PageHeader";
import { TableLoading } from "../../components/LoadingState";
import { EmptyState } from "../../components/EmptyState";
import { ChannelConnectionEmpty } from "../../components/ChannelConnectionEmpty";
import { readJson } from "../../../lib/readJson";
import { brDate } from "@/lib/datetime";
import { MOTIVO_EM_PORTUGUES, type MotivoSemComparacao } from "@/lib/integrations/tiktokAuditoria";

interface PedidoARevisar {
  orderId: string;
  ocorridoEm: string | null;
  declarado: number;
  cobrado: number;
  diferenca: number;
  freteDoComprador: number | null;
  lancamentosLiquidados: number;
  statementId: string | null;
  currency: string;
}

interface Auditoria {
  availability: "AVAILABLE" | "BLOCKED" | "NOT_AVAILABLE";
  currency: string | null;
  pedidos: PedidoARevisar[];
  totalAContestar: number | null;
  comparados: number;
  pendencias: Array<{ orderId: string; motivo: MotivoSemComparacao }>;
  pendenciasPorMotivo: Record<MotivoSemComparacao, number> | null;
  lidos: number;
  limite: number;
  excedeuLimite: boolean;
}

interface Conexao {
  id: string;
  displayName?: string;
  externalAccountId?: string;
}

const money = (valor: number, currency: string | null) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(valor);

const iso = (data: Date) => data.toISOString().slice(0, 10);

function periodoDeDias(dias: number) {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - (dias - 1));
  return { from: iso(from), to: iso(to) };
}

/**
 * Pedidos a revisar (TikTok Shop) — o frete que o demonstrativo de pagamento
 * debitou contra o frete que o extrato do próprio pedido declara.
 *
 * Os dois números aparecem lado a lado de propósito, e a tela NÃO se chama
 * "cobranças indevidas": divergência é candidata a revisão, não erro provado.
 * Quem decide contestar é a vendedora.
 *
 * O frete pago pelo comprador aparece na linha como contexto e nunca é subtraído
 * — `shipping_cost_amount` já vem líquido dele. A explicação inteira, com a
 * evidência do OAS, está em `src/lib/integrations/tiktokAuditoria.ts`.
 */
export default function TiktokAuditoriaPage() {
  const [conexoes, setConexoes] = useState<Conexao[] | null>(null);
  const [selecionada, setSelecionada] = useState<string>("");
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState<Auditoria | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const periodo = useMemo(() => periodoDeDias(dias), [dias]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/integrations", { cache: "no-store", signal: controller.signal })
      .then((resposta) => readJson(resposta).then((corpo) => ({ ok: resposta.ok, corpo })))
      .then(({ ok, corpo }) => {
        if (!ok) throw new Error("Não foi possível carregar as conexões.");
        const provider = (corpo as { providers?: Array<{ id: string; connections?: Conexao[] }> })
          .providers?.find((item) => item.id === "tiktok_shop");
        const lista = (provider?.connections ?? []).slice().sort((a, b) => a.id.localeCompare(b.id));
        setConexoes(lista);
        setSelecionada((atual) => atual || lista[0]?.id || "");
      })
      .catch((motivo) => {
        if (motivo instanceof DOMException && motivo.name === "AbortError") return;
        setErro(motivo instanceof Error ? motivo.message : "Não foi possível carregar as conexões.");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selecionada) return;
    const controller = new AbortController();
    // `Promise.resolve()` antes do setState: chamar direto no efeito dispara
    // render em cascata (regra react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setCarregando(true);
      setErro(null);
      setDados(null);
    });
    const query = new URLSearchParams({ connection_id: selecionada, from: periodo.from, to: periodo.to });
    fetch(`/api/integrations/tiktok/auditoria?${query}`, { cache: "no-store", signal: controller.signal })
      .then((resposta) => readJson(resposta).then((corpo) => ({ ok: resposta.ok, corpo })))
      .then(({ ok, corpo }) => {
        if (!ok) throw new Error((corpo as { error?: string }).error || "Não foi possível comparar os fretes.");
        setDados(corpo as Auditoria);
      })
      .catch((motivo) => {
        if (motivo instanceof DOMException && motivo.name === "AbortError") return;
        setErro(motivo instanceof Error ? motivo.message : "Não foi possível comparar os fretes.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setCarregando(false);
      });
    return () => controller.abort();
  }, [selecionada, periodo]);

  const totalDeclarado = dados?.pedidos.reduce((soma, item) => soma + item.declarado, 0) ?? 0;
  const totalCobrado = dados?.pedidos.reduce((soma, item) => soma + item.cobrado, 0) ?? 0;
  const maiorTotal = Math.max(totalDeclarado, totalCobrado, 1);
  const pendentes = dados?.pendencias.length ?? 0;
  const motivos = dados?.pendenciasPorMotivo
    ? (Object.entries(dados.pendenciasPorMotivo) as Array<[MotivoSemComparacao, number]>)
        .filter(([, quantidade]) => quantidade > 0)
        .sort((a, b) => b[1] - a[1])
    : [];

  // Texto pronto para abrir o chamado — é o que a pessoa faz com a lista.
  function copiarCasos() {
    if (!dados?.pedidos.length) return;
    const linhas = dados.pedidos
      .filter((item) => item.diferenca > 0)
      .map(
        (item) =>
          `Pedido ${item.orderId} — extrato declara ${money(item.declarado, item.currency)}, ` +
          `repasse debitou ${money(item.cobrado, item.currency)} (diferença ${money(item.diferenca, item.currency)})`
      );
    const texto = [
      `Divergências de frete no TikTok Shop — ${brDate(periodo.from)} a ${brDate(periodo.to)}`,
      ...linhas,
      ``,
      `Total a contestar: ${money(dados.totalAContestar ?? 0, dados.currency)}`,
    ].join("\n");
    void navigator.clipboard.writeText(texto).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    });
  }

  return (
    <div className="analysis-page audit-page">
      <PageHeader
        icon={pageIcons.monitor ?? pageIcons.radar}
        eyebrow="TikTok Shop"
        title="Pedidos a revisar"
        subtitle="Compara o frete que o demonstrativo de pagamento debitou com o que o extrato do próprio pedido declara. Diferença não é erro provado — pode ser lançamento posterior ao fechamento. Use a lista para decidir o que contestar."
        action={
          conexoes && conexoes.length > 1 ? (
            <label className="channel-store-selector">
              Loja
              <select
                aria-label="Loja TikTok Shop"
                value={selecionada}
                onChange={(evento) => setSelecionada(evento.target.value)}
              >
                {conexoes.map((conexao) => (
                  <option key={conexao.id} value={conexao.id}>
                    {conexao.displayName || conexao.externalAccountId || conexao.id}
                  </option>
                ))}
              </select>
            </label>
          ) : undefined
        }
      />

      <div className="listing-controls audit-controls">
        <label>
          <span className="sr-only">Período</span>
          <select value={dias} onChange={(evento) => setDias(Number(evento.target.value))} aria-label="Período da auditoria">
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={60}>Últimos 60 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>
        </label>
        {dados?.pedidos.some((item) => item.diferenca > 0) && (
          <button type="button" className="profit-collapse-all" onClick={copiarCasos}>
            {copiado ? "Copiado" : "Copiar para contestação"}
          </button>
        )}
      </div>

      {conexoes?.length === 0 ? (
        <ChannelConnectionEmpty
          channel="TikTok Shop"
          description="Conecte uma loja para comparar o frete cobrado com o frete declarado."
          action={
            <Link className="meli-primary-action" href="/integracoes">
              Gerenciar conexões
            </Link>
          }
        />
      ) : erro ? (
        <div role="alert" className="profitability-error">
          {erro}
        </div>
      ) : carregando || !dados ? (
        <TableLoading label="Comparando fretes" />
      ) : dados.availability === "BLOCKED" ? (
        <EmptyState
          kind="permission"
          title="Comparação aguardando o ledger financeiro"
          description="O ledger de repasses ainda não está disponível neste ambiente. Nenhum valor foi estimado nem convertido em zero."
        />
      ) : dados.availability === "NOT_AVAILABLE" ? (
        <EmptyState
          title="Dados ainda não sincronizados"
          description="A conexão existe, mas os pedidos e os extratos deste período ainda não foram materializados."
        />
      ) : (
        <>
          <section className="listing-summary-band is-4 audit-summary-band" aria-label="Resumo da comparação">
            <div className={(dados.totalAContestar ?? 0) > 0 ? "is-danger" : "is-positive"}>
              <span>A contestar</span>
              <strong>{dados.totalAContestar == null ? "—" : money(dados.totalAContestar, dados.currency)}</strong>
              <small>{dados.totalAContestar == null ? "nenhum pedido pôde ser comparado" : "soma do que foi debitado a mais"}</small>
            </div>
            <div>
              <span>Pedidos a revisar</span>
              <strong>{dados.pedidos.length}</strong>
              <small>casos com alguma divergência</small>
            </div>
            <div>
              <span>Comparados</span>
              <strong>{dados.comparados}</strong>
              <small>de {dados.lidos} pedido(s) no período</small>
            </div>
            <div className={pendentes > 0 ? "is-warning" : ""}>
              <span>Sem comparação</span>
              <strong>{pendentes}</strong>
              <small>pedidos sem os dois lados no mesmo estado</small>
            </div>
          </section>

          {dados.excedeuLimite && (
            <p className="audit-partial-note">
              O período tem mais de {dados.limite} pedidos. Estamos comparando os {dados.limite} mais
              recentes — escolha um período menor para cobrir o resto.
            </p>
          )}

          {motivos.length > 0 && (
            <section className="audit-comparison" aria-labelledby="tiktok-audit-pendencias-title">
              <header>
                <div>
                  <p className="section-kicker">Fora da comparação</p>
                  <h2 id="tiktok-audit-pendencias-title">O que falta para comparar</h2>
                </div>
                <p>{pendentes} pedido(s)</p>
              </header>
              <ul className="audit-pending-reasons">
                {motivos.map(([motivo, quantidade]) => (
                  <li key={motivo}>
                    <strong>{quantidade} pedido{quantidade === 1 ? "" : "s"}</strong> — {MOTIVO_EM_PORTUGUES[motivo]}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {dados.pedidos.length > 0 && (
            <section className="audit-comparison" aria-labelledby="tiktok-audit-comparison-title">
              <header>
                <div>
                  <p className="section-kicker">Composição dos casos</p>
                  <h2 id="tiktok-audit-comparison-title">Declarado versus debitado</h2>
                </div>
                <p>Somente os {dados.pedidos.length} pedidos listados abaixo</p>
              </header>
              <div className="audit-comparison-bars">
                <div>
                  <span>Extrato declara</span>
                  <i>
                    <b style={{ width: `${(totalDeclarado / maiorTotal) * 100}%` }} />
                  </i>
                  <strong>{money(totalDeclarado, dados.currency)}</strong>
                </div>
                <div className={totalCobrado > totalDeclarado ? "is-danger" : ""}>
                  <span>Repasse debitou</span>
                  <i>
                    <b style={{ width: `${(totalCobrado / maiorTotal) * 100}%` }} />
                  </i>
                  <strong>{money(totalCobrado, dados.currency)}</strong>
                </div>
              </div>
            </section>
          )}

          {dados.pedidos.length === 0 ? (
            <EmptyState
              title={dados.comparados > 0 ? "Nenhuma divergência no período" : "Ainda não há pedido com os dois lados fechados"}
              description={
                dados.comparados > 0
                  ? `Comparamos ${dados.comparados} pedido(s) e o frete debitado bateu com o declarado no extrato.`
                  : `Nenhum dos ${dados.lidos} pedido(s) do período tem, ao mesmo tempo, extrato fechado e repasse liquidado. A lista acima diz o que falta em cada um.`
              }
            />
          ) : (
            <section className="listing-table-shell audit-table-shell" aria-labelledby="tiktok-audit-table-title">
              <header>
                <div>
                  <p className="section-kicker">Drill-down</p>
                  <h2 id="tiktok-audit-table-title">Pedidos candidatos à revisão</h2>
                </div>
                <p>
                  {dados.pedidos.length} de {dados.comparados} comparados
                </p>
              </header>
              <div className="overflow-x-auto">
                <table className="listing-table audit-table table-fixed">
                  <caption className="sr-only">Pedidos com frete debitado diferente do declarado no extrato</caption>
                  <thead className="bg-[var(--ink-03)] text-left text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                    <tr>
                      <th scope="col" className="px-3 py-3">Pedido</th>
                      <th scope="col" className="w-28 px-3 py-3 text-right">Extrato declara</th>
                      <th scope="col" className="w-28 px-3 py-3 text-right">Repasse debitou</th>
                      <th scope="col" className="w-32 px-3 py-3 text-right">Diferença</th>
                      <th scope="col" className="w-32 px-3 py-3 text-right">Comprador pagou</th>
                      <th scope="col" className="w-28 px-3 py-3 text-right">Data</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {dados.pedidos.map((item) => (
                      <tr key={item.orderId}>
                        <td className="px-3 py-2.5">
                          <span className="block truncate font-mono text-xs">{item.orderId}</span>
                          {item.statementId && (
                            <span className="block truncate text-[12px] text-[var(--ink-muted)]">
                              demonstrativo {item.statementId}
                              {item.lancamentosLiquidados > 1 ? ` · ${item.lancamentosLiquidados} lançamentos` : ""}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-[var(--ink-soft)]">
                          {money(item.declarado, item.currency)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-[var(--ink)]">
                          {money(item.cobrado, item.currency)}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-semibold tabular-nums ${item.diferenca > 0 ? "text-red-600" : "text-emerald-700"}`}
                        >
                          {item.diferenca > 0 ? "+" : ""}
                          {money(item.diferenca, item.currency)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-[var(--ink-muted)]">
                          {item.freteDoComprador == null ? "—" : money(item.freteDoComprador, item.currency)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs text-[var(--ink-muted)]">
                          {item.ocorridoEm ? brDate(item.ocorridoEm) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <p className="audit-method-note">
            <strong>Extrato declara</strong> é o <code>shipping_cost_amount</code> que o TikTok devolveu no
            extrato do pedido. <strong>Repasse debitou</strong> é o mesmo campo lido no demonstrativo de
            pagamento. São o mesmo número medido por dois caminhos — por isso podem ser subtraídos.
            <strong> Comprador pagou</strong> é o <code>payment.shipping_fee</code> e está aí só como contexto:
            ele já foi abatido dentro do custo do extrato, então descontá-lo de novo inventaria divergência
            em todo pedido com frete pago pelo comprador.
          </p>
        </>
      )}
    </div>
  );
}
