import { invalidateByKeyPart } from "./cache";

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
  "ml-abc:",                     // curva ABC do Mercado Livre
];

/**
 * Derruba tudo que depende de custo, em todos os canais. Chamar SEMPRE que um
 * custo for gravado ou removido — de QUALQUER rota, incluindo as próprias de
 * Shopee e TikTok.
 *
 * Chamar de canais que hoje não têm cache de custo (Shopee, TikTok leem direto)
 * é de propósito: o dia em que alguém cachear o overview deles, a invalidação já
 * está no lugar. O custo de chamar à toa é percorrer um Map pequeno; o custo de
 * esquecer é um número errado na tela que ninguém relaciona com a causa.
 */
export async function invalidateCostDerivedCaches(): Promise<void> {
  invalidateByKeyPart(...CHAVES_COM_CUSTO);
  // O snapshot em banco do ML saiu daqui em 28/08/2026: o materializer foi
  // desligado (plano da migração canônica, passo 4) e ninguém mais lê a tabela
  // — a invalidação era só write amplification (3,0 M de updates em 12 linhas).
}

/** Exportado para teste: a lista precisa acompanhar quem passa a usar custo. */
export const chavesComCusto = CHAVES_COM_CUSTO;
