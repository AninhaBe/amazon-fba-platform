/**
 * O que a pessoa lê quando o login falha — e a diferenca entre culpar ela e
 * assumir o defeito.
 *
 * ## O defeito (29/08/2026)
 *
 * Qualquer erro de auth virava "E-mail ou senha incorretos." A dona ficou
 * trancada do lado de fora enquanto o log mostrava
 * `AuthApiError: Too many concurrent token refresh requests` (409) e
 * `timeout exceeded when trying to connect` — nenhum dos dois tem relacao com a
 * senha dela.
 *
 * Isso e defeito de DUAS caras:
 *  1. CULPA A USUARIA por uma falha do sistema — o oposto da regra da casa, que
 *     manda dizer o que esta acontecendo;
 *  2. INDUZ A REPETIR a tentativa, e tentativa repetida de login e exatamente o
 *     que dispara limite de taxa no provedor — a mensagem criaria o problema que
 *     ela descrevia.
 *
 * Credencial errada de verdade continua dizendo o que sempre disse. Qualquer
 * outra coisa assume o defeito e diz que ela nao precisa fazer nada.
 */
export function mensagemDeFalhaDeLogin(error: { status?: number; code?: string; message?: string }): string {
  const status = error?.status;
  const code = String(error?.code ?? "");
  const texto = String(error?.message ?? "");

  // O unico caso em que a culpa e da credencial. O Supabase e explicito aqui.
  const credencialInvalida =
    status === 400 &&
    (code === "invalid_credentials" || /invalid login credentials/i.test(texto));
  if (credencialInvalida) return "E-mail ou senha incorretos.";

  // E-mail nao confirmado tambem e acionavel por ela, e e outra frase.
  if (code === "email_not_confirmed" || /email not confirmed/i.test(texto)) {
    return "Confirme o e-mail pelo link que enviamos e tente de novo.";
  }

  // Limite de tentativas: dizer para esperar, NUNCA para tentar de novo.
  if (status === 429 || code === "over_request_rate_limit") {
    return "Muitas tentativas seguidas. Aguarde um minuto antes de tentar de novo.";
  }

  // Todo o resto e NOSSO: 409 de renovacao concorrente, 5xx, timeout de rede.
  // A frase assume o defeito e diz explicitamente para ela NAO repetir.
  return "Nao conseguimos concluir o login agora — o problema e nosso, nao da sua senha. Nao precisa tentar de novo: aguarde um instante e recarregue a pagina.";
}
