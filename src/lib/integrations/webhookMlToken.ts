/**
 * ORIGEM DO WEBHOOK DO MERCADO LIVRE — token secreto na URL.
 *
 * O ML não assina as notificações dele (ao contrário da Shopee, que manda HMAC).
 * A única coisa que podemos exigir é um segredo que só nós e o DevCenter
 * conhecemos, embutido na URL cadastrada lá.
 *
 * ⚠️ JANELA DE CONVIVÊNCIA COM PRAZO DE MORTE DECLARADO. A URL nova precisa ser
 * cadastrada no DevCenter do ML ANTES de a antiga fechar — e o cadastro é ato de
 * pessoa, no navegador. Enquanto isso, a rota aceita os dois formatos.
 *
 * ⚠️ ISTO É DÍVIDA COM PRAZO, NÃO DESENHO — e este projeto já foi mordido por
 * salvaguarda temporária que sobreviveu à limitação que a justificou (31/08/2026,
 * a recusa da Shopee que continuou mentindo 4 horas depois de a rota passar a
 * aceitar). Por isso:
 *
 *   O QUE PRECISA ACONTECER PARA ESTA JANELA MORRER:
 *   1. `WEBHOOK_ML_TOKEN` configurado no Fly;
 *   2. a URL nova (com `?token=…`) cadastrada no DevCenter do ML;
 *   3. um push real chegando pela URL nova — medido, não suposto.
 *
 * Cumpridos os três, apague `FIM_DA_CONVIVENCIA` e a rota passa a exigir token.
 * E há teste que fica VERMELHO sozinho quando a data passar: ele existe para que
 * a janela não sobreviva ao silêncio de todo mundo.
 */
import { timingSafeEqual } from "node:crypto";

/** Depois desta data, requisição sem token é 404. Formato ISO, UTC. */
export const FIM_DA_CONVIVENCIA = "2026-09-14T23:59:59.000Z";

export type ViaDoWebhook = "token" | "convivencia" | "sem-token-configurado" | "recusado";

export interface DecisaoDeOrigem {
  aceito: boolean;
  via: ViaDoWebhook;
}

/**
 * Comparação em tempo constante. Comparar com `===` vaza o tamanho do prefixo
 * correto pelo tempo de resposta — é pouco, mas é grátis não vazar.
 */
function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  // `timingSafeEqual` exige o mesmo tamanho; comparar tamanhos antes já vaza o
  // tamanho, que não é segredo. O conteúdo é o que precisa de tempo constante.
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export function avaliarOrigemDoWebhook(entrada: {
  /** O que veio na URL. `null` = a requisição não trouxe token nenhum. */
  tokenRecebido: string | null;
  /** O segredo configurado. `null`/vazio = ainda não configuramos. */
  tokenEsperado: string | null | undefined;
  agora: Date;
}): DecisaoDeOrigem {
  const esperado = entrada.tokenEsperado?.trim();

  // ⚠️ SEM SEGREDO CONFIGURADO, ACEITA — e isto é uma escolha, não esquecimento.
  // Recusar aqui fecharia o webhook do ML no instante do deploy, antes de alguém
  // ter como configurar a env. O modo de falha certo para "ainda não montamos a
  // fechadura" é a porta continuar como estava, com aviso alto no log.
  if (!esperado) return { aceito: true, via: "sem-token-configurado" };

  if (entrada.tokenRecebido !== null) {
    // Token PRESENTE e ERRADO nunca passa, nem durante a convivência: quem manda
    // token errado não é o chamador legado — o legado não manda token nenhum.
    return iguais(entrada.tokenRecebido, esperado)
      ? { aceito: true, via: "token" }
      : { aceito: false, via: "recusado" };
  }

  // Sem token: só enquanto a janela declarada estiver aberta.
  return entrada.agora.getTime() <= Date.parse(FIM_DA_CONVIVENCIA)
    ? { aceito: true, via: "convivencia" }
    : { aceito: false, via: "recusado" };
}

/** `true` quando a janela de convivência já deveria ter sido fechada. */
export function convivenciaVencida(agora: Date = new Date()): boolean {
  return agora.getTime() > Date.parse(FIM_DA_CONVIVENCIA);
}
