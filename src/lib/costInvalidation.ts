import { invalidateByKeyPart } from "./cache";
import { invalidateMercadoLivreOverviewSnapshots } from "./integrations/mercadoLivreOverviewCache";

/**
 * Chaves de cache cujo resultado embute o custo cadastrado. Trocar o custo de um
 * SKU precisa derrubar todas — o número na tela vira mentira no instante em que
 * o custo muda, e esperar o TTL (até 5 minutos) faz parecer que o salvamento não
 * funcionou.
 *
 * O Mercado Livre já invalidava o snapshot dele desde sempre; a Amazon não
 * invalidava nada, então o painel dela demorava até 5 minutos para refletir uma
 * troca de custo enquanto o do ML respondia na hora. Foi assim que a Ana notou,
 * em 15/08/2026.
 */
const CHAVES_COM_CUSTO = [
  "order-profitability:",        // rentabilidade por venda (Amazon, cálculo ao vivo)
  "amazon-overview-canonical:",  // overview da Amazon por SQL
  "amazon-abc:",                 // curva ABC da Amazon
];

/**
 * Derruba tudo que depende de custo, em todos os canais. Chamar SEMPRE que um
 * custo for gravado ou removido.
 */
export async function invalidateCostDerivedCaches(): Promise<void> {
  invalidateByKeyPart(...CHAVES_COM_CUSTO);
  // Snapshot em banco do ML — não vive no cache de memória.
  await invalidateMercadoLivreOverviewSnapshots();
}

/** Exportado para teste: a lista precisa acompanhar quem passa a usar custo. */
export const chavesComCusto = CHAVES_COM_CUSTO;
