import { BaseDeData } from "@nexo/ds";

// A declaração da base do número — nasceu de "hoje R$ 194,25" que era por
// data do pedido enquanto ela esperava por data do repasse.
export function PorDataDoPedido() {
  return <BaseDeData base="pedido" />;
}

export function PorLancamento() {
  return <BaseDeData base="lancamento" />;
}

export function PedidoComExtrato() {
  return <BaseDeData base="pedido-extrato" />;
}
