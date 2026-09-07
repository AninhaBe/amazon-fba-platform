import { dbQuery } from "./db";
import { listaDeAdmins } from "./adminAllowlist";

/**
 * Os `workspace_id` das contas de admin, DERIVADOS da allowlist.
 *
 * ⚠️ POR QUE DERIVAR EM VEZ DE FIXAR. A ordem da dona em 07/09/2026 foi ancorar a
 * exceção "na MESMA fonte da allowlist de /admin (o secret), nunca em
 * workspace_id solto no código". Um id fixo aqui seria uma segunda allowlist:
 * quem trocasse `ADMIN_EMAILS` acharia que mudou quem tem chave-mestra, e não
 * teria mudado — e a divergência só apareceria no dia em que alguém fosse
 * trancado para fora do próprio produto.
 *
 * O `workspace_id` É o id do usuário no Supabase (ver `workspaceContext.ts`),
 * então a tradução é uma consulta, não uma tabela de mapeamento a manter.
 *
 * ⚠️ FALHA FECHADA, igual à allowlist: sem `ADMIN_EMAILS`, ninguém é admin. O
 * contrário abriria a chave-mestra por acidente de deploy.
 */
export async function idsDeAdmin(): Promise<string[]> {
  const emails = [...listaDeAdmins()];
  if (!emails.length) return [];
  const linhas = await dbQuery<{ id: string }>(
    `SELECT id::text AS id FROM auth.users WHERE lower(email) = ANY($1)`,
    [emails]
  ).catch(() => []);
  return linhas.map((l) => l.id);
}
