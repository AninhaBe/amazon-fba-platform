import { timingSafeEqual } from "node:crypto";

/**
 * ORIGEM DO WEBHOOK DO MERCADO LIVRE — token secreto na URL.
 *
 * O ML não assina as notificações dele (ao contrário da Shopee, que manda HMAC).
 * A única coisa que podemos exigir é um segredo que só nós e o DevCenter
 * conhecemos, embutido na URL cadastrada lá.
 *
 * ⚠️ A JANELA DE CONVIVÊNCIA MORREU EM 07/09/2026, no mesmo dia em que nasceu, e
 * morreu do jeito certo: com os quatro passos cumpridos e medidos, não por
 * alguém achar que já dava.
 *
 *   1. `WEBHOOK_ML_TOKEN` no Fly — feito;
 *   2. URL com `?token=` cadastrada no DevCenter — feito;
 *   3. push real chegando pela URL nova — **medido nos logs do Fly**: 33 pushes
 *      "aceito COM token" e ZERO "aceito SEM token", a partir das 18:50:26;
 *   4. remoção da janela e da guarda de data — este commit.
 *
 * Fica registrado porque a intenção deste arquivo já mudou uma vez, e teste que
 * inverte sem dizer por que é o primeiro a ser afrouxado depois: até hoje à
 * tarde, requisição SEM token entrava. Agora não entra mais, nunca.
 *
 * ⚠️ E SEM `WEBHOOK_ML_TOKEN` CONFIGURADO, NINGUÉM ENTRA. Enquanto a janela
 * existiu, a env ausente deixava passar — era a única forma de não fechar o
 * webhook antes de alguém ter como configurá-la. Com a janela fechada, vale a
 * regra da casa: *fechadura sem chave não é porta aberta.*
 *
 * 📌 O CAMPO DE URL DO DEVCENTER TRUNCA EM 120 CARACTERES, em silêncio dos dois
 * lados. A base ocupa 58, então o token tem **32 caracteres** — não por
 * segurança, por caber. Ver o changelog de `docs/api-mercado-livre.md`.
 */
export type ViaDoWebhook = "token" | "recusado";

export interface DecisaoDeOrigem {
  aceito: boolean;
  via: ViaDoWebhook;
}

/**
 * Comparação em tempo constante. Comparar com `===` vaza o tamanho do prefixo
 * correto pelo tempo de resposta — é pouco, e é grátis não vazar.
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
}): DecisaoDeOrigem {
  const esperado = entrada.tokenEsperado?.trim();
  if (!esperado) return { aceito: false, via: "recusado" };
  if (entrada.tokenRecebido === null) return { aceito: false, via: "recusado" };
  return iguais(entrada.tokenRecebido, esperado)
    ? { aceito: true, via: "token" }
    : { aceito: false, via: "recusado" };
}
