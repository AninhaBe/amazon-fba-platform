

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
/**
 * ⚠️ A FACE DIZ A ORIGEM, NAO A PALAVRA "ESTIMADO" (01/09/2026).
 *
 * A vendedora leu o rotulo antigo e disse: *"nao e estimado, e a tabela
 * oficial"*. Ela esta certa sobre o que ele vendia — as tres fontes sao numero
 * PUBLICADO PELA AMAZON, e "estimado" sugeria conta nossa. O rotulo agora nomeia
 * a fonte, e quem decide o texto e a peca (`rotuloDaMarca`), nunca este
 * componente: um lugar so para os quatro canais.
 *
 * ⚠️ A MARCA EM SI FICOU. Ela e o diferencial da ADR-027 — diz que o
 * pedido ainda nao liquidou e que o valor vai ser substituido —, e essa promessa
 * mora no `title`. Tirar a palavra e manter a marca e a diferenca entre "o dado
 * e oficial" e "o pedido ja fechou".
 *
 * `origemConhecida` continua obrigatoria porque muda a TINTA: origem que a tela
 * nao sabe ler e defeito nosso, e defeito nao mora em tooltip.
 */
export function MarcaDeEstimativa({ procedencia, rotulo, origemConhecida }: { procedencia: string; rotulo: string; origemConhecida: boolean }) {
  return (
    <span
      className={`marca-estimativa${origemConhecida ? "" : " marca-estimativa--sem-origem"}`}
      tabIndex={0}
      role="note"
      aria-label={`${rotulo}. ${procedencia}`}
      title={procedencia}
    >
      {rotulo}
    </span>
  );
}
