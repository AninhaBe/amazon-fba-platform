import { dbQuery, hasDb } from "../db";
import { descreverTrial, SETTING_KEY } from "../trial";
import type { EstadoAssinatura } from "./assinatura";
import { CHAVE_ASSINATURA } from "./runtime";
import { decidirAcesso, type DecisaoDeAcesso } from "./acesso";

/**
 * A VERDADE MORA NO SERVIDOR — e num lugar só.
 *
 * Este é o leitor que os DOIS portões usam: a navegação (`(app)/layout.tsx`) e
 * as rotas de dado (`withAuthenticatedWorkspace`). Dois portões com lógicas
 * próprias é a receita para divergirem — um libera o que o outro barra, e a
 * pessoa vê a tela abrir e o dado não vir, que foi exatamente o sintoma que
 * este trabalho veio consertar.
 */
export async function lerAcesso(workspaceId: string): Promise<DecisaoDeAcesso> {
  // Sem banco não há como saber, e "não sei" nunca pode virar "não pagou":
  // trancar por indisponibilidade nossa derrubaria contas em dia.
  if (!hasDb()) return { liberado: true, motivo: "sem-registro" };

  // ⚠️ UMA consulta, não duas. Assinatura e trial moram na MESMA tabela, e este
  // portão roda em toda requisição de dado das 68 rotas guardadas. Ler duas
  // vezes dobraria uma ida ao banco por requisição — e este projeto está com
  // alerta de orçamento de IO aberto no Supabase desde 05/09/2026. Do jeito
  // que está, o portão faz o MESMO número de consultas que fazia quando só
  // olhava o trial.
  const linhas = await dbQuery<{ key: string; value: unknown }>(
    `SELECT key, value FROM workspace_settings WHERE workspace_id = $1 AND key = ANY($2)`,
    [workspaceId, [CHAVE_ASSINATURA, SETTING_KEY]]
  ).catch(() => []);

  const assinatura = (linhas.find((l) => l.key === CHAVE_ASSINATURA)?.value as EstadoAssinatura | undefined) ?? null;
  const guardado = linhas.find((l) => l.key === SETTING_KEY)?.value as { startsAt: string; endsAt: string } | undefined;
  const trial = guardado?.endsAt ? descreverTrial(guardado) : null;

  return decidirAcesso({ assinatura, trial });
}
