import { CartaoDeMetrica, ReguaDeMetricas } from "@nexo/ds";

// A régua é o trilho dos cartões — rótulo à esquerda, cartões em linha.
export function ComQuatroCartoes() {
  return (
    <ReguaDeMetricas rotulo="Resumo do período (exemplo)">
      <CartaoDeMetrica label="Faturamento" value="R$ 2.000,00" sub="50 aprovadas + 2 canceladas" />
      <CartaoDeMetrica label="Taxas" value="R$ 240,00" />
      <CartaoDeMetrica label="Impostos" value="—" sub="alíquota não cadastrada" tone="warn" />
      <CartaoDeMetrica label="Lucro" value="R$ 240,00" tone="positive" />
    </ReguaDeMetricas>
  );
}
