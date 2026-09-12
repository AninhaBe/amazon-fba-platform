/**
 * OS APPS DO TIKTOK — e por que existem DOIS NOMES para o que parecia um só.
 *
 * ⚠️ O MODELO MUDOU EM 11/09/2026, por decisão da dona do produto: **o app
 * PÚBLICO é o único daqui para frente** (verbatim: *"pode desligar o custom do
 * tiktok, vamos usar a aplicacao do tiktok que foi aprovada (public)"*).
 *
 * Antes disso o plano era MIGRAR uma loja do custom para o público. Não é mais:
 * não há migração. Qualquer vendedor — inclusive o dono da loja que já está
 * conectada — integra a própria loja do zero pelo botão, que vai pelo público.
 *
 *   hoje ......... toda AUTORIZAÇÃO NOVA é pelo PÚBLICO, sempre.
 *                  O custom sobrevive só para ASSINAR as chamadas da conexão
 *                  que já está gravada com ele (a loja-sonda, autorizada em
 *                  10/08/2026, que serviu para medir o que a API entrega).
 *   morre quando . não houver nenhuma linha com `app = 'custom'`. Aí as três
 *                  variáveis do custom saem do Fly e **este arquivo morre
 *                  junto** — a condição é uma CONSULTA, não uma lembrança.
 *
 * ═══ POR QUE DUAS CONSTANTES, E NÃO UMA ═══
 *
 * Até 11/09 existia um `APP_PADRAO = "custom"` só, usado em dois lugares que
 * pareciam a mesma coisa e hoje são OPOSTOS:
 *
 *   (a) qual app AUTORIZA uma conexão nova ....... agora é `publico`;
 *   (b) como LER uma linha que não diz de qual app é ... continua `custom`.
 *
 * ⚠️ Trocar aquela constante única para `"publico"` — que é a leitura ingênua de
 * "o público é o único app" — quebraria a conexão já gravada em silêncio: ela
 * passaria a renovar o token com o par errado, e o sintoma só apareceria na
 * renovação seguinte. É a família da COLUNA QUE DOIS ESCRITORES TOCAM, na forma
 * de constante: um nome genérico guardando dois significados que coincidiam até
 * a véspera.
 *
 * Por isso não há mais "padrão": há o app da AUTORIZAÇÃO e o app da LINHA
 * ANTIGA, com nomes que não se confundem.
 *
 * Quem cobra a morte disto: `TODO.md` -> "TikTok: desligar o app custom", e a
 * guarda `tests/convivenciaDoTikTokTemPrazo`.
 */

/** Qual dos dois apps autorizou (ou vai autorizar) uma conexão. */
export type AppDoTikTok = "custom" | "publico";

/**
 * O app de toda AUTORIZAÇÃO NOVA. Não é "padrão": é o único.
 *
 * ⚠️ Não use isto para decidir com qual par ASSINAR uma chamada — para isso vale
 * o que está gravado na conexão (`workspace_tiktok_shops.app`). Uma conexão
 * antiga é do custom e continua sendo.
 */
export const APP_DA_AUTORIZACAO: AppDoTikTok = "publico";

/**
 * Como ler uma conexão que não diz de qual app é.
 *
 * ⚠️ Isto é FATO, não conveniência: toda linha gravada antes da migration 0033
 * é do custom, porque o custom era o único que existia quando ela nasceu. Ler
 * como `publico` quebraria o refresh dela no dia seguinte.
 */
export const APP_DE_LINHA_ANTIGA: AppDoTikTok = "custom";

export interface CredenciaisDoApp {
  key: string;
  secret: string;
  serviceId: string | undefined;
}

/**
 * As variáveis de cada app. O custom mantém os nomes de sempre — renomeá-los
 * seria churn que quebraria a conexão já gravada por nada, e ele vai sair.
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
 * Qual app atende um pedido de autorização — ou `null` quando NENHUM atende.
 *
 * ⚠️ `null` É RECUSA, E NÃO PODE VIRAR FALLBACK. Até 11/09/2026 esta função caía
 * no custom quando o público não estava configurado, e aquilo era o modo de
 * falha CERTO no modelo antigo: sem credencial do público, melhor nem oferecer.
 *
 * 📌 No modelo novo o mesmo fallback vira DEFEITO: conectaria um vendedor novo,
 * em silêncio, ao app que a gente está desligando. É a lição da recusa
 * temporária com o sinal trocado — não é uma salvaguarda que sobreviveu à razão
 * dela, é um fallback SEGURO que a mudança de modelo tornou INSEGURO, sem
 * ninguém ter tocado numa linha.
 *
 * Quem chama decide a forma da recusa (503 no painel, erro na tela do
 * callback), mas **ninguém pode substituir o `null` por um app**.
 */
export function appDaAutorizacao(
  publicoConfigurado = appPublicoConfigurado(),
): AppDoTikTok | null {
  return publicoConfigurado ? APP_DA_AUTORIZACAO : null;
}

/** Normaliza o que veio gravado numa conexão. Valor estranho = linha antiga. */
export function appDaConexao(valor: unknown): AppDoTikTok {
  return valor === "publico" ? "publico" : APP_DE_LINHA_ANTIGA;
}
