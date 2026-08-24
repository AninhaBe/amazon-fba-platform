/**
 * A legenda que fica embaixo do título do gráfico: quantos pedidos foram
 * confirmados, quantos aguardam pagamento e quantos foram cancelados.
 *
 * Existe como componente compartilhado porque nasceu dentro da página da Amazon
 * e o Mercado Livre ficou sem — a tela dele mostrava só o total do período, sem
 * dizer de onde ele vinha. Ela cobrou a equalização em 24/08/2026.
 *
 * ⚠️ DUAS REGRAS QUE JÁ CUSTARAM BUG. Não relaxar nenhuma:
 *
 * 1. A condição de exibir é HAVER PEDIDO, não haver pendente. Quando era
 *    `aguardando > 0`, o filtro "Hoje" — com o único pedido já confirmado —
 *    fazia a linha inteira sumir (23/08/2026).
 *
 * 2. Cancelado entra por QUANTIDADE, nunca por valor. Na Amazon o valor de
 *    cancelado é estimativa nossa (a API zera o pedido ao cancelar), e
 *    estimativa no meio de fatos confirmados faz duvidar do resto da tela. O
 *    Mercado Livre até informa o valor, mas a legenda diz a mesma coisa nos dois
 *    canais — equalizar é usar o mesmo significado, não só o mesmo componente.
 *
 * A `nota` é o que MUDA por canal: cada marketplace tem a sua regra de quando o
 * dinheiro aparece, e é ela que explica por que existe um "aguardando".
 */
export function LegendaDeVendas({
  confirmados,
  aguardando,
  cancelados,
  nota,
  money,
}: {
  confirmados: { pedidos: number; valor: number };
  aguardando?: { pedidos: number; valor: number | null } | null;
  cancelados?: { pedidos: number } | null;
  nota?: string;
  /** Formatador do canal, já com a moeda da conta. */
  money: (valor: number) => string;
}) {
  const pedidosAguardando = aguardando?.pedidos ?? 0;
  const pedidosCancelados = cancelados?.pedidos ?? 0;

  if (confirmados.pedidos <= 0 && pedidosAguardando <= 0 && pedidosCancelados <= 0) return null;

  return (
    <p className="sales-split">
      {confirmados.pedidos > 0 && (
        <span>
          <strong>{confirmados.pedidos}</strong>{" "}
          {confirmados.pedidos === 1 ? "confirmado" : "confirmados"} · {money(confirmados.valor)}
        </span>
      )}
      {pedidosAguardando > 0 && (
        <span className="is-pendente">
          <strong>{pedidosAguardando}</strong> aguardando pagamento
          {/* Valor desconhecido não vira zero: some da linha e a nota explica. */}
          {aguardando?.valor != null && ` · ${money(aguardando.valor)}`}
        </span>
      )}
      {pedidosCancelados > 0 && (
        <span className="is-cancelada">
          <strong>{pedidosCancelados}</strong>{" "}
          {pedidosCancelados === 1 ? "cancelado" : "cancelados"}
        </span>
      )}
      {nota && pedidosAguardando > 0 && <small>{nota}</small>}
    </p>
  );
}
