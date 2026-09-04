/**
 * ISENÇÃO DE TARIFA DA AMAZON — por CONTA e com VIGÊNCIA.
 *
 * ⚠️ POR QUE NÃO É CONSTANTE, e a razão não é elegância: a conta da dona do
 * produto está isenta da tarifa de indicação por uma promoção desde 01/08/2026.
 * Um `if` global aplicando essa isenção acertaria a conta dela e **zeraria a
 * tarifa de todo cliente futuro que paga cheio** — silenciosamente, porque
 * tarifa a menos vira lucro a mais, e lucro a mais ninguém questiona.
 *
 * 📌 É a mesma família dos scripts de cura com `workspace_id` fixo (AGENTS.md):
 * o dado de UMA conta virando regra do produto. Aqui o estrago é pior, porque
 * não é um script que roda uma vez — é uma conta que fica errada para sempre.
 *
 * ⚠️ E A VIGÊNCIA É PELA DATA DO PEDIDO, nunca por "hoje". Um pedido de julho,
 * anterior à promoção, PAGOU tarifa; um de agosto, não. Aplicar a isenção de
 * hoje ao histórico reescreveria o passado e faria a margem de julho subir
 * sozinha — um número que nunca existiu.
 */

/** Uma janela de isenção. `ate: null` = ainda vigente, sem fim conhecido. */
export interface JanelaDeIsencao {
  /** Vocabulário canônico: qual tarifa deixa de ser cobrada. */
  feeType: "commission" | "fulfillment";
  /** Início da vigência, dia-calendário (YYYY-MM-DD). */
  de: string;
  /** Fim inclusivo, ou `null` enquanto durar. */
  ate: string | null;
  /** Por que existe — vai para a tela explicar o zero. */
  motivo: string;
}

/** A chave em `workspace_settings`. Uma linha por workspace, conexões dentro. */
export const CHAVE_DE_ISENCAO = "amazon_isencao_tarifa";

/**
 * O documento guardado: isenções POR CONEXÃO.
 *
 * Fica em `workspace_settings` porque ela já é por workspace e consultável —
 * nada de constante no código, nada de coluna nova. Um cliente novo entra
 * escrevendo uma linha, sem deploy.
 */
export interface DocumentoDeIsencao {
  [connectionId: string]: JanelaDeIsencao[];
}

/**
 * A isenção vale para esta tarifa, nesta data?
 *
 * Pura e sem banco — é o que torna a fronteira de vigência testável dos dois
 * lados sem precisar de Postgres.
 */
export function isentoEm(
  janelas: JanelaDeIsencao[] | undefined,
  feeType: string,
  dataDoPedidoISO: string | Date | null | undefined,
): JanelaDeIsencao | null {
  if (!janelas?.length || !dataDoPedidoISO) return null;
  // Dia-calendário de São Paulo: a vigência é anunciada em data, não em
  // instante, e comparar timestamps UTC jogaria o pedido das 22h do dia 31 para
  // o dia seguinte.
  const data = typeof dataDoPedidoISO === "string" ? dataDoPedidoISO : dataDoPedidoISO.toISOString();
  const dia = new Date(new Date(data).getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
  return janelas.find((j) =>
    j.feeType === feeType && dia >= j.de && (j.ate == null || dia <= j.ate)) ?? null;
}

/** Lê as isenções do workspace corrente. Ausência = ninguém isento. */
export async function lerIsencoes(connectionId: string): Promise<JanelaDeIsencao[]> {
  const { dbQuery } = await import("../db");
  const { currentWorkspaceId } = await import("../workspaceScope");
  const linhas = await dbQuery<{ value: unknown }>(
    `SELECT value FROM workspace_settings WHERE workspace_id = $1 AND key = $2`,
    [currentWorkspaceId(), CHAVE_DE_ISENCAO],
  );
  const doc = linhas[0]?.value as DocumentoDeIsencao | undefined;
  const janelas = doc?.[connectionId];
  return Array.isArray(janelas) ? janelas : [];
}
