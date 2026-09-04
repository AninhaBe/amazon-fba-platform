/**
 * OS DOIS APPS DO TIKTOK — e esta convivência TEM PRAZO DE MORTE.
 *
 * ⚠️ LEIA A CONDIÇÃO DE MORTE ANTES DE ESTENDER QUALQUER COISA AQUI. Isto não é
 * desenho: é uma transição, decidida pela dona do produto em 04/09/2026. O
 * destino é **um app só, o público**.
 *
 *   hoje ......... o app CUSTOM atende a loja conectada, em produção;
 *                  o app PÚBLICO existe para a revisão funcional do TikTok.
 *   quando o público for APROVADO -> janela com a dona do produto -> a loja
 *   reautoriza pelo público -> o custom é aposentado -> o par extra sai do Fly
 *   -> **este arquivo morre junto**.
 *
 * 📌 Por que não migrar de uma vez: a migração real só é possível depois da
 * aprovação, e trocar antes cortaria a loja que está conectada e funcionando.
 * Por que não conviver para sempre: dois pares de credencial é a família do
 * `undefined` em produção que a Amazon já pagou (`.env` × `workspace_accounts`).
 *
 * Quem cobra essa morte: `TODO.md` -> "TikTok: aposentar o app custom", e a
 * guarda `tests/convivenciaDoTikTokTemPrazo`.
 */

/** Qual dos dois apps autorizou (ou vai autorizar) uma conexão. */
export type AppDoTikTok = "custom" | "publico";

/** O app padrão é o CUSTOM: nada muda para quem já está conectado. */
export const APP_PADRAO: AppDoTikTok = "custom";

export interface CredenciaisDoApp {
  key: string;
  secret: string;
  serviceId: string | undefined;
}

/**
 * As variáveis de cada app. O custom mantém os nomes de sempre — renomeá-los
 * seria churn que quebraria a conexão viva por nada.
 */
export function credenciaisDoApp(app: AppDoTikTok): CredenciaisDoApp {
  if (app === "publico") {
    return {
      key: process.env.TIKTOK_PUBLIC_APP_KEY ?? "",
      secret: process.env.TIKTOK_PUBLIC_APP_SECRET ?? "",
      serviceId: process.env.TIKTOK_PUBLIC_SERVICE_ID,
    };
  }
  return {
    key: process.env.TIKTOK_APP_KEY ?? "",
    secret: process.env.TIKTOK_APP_SECRET ?? "",
    serviceId: process.env.TIKTOK_SERVICE_ID,
  };
}

/** O app público só existe quando as TRÊS variáveis dele existem. */
export function appPublicoConfigurado(): boolean {
  const c = credenciaisDoApp("publico");
  return !!(c.key && c.secret && c.serviceId);
}

/**
 * Decisão PURA de qual app atende um pedido de autorização.
 *
 * ⚠️ `publico` NUNCA é escolhido por acaso: exige pedido explícito E as três
 * variáveis no ambiente. Sem elas, cai no custom — que é o comportamento de
 * hoje, e o modo de falha certo enquanto a transição não terminou.
 */
export function appDaAutorizacao(
  pedido: string | null | undefined,
  publicoConfigurado = appPublicoConfigurado(),
): AppDoTikTok {
  return pedido === "publico" && publicoConfigurado ? "publico" : APP_PADRAO;
}

/** Normaliza o que veio gravado numa conexão. Valor estranho = custom. */
export function appDaConexao(valor: unknown): AppDoTikTok {
  return valor === "publico" ? "publico" : APP_PADRAO;
}
