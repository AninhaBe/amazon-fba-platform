import { procedenciaDaEstimativa } from "./procedenciaDaEstimativa";

/**
 * MARCA DE ESTIMATIVA — o selo que diz que este número ainda não é o oficial.
 *
 * É a peça visual que a [ADR-027](../../../docs/adr/ADR-027-tarifa-estimada-ate-a-liquidacao.md)
 * deixou em aberto de propósito ("o padrão de ênfase da Vitrine, definido por
 * ela; este ADR não escolhe cor nem ícone").
 *
 * ⚠️ POR QUE ELA EXISTE, e é o único lugar em que ficamos melhores que o
 * concorrente: medido em 31/08/2026, o Gestor Seller mostra comissão e FBA
 * calculados por tabela **sem marca nenhuma**, como se fossem oficiais — e nunca
 * substitui pelo extrato (pedido `702-9124025-9780207`, aprovado em 10/08,
 * seguia com 12,01% de tabela três semanas depois). Copiar o número sem copiar a
 * marca seria adotar o defeito deles. A marca e a substituição são a vantagem.
 *
 * DECISÕES DE DESENHO, e o motivo de cada uma:
 *
 * - **A palavra é "estimado", nunca "parcial".** `AGENTS.md`: adjetivo que se
 *   desculpa explica à vendedora o que ela já sabe. "Estimado" não se desculpa —
 *   diz de onde o número veio, e o `title` diz de onde exatamente.
 * - **Tinta terciária com contorno, não cor de alarme.** Estimativa não é erro
 *   nem pendência da vendedora: não há nada para ela fazer. Cor de alerta aqui
 *   treinaria a ignorar alerta no dia em que ele importa (hierarquia de avisos
 *   da casa).
 * - **Fica COLADA no número, nunca em faixa.** Mesma regra da janela dos canais
 *   na aba de Ads: quem olha rápido tem de ver a marca junto do valor.
 * - **Some quando não há estimativa.** Marca permanente vira decoração. É o
 *   `null ≠ 0` aplicado à moldura: sem estimativa, nada a declarar.
 *
 * ⚠️ A CONDIÇÃO DE EXIBIÇÃO É "HÁ PEDIDO ESTIMADO", NÃO "O VALOR É > 0".
 * Medido em 31/08/2026 na conta AO62LVXJMX3AA: a Product Fees API respondeu
 * `Status: Success` com `Amount: 0` nos três pedidos do dia. Zero publicado pela
 * fonte é um fato, e um fato estimado continua sendo estimado — sem a marca, a
 * tela mostraria lucro sem tarifa nenhuma sem dizer que aquilo pode mudar.
 */
export function MarcaDeEstimativa({ procedencia }: { procedencia: string }) {
  return (
    <span className="marca-estimativa" tabIndex={0} role="note" aria-label={`Valor estimado. ${procedencia}`} title={procedencia}>
      estimado
    </span>
  );
}

export { procedenciaDaEstimativa };
