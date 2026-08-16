"use client";

import { useEffect, useState } from "react";
import { brDate } from "@/lib/datetime";
import { readJson } from "../../lib/readJson";

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
export function MercadoLivreSaldo({ connectionId }: { connectionId?: string }) {
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
  return (
    <section className="saldo-panel" aria-labelledby="saldo-ml-title">
      <div>
        <p className="section-kicker">Saldo no Mercado Livre</p>
        <h2 id="saldo-ml-title" className="mt-1 text-lg font-semibold text-slate-900">Quando o dinheiro cai</h2>
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
          ? ` Total parcial: lemos as ${saldo.pagamentosLidos} liberações mais próximas de ${saldo.pagamentosTotais} pendentes, então o retido real é maior que o exibido.`
          : ""}
      </p>
    </section>
  );
}
