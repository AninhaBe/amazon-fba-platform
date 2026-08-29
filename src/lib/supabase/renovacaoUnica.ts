import { createHash } from "node:crypto";

/**
 * UMA renovação de sessão em voo por vez — entre REQUISIÇÕES, não dentro de uma.
 *
 * ## O defeito (29/08/2026, 12:11Z)
 *
 * A dona não conseguia entrar. No log, oito vezes em seis segundos:
 *
 * ```
 * AuthApiError: Too many concurrent token refresh requests on the same session
 * or refresh token — status 409
 * ```
 *
 * Não era o Supabase: medido de dentro da máquina, `/auth/v1/health` responde em
 * 169ms. Era **nosso**. Cada requisição monta seu próprio cliente e chama
 * `getClaims()`; uma carga de tela dispara muitas requisições; todas veem o
 * token vencido **ao mesmo tempo** e todas tentam renovar o **mesmo** refresh
 * token. Refresh token é de uso único e rotativo: a primeira rotaciona, as
 * outras chegam com um token que já não vale, e **a sessão morre no meio**.
 *
 * ## A forma disso, que é a mesma da noite inteira
 *
 * 28 transações brigando por 15 slots de conexão; N renovações brigando por 1
 * refresh token. O defeito não é o pool nem o auth — é **a tela pedir N vezes o
 * que precisava pedir uma vez**.
 *
 * ## O padrão
 *
 * Reaproveitado de `integrations/shopee.ts`, que já resolvia isto para o token
 * da Shopee: um mapa de promessas em voo por chave. Quem chega durante uma
 * renovação **espera o resultado dela** em vez de disparar a própria.
 *
 * ⚠️ Duas formas de fazer a mesma coisa no mesmo repo é dívida — por isso este
 * módulo copia o padrão em vez de inventar outro.
 */

/** Promessas em voo, por sessão. Some assim que a renovação termina. */
const emVoo = new Map<string, Promise<unknown>>();

/**
 * Teto de espera de quem chegou depois.
 *
 * ⚠️ Sem teto, trocaríamos 409 por espera infinita — o erro silencioso, que é
 * pior que o barulhento. Estourou, o chamador faz a própria tentativa: pior caso
 * volta ao comportamento antigo, nunca trava.
 */
const TETO_DE_ESPERA_MS = Number(process.env.AUTH_RENOVACAO_TIMEOUT_MS || 8_000);

/**
 * Chave da sessão a partir dos cookies de auth.
 *
 * ⚠️ HASH, nunca o valor: a chave vive em memória de módulo e não pode carregar
 * token de sessão de ninguém. Cookies diferentes → chaves diferentes → sessões
 * de pessoas distintas nunca compartilham renovação.
 */
export function chaveDaSessao(cookies: Array<{ name: string; value: string }>): string | null {
  const autenticacao = cookies
    .filter((c) => c.name.startsWith("sb-"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => `${c.name}=${c.value}`)
    .join("|");
  if (!autenticacao) return null;
  return createHash("sha256").update(autenticacao).digest("hex").slice(0, 32);
}

/**
 * Executa `fn` no máximo UMA vez por sessão ao mesmo tempo. Chamadas
 * concorrentes com a mesma chave recebem o resultado da primeira.
 *
 * Sem chave (visitante sem cookie de sessão), executa direto: não há sessão a
 * proteger e serializar visitantes anônimos criaria um gargalo global.
 */
export async function comRenovacaoUnica<T>(chave: string | null, fn: () => Promise<T>): Promise<T> {
  if (!chave) return fn();

  const pendente = emVoo.get(chave) as Promise<T> | undefined;
  if (pendente) {
    try {
      return await Promise.race([
        pendente,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout esperando renovação de sessão")), TETO_DE_ESPERA_MS)
        ),
      ]);
    } catch {
      // A que estava em voo falhou ou demorou demais: tenta por conta própria.
      // Pior caso, volta ao comportamento antigo — nunca fica travado.
      return fn();
    }
  }

  const tarefa = fn().finally(() => {
    emVoo.delete(chave);
  });
  emVoo.set(chave, tarefa);
  return tarefa;
}

/** Só para teste: quantas renovações estão em voo agora. */
export function renovacoesEmVoo(): number {
  return emVoo.size;
}
