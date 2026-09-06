import { CartaoDeMetrica, ReguaDeMetricas } from "@nexo/ds";

// O cartão vive numa régua; os quatro tons, e o desconhecido como traço.
export function ReguaCompleta() {
  return (
    <ReguaDeMetricas rotulo="Resumo do período (exemplo)">
      <CartaoDeMetrica label="Faturamento" value="R$ 2.000,00" sub="50 aprovadas + 2 canceladas" />
      <CartaoDeMetrica label="Taxas" value="R$ 240,00" info="O que o marketplace cobrou nas vendas processadas." />
      <CartaoDeMetrica label="Impostos" value="—" sub="alíquota não cadastrada" tone="warn" />
      <CartaoDeMetrica label="Lucro" value="R$ 240,00" tone="positive" />
    </ReguaDeMetricas>
  );
}

export function Prejuizo() {
  return (
    <ReguaDeMetricas rotulo="Resultado (exemplo)">
      <CartaoDeMetrica label="Lucro" value="−R$ 140,00" sub="após todos os custos" tone="danger" />
    </ReguaDeMetricas>
  );
}
