import { dbQuery, hasDb } from "../db";
import { ehAdmin } from "../adminAllowlist";
import type { EstadoAssinatura } from "./assinatura";
import { CHAVE_ASSINATURA } from "./runtime";
import { decidirAcesso, type DecisaoDeAcesso } from "./acesso";

/**
 * A VERDADE MORA NO SERVIDOR — e num lugar só.
 *
 * Este é o leitor que os DOIS portões usam: a navegação (`(app)/layout.tsx`) e
 * as rotas de dado (`withAuthenticatedWorkspace`). Dois portões com lógicas
 * próprias é a receita para divergirem — um libera o que o outro barra, e a
 * pessoa vê a tela abrir e o dado não vir.
 */
export async function lerAcesso(workspaceId: string): Promise<DecisaoDeAcesso> {
  // Sem banco não há como saber, e "não sei" nunca pode virar "não pagou":
  // trancar por indisponibilidade nossa derrubaria contas em dia.
  //
  // ⚠️ Esta é a ÚNICA porta aberta por ausência, e ela é sobre o NOSSO estado,
  // não sobre o da conta. Desde 07/09/2026 ausência de registro da CONTA
  // bloqueia.
  if (!hasDb()) return { liberado: true, motivo: "sem-banco" };

  // ⚠️ UMA consulta, e ela devolve SEMPRE uma linha — inclusive para conta sem
  // nenhum registro, que é justamente o caso do admin. Uma versão anterior
  // buscava as linhas de `workspace_settings` e lia o e-mail junto: conta de
  // admin não tem linha nenhuma, então voltavam zero linhas e o e-mail nunca
  // era lido. A chave-mestra teria nascido quebrada.
  //
  // ⚠️ UMA consulta, e ela devolve SEMPRE uma linha — inclusive para conta sem
  // nenhum registro, que é justamente o caso do admin. Uma versão anterior
  // buscava as linhas de `workspace_settings` e lia o e-mail junto: conta de
  // admin não tem linha nenhuma, então voltavam zero linhas e o e-mail nunca
  // era lido. A chave-mestra teria nascido quebrada.
  //
  // Este portão roda em toda requisição de dado das 68 rotas guardadas, e o
  // projeto está com alerta de orçamento de IO aberto no Supabase — por isso os
  // dois sinais saem de uma ida só ao banco.
  //
  // ⚠️ O TRIAL NÃO É LIDO AQUI desde o modelo v3 (07/09/2026). Não há período de
  // avaliação: quem experimenta paga e tem 7 dias de garantia. A linha de trial
  // pode continuar existindo no banco e não concede nada.
  const [linha] = await dbQuery<{
    email: string | null;
    assinatura: EstadoAssinatura | null;
  }>(
    `SELECT (SELECT lower(email) FROM auth.users WHERE id::text = $1) AS email,
            (SELECT value FROM workspace_settings WHERE workspace_id = $1 AND key = $2) AS assinatura`,
    [workspaceId, CHAVE_ASSINATURA]
  ).catch(() => []);

  return decidirAcesso({
    admin: ehAdmin(linha?.email ?? null),
    assinatura: linha?.assinatura ?? null,
  });
}
