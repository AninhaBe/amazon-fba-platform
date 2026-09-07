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
 *   O QUE PRECISA ACONTECER PARA ESTA JANELA MORRER, NESTA ORDEM:
 *   1. `WEBHOOK_ML_TOKEN` configurado no Fly — **antes** de tudo;
 *   2. a URL nova (com `?token=…`) cadastrada no DevCenter do ML;
 *   3. um push real chegando pela URL nova — medido, não suposto.
 *
 * Cumpridos os três, apague `FIM_DA_CONVIVENCIA` e a rota passa a exigir token.
 *
 * ⚠️ A ORDEM NÃO É DETALHE: quando a janela cai, **env ausente vira recusa**.
 * Fechadura sem chave não é porta aberta. Se a data passar sem a env no Fly, o
 * webhook do ML para de entrar — de propósito, e é por isso que o passo 1 vem
 * primeiro.
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

  // ⚠️ SEM SEGREDO CONFIGURADO, ACEITA — ENQUANTO A JANELA ESTIVER ABERTA.
  //
  // Recusar no dia do deploy fecharia o webhook do ML antes de alguém ter como
  // configurar a env: o modo de falha certo para "ainda não montamos a
  // fechadura" é a porta continuar como estava, com aviso alto no log.
  //
  // ⚠️ MAS ESSA PERMISSÃO MORRE JUNTO COM A JANELA (visto do cérebro, 07/09/2026):
  // **fechadura sem chave não é porta aberta.** Passada a data, env ausente vira
  // falha FECHADA. Sem essa amarra, o fail-open sobreviveria à convivência que o
  // justificava — que é exatamente a família de dívida que este arquivo existe
  // para não repetir. Ou seja: a env tem de estar no Fly ANTES de a janela cair.
  if (!esperado) {
    return janelaAberta(entrada.agora)
      ? { aceito: true, via: "sem-token-configurado" }
      : { aceito: false, via: "recusado" };
  }

  if (entrada.tokenRecebido !== null) {
    // Token PRESENTE e ERRADO nunca passa, nem durante a convivência: quem manda
    // token errado não é o chamador legado — o legado não manda token nenhum.
    return iguais(entrada.tokenRecebido, esperado)
      ? { aceito: true, via: "token" }
      : { aceito: false, via: "recusado" };
  }

  // Sem token: só enquanto a janela declarada estiver aberta.
  return janelaAberta(entrada.agora)
    ? { aceito: true, via: "convivencia" }
    : { aceito: false, via: "recusado" };
}

function janelaAberta(agora: Date): boolean {
  return agora.getTime() <= Date.parse(FIM_DA_CONVIVENCIA);
}

/** `true` quando a janela de convivência já deveria ter sido fechada. */
export function convivenciaVencida(agora: Date = new Date()): boolean {
  return agora.getTime() > Date.parse(FIM_DA_CONVIVENCIA);
}
