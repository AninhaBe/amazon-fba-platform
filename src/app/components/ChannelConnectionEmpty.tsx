import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";

export function ChannelConnectionEmpty({
  channel,
  description,
  action,
}: {
  channel: "Shopee" | "TikTok Shop";
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="channel-connection-empty" aria-label={`Preparar integração ${channel}`}>
      <EmptyState
        title={`Nenhuma loja ${channel} conectada`}
        description={description}
        payoff="Depois da primeira sincronização, este espaço passa a organizar vendas, resultado, estoque e produtos do canal."
        action={action}
      />

      <div className="channel-empty-preview">
        <header>
          <div>
            <p className="section-kicker">O que acontece depois</p>
            <h2>Da autorização à primeira decisão</h2>
          </div>
          <span>Sem dados simulados</span>
        </header>
        <ol>
          <li><span>1</span><div><strong>Autorize a loja</strong><small>O canal confirma a conta e entrega apenas os acessos aprovados.</small></div></li>
          <li><span>2</span><div><strong>Aguarde a sincronização</strong><small>Pedidos, catálogo e dados financeiros entram com cobertura explícita.</small></div></li>
          <li><span>3</span><div><strong>Confira a operação</strong><small>O NEXO separa fatos, pendências e valores ainda desconhecidos.</small></div></li>
        </ol>
        <dl>
          <div><dt>Financeiro</dt><dd>Faturamento, taxas e resultado quando disponíveis</dd></div>
          <div><dt>Operação</dt><dd>Pedidos, status e itens sincronizados</dd></div>
          <div><dt>Catálogo</dt><dd>Produtos, estoque e cobertura de custos</dd></div>
        </dl>
      </div>
    </section>
  );
}
