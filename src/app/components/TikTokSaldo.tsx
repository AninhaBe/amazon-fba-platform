"use client";

import { useEffect, useState } from "react";
import { readJson } from "../../lib/readJson";
import type { SaldoTiktok } from "@/lib/integrations/tiktokSaldo";

interface RespostaSaldo {
  saldo: SaldoTiktok | null;
  availability: "AVAILABLE" | "BLOCKED";
  message?: string;
  liberadoDesde?: string;
}

/** Zero é fato e aparece como 0,00; desconhecido nunca vira número. */
const dinheiro = (valor: number | null, currency: string | null) =>
  valor === null
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency ?? "BRL" }).format(valor);

/**
 * O dia já vem calculado no fuso de São Paulo (`YYYY-MM-DD`). Passá-lo por
 * `new Date(...)` o interpretaria como meia-noite UTC e a formatação em
 * America/Sao_Paulo devolveria o dia ANTERIOR — a liberação de 13/09 apareceria
 * como 12/09. Aqui a string só é reordenada.
 */
const diaBr = (dia: string) => dia.split("-").reverse().join("/");

const contagem = (n: number) => n.toLocaleString("pt-BR");
const plural = (n: number, um: string, muitos: string) => `${contagem(n)} ${n === 1 ? um : muitos}`;

/**
 * Saldo e retenção do TikTok Shop.
 *
 * Existe pelo mesmo motivo dos blocos da Amazon e do Mercado Livre: lucro do
 * período não responde "cadê o dinheiro". O TikTok segura cada venda até fechar
 * o extrato e só então emite o repasse com data.
 *
 * A disciplina copiada do Mercado Livre é a de não afirmar o que a API não
 * prova. Lá o endpoint de saldo da conta responde 403 e por isso o painel não
 * diz "disponível agora". Aqui o limite é a data: ela existe apenas onde o
 * TikTok emitiu `expected_time`. O que está retido sem extrato aparece com o
 * valor que o próprio TikTok estima e com a contagem de vendas nesse estado —
 * nunca com uma data inventada.
 */
export function TikTokSaldo({ connectionId }: { connectionId?: string }) {
  // O estado carrega a loja que o produziu: trocar de loja não pode deixar o
  // saldo da anterior na tela enquanto a nova carrega.
  const [estado, setEstado] = useState<{ id: string; resposta: RespostaSaldo | null } | null>(null);

  useEffect(() => {
    if (!connectionId) return;
    const controller = new AbortController();
    fetch(`/api/integrations/tiktok/saldo?connection_id=${encodeURIComponent(connectionId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((r) => readJson(r).then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => setEstado({ id: connectionId, resposta: ok && d ? (d as RespostaSaldo) : null }))
      .catch((motivo) => {
        if (!(motivo instanceof DOMException && motivo.name === "AbortError")) {
          setEstado({ id: connectionId, resposta: null });
        }
      });
    return () => controller.abort();
  }, [connectionId]);

  // Bloco complementar: uma falha de rede aqui não pode roubar a atenção do
  // resto do painel.
  if (!connectionId || estado?.id !== connectionId) return null;
  const resposta = estado.resposta;
  if (!resposta) return null;

  if (resposta.availability === "BLOCKED" || !resposta.saldo) {
    return (
      <section className="saldo-panel" aria-labelledby="saldo-tiktok-title">
        <div>
          <p className="section-kicker">Saldo no TikTok Shop</p>
          <h2 id="saldo-tiktok-title" className="mt-1 text-lg font-semibold text-[var(--ink)]">
            Quando o dinheiro cai
          </h2>
        </div>
        <p className="saldo-nota">
          {resposta.message ?? "O ledger financeiro ainda não está disponível neste ambiente."} Nenhum valor foi
          convertido em zero.
        </p>
      </section>
    );
  }

  const saldo = resposta.saldo;
  const { currency } = saldo;
  const semMovimento = saldo.leitura.movimentacoesLidas === 0 && saldo.leitura.pagamentosLidos === 0;
  const proxima = saldo.proximaLiberacao;
  const retidas = saldo.retidoVendas + saldo.retidoSemValor;

  return (
    <section className="saldo-panel" aria-labelledby="saldo-tiktok-title">
      <div>
        <p className="section-kicker">Saldo no TikTok Shop</p>
        <h2 id="saldo-tiktok-title" className="mt-1 text-lg font-semibold text-[var(--ink)]">
          Quando o dinheiro cai
        </h2>
      </div>

      {semMovimento ? (
        <p className="saldo-nota">
          Nenhuma movimentação financeira sincronizada para esta loja até agora. O saldo aparece assim que a
          sincronização financeira gravar o primeiro extrato ou repasse.
        </p>
      ) : (
        <>
          <div className="saldo-grid">
            <div className="saldo-card">
              <span>Retido pelo TikTok</span>
              <strong>{dinheiro(saldo.retido, currency)}</strong>
              <small>
                {retidas > 0
                  ? `${plural(retidas, "venda ainda sem extrato", "vendas ainda sem extrato")} — o TikTok só informa a data quando fecha o extrato`
                  : "Nenhuma venda retida"}
              </small>
            </div>
            <div className="saldo-card">
              <span>A liberar com data</span>
              <strong>{dinheiro(saldo.aLiberar, currency)}</strong>
              <small>
                {proxima
                  ? proxima.atrasada
                    ? `Prevista para ${diaBr(proxima.date)} e ainda não repassada`
                    : `Primeira liberação em ${diaBr(proxima.date)}`
                  : "Nenhum repasse com data prevista"}
              </small>
            </div>
            <div className="saldo-card">
              <span>Liberado nos últimos 30 dias</span>
              <strong>{dinheiro(saldo.liberado, currency)}</strong>
              <small>
                {saldo.liberadoPagamentos > 0
                  ? `${plural(saldo.liberadoPagamentos, "repasse pago", "repasses pagos")} — não é o saldo da sua conta bancária`
                  : "Nenhum repasse pago na janela lida"}
              </small>
            </div>
          </div>

          {saldo.liberacoes.length > 0 && (
            <ol className="saldo-liberacoes">
              {saldo.liberacoes.slice(0, 8).map((liberacao) => (
                <li key={liberacao.date}>
                  <span>{diaBr(liberacao.date)}</span>
                  <strong>{dinheiro(liberacao.amount, currency)}</strong>
                  <small>
                    {liberacao.vendas === null
                      ? plural(liberacao.pagamentos, "repasse", "repasses")
                      : plural(liberacao.vendas, "venda", "vendas")}
                    {liberacao.atrasada ? " · data prevista já passou" : ""}
                  </small>
                </li>
              ))}
            </ol>
          )}

          {saldo.pendencias.length > 0 && (
            <ul className="saldo-nota list-disc pl-4">
              {saldo.pendencias.map((pendencia) => (
                <li key={pendencia.codigo}>{pendencia.texto}</li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="saldo-nota">
        O valor retido é o repasse que o próprio TikTok estima por pedido ainda sem extrato, do jeito que ele
        informa: um número único, sem separar ads, imposto retido ou reembolso. A data de liberação existe só
        depois que o extrato fecha e o repasse é emitido — por isso a venda retida aparece com valor e sem data.
      </p>
    </section>
  );
}
