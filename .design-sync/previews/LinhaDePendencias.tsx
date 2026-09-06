import { LinhaDePendencias } from "@nexo/ds";

// Pendência aponta com número e link — nunca "parcial" nem adjetivo.
export function DuasPendencias() {
  return (
    <LinhaDePendencias
      itens={[
        { label: "Cadastrar custo de 5 produto(s)", href: "#", tone: "pendencia" },
        { label: "2 pedido(s) cancelado(s) no período", href: "#", tone: "alerta" },
      ]}
    />
  );
}

export function UmaPendencia() {
  return <LinhaDePendencias itens={[{ label: "Falta a alíquota de imposto", href: "#", tone: "pendencia" }]} />;
}
