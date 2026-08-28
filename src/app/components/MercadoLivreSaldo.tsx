"use client";

import { useEffect, useState } from "react";
import { brDate } from "@/lib/datetime";
import { readJson } from "../../lib/readJson";
import { BaseDeData } from "./BaseDeData";

interface Saldo {
  currency: string;
  retido: number;
  liberadoNaJanela: number;
  liberacoes: { date: string; amount: number; pagamentos: number }[];
  pagamentosLidos: number;
  pagamentosTotais: number;
  parcial: boolean;
}

const money = (v: number, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);

/**
 * Saldo e liberação do Mercado Livre, lido da API do Mercado Pago.
 *
 * Existe pelo mesmo motivo do bloco da Amazon: lucro do período não responde
 * "cadê o dinheiro". O ML retém cada venda até uma data própria — vi um
 * pagamento de 15/08 com liberação só em 13/09 — e sem esta tela isso não
 * aparece em lugar nenhum.
 *
 * Diferença em relação à Amazon: o MP recusa o endpoint de saldo da conta
 * (`mercadopago_account/balance` → 403), então **não afirmamos "disponível
 * agora"**. Mostramos o que dá para provar: o que está retido e quando cai.
 */
export function MercadoLivreSaldo({
  connectionId,
  modo = "resumo",
}: {
  connectionId?: string;
  /**
   * `resumo` — o card compacto do dashboard.
   * `transacoes` — a aba do monitor, no mesmo formato da Amazon: faixa de
   * números em cima, extrato de liberações embaixo. Mesma busca, mesma fonte;
   * só a apresentação muda, para as duas abas dizerem a mesma coisa do mesmo
   * jeito nos dois canais.
   */
  modo?: "resumo" | "transacoes";
}) {
  const [saldo, setSaldo] = useState<Saldo | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const query = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : "";
    fetch(`/api/integrations/mercado-livre/balance${query}`, { cache: "no-store", signal: controller.signal })
      .then((r) => readJson(r).then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => { if (ok && d) setSaldo(d as Saldo); else setErro(true); })
      .catch((motivo) => { if (!(motivo instanceof DOMException && motivo.name === "AbortError")) setErro(true); });
    return () => controller.abort();
  }, [connectionId]);

  // Some em silêncio: é um bloco complementar, e um erro aqui não pode roubar a
  // atenção do resto do painel.
  if (erro || !saldo) return null;

  const proxima = saldo.liberacoes[0];

  if (modo === "transacoes") {
    return (
      <section className="monitor-transactions" aria-labelledby="ml-transacoes-title">
        <header className="monitor-section-heading">
          <div>
            <p>Financeiro conciliado</p>
            <h2 id="ml-transacoes-title">Conciliação de transações</h2>
            <small>
              O que o Mercado Pago já liberou e o que ainda retém, com a data de cada
              liberação. Não é o saldo da sua conta.
            </small>
          </div>
          <span>Valores do Mercado Pago</span>
        </header>

        <div className="monitor-transactions-body">
          <div className="transaction-summary-band">
            <StatSaldo
              label="Já liberado na janela"
              value={money(saldo.liberadoNaJanela, saldo.currency)}
              hint="O que o Mercado Pago já movimentou no período lido."
            />
            <StatSaldo
              label="Ainda retido"
              value={money(saldo.retido, saldo.currency)}
              hint="Vendas que o Mercado Livre segura até a data de liberação de cada uma."
            />
            <StatSaldo
              label="Líquido se tudo liquidar"
              value={money(+(saldo.liberadoNaJanela + saldo.retido).toFixed(2), saldo.currency)}
              hint="Soma dos dois. O retido ainda pode mudar por devolução ou ajuste."
            />
            <StatSaldo
              label="Pagamentos"
              value={saldo.pagamentosTotais.toLocaleString("pt-BR")}
              hint={
                saldo.parcial
                  ? `Lemos as ${saldo.pagamentosLidos} liberações mais próximas — o retido real é maior que o exibido.`
                  : "Todos os pagamentos pendentes foram lidos."
              }
            />
          </div>

          {saldo.liberacoes.length === 0 ? (
            <p className="saldo-nota">Nenhuma venda retida no período.</p>
          ) : (
            <div className="table-scroll monitor-transaction-table">
              <table className="data-table min-w-[520px]">
                <caption className="sr-only">Liberações previstas do Mercado Pago</caption>
                <thead className="bg-[var(--ink-03)] text-left text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                  <tr>
                    <th scope="col" className="px-4 py-3">Data de liberação</th>
                    <th scope="col" className="px-4 py-3">Pagamentos</th>
                    <th scope="col" className="px-4 py-3 text-right">Valor líquido</th>
                  </tr>
                </thead>
                <tbody>
                  {saldo.liberacoes.map((l) => (
                    <tr key={l.date}>
                      <td className="px-4 py-3">{brDate(l.date)}</td>
                      <td className="px-4 py-3 tabular-nums">{l.pagamentos}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(l.amount, saldo.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="saldo-nota">
            O valor é o <strong>líquido</strong>: venda menos tarifas menos a sua parte do frete — a
            mesma conta do &quot;Total a receber&quot; do Mercado Pago.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="saldo-panel" aria-labelledby="saldo-ml-title">
      <div>
        <p className="section-kicker">Saldo no Mercado Livre</p>
        <h2 id="saldo-ml-title" className="mt-1 text-lg font-semibold text-[var(--ink)]">Quando o dinheiro cai</h2>
        <BaseDeData base="lancamento" prefixo="Liberações" />
      </div>
      <div className="saldo-grid">
        <div className="saldo-card">
          <span>Retido pelo Mercado Pago</span>
          <strong>{money(saldo.retido, saldo.currency)}</strong>
          <small>
            {proxima ? `Primeira liberação em ${brDate(proxima.date)}` : "Nenhuma venda retida"}
            {saldo.parcial && ` · ${saldo.pagamentosLidos} de ${saldo.pagamentosTotais} pagamentos lidos`}
          </small>
        </div>
        <div className="saldo-card">
          <span>Pagamentos a liberar</span>
          <strong>{saldo.pagamentosTotais.toLocaleString("pt-BR")}</strong>
          <small>Já descontadas a tarifa de venda e a sua parte do frete</small>
        </div>
      </div>
      {saldo.liberacoes.length > 0 && (
        <ol className="saldo-liberacoes">
          {saldo.liberacoes.slice(0, 8).map((l) => (
            <li key={l.date}>
              <span>{brDate(l.date)}</span>
              <strong>{money(l.amount, saldo.currency)}</strong>
              <small>{l.pagamentos} {l.pagamentos === 1 ? "pagamento" : "pagamentos"}</small>
            </li>
          ))}
        </ol>
      )}
      <p className="saldo-nota">
        O valor é o <strong>líquido</strong>: venda menos tarifas menos a sua parte do frete — a mesma
        conta do &quot;Total a receber&quot; do Mercado Pago. O frete que o comprador paga não é descontado,
        porque o Mercado Livre debita o valor cheio e credita essa parte de volta.
        {saldo.parcial
          ? ` Lemos as ${saldo.pagamentosLidos} liberações mais próximas de ${saldo.pagamentosTotais} pendentes — o retido real é maior que o exibido.`
          : ""}
      </p>
    </section>
  );
}

function StatSaldo({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="transaction-stat">
      <span>{label}</span>
      <strong className="tabular-nums">{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}
