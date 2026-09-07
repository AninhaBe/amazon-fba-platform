// Quem é admin — política PURA, sem Next e sem Supabase, para poder ser testada.
//
// A ligação com a requisição vive em `admin.ts`; aqui fica só a regra, que é a
// parte que precisa de teste. Ver docs/adr/ADR-024-tela-de-administracao.md.
//
// Duas decisões embutidas:
//
// 1. A lista vem de VARIÁVEL DE AMBIENTE, não de tabela. Numa tabela, quem tem
//    acesso ao banco se promove a admin; na env, precisa de acesso ao deploy.
// 2. Falha FECHADA: sem `ADMIN_EMAILS` configurada, ninguém é admin. O
//    contrário — "sem lista, todo mundo entra" — é como um painel interno abre
//    por acidente de deploy.

/**
 * E-mails autorizados, normalizados. Vazio = ninguém entra.
 *
 * Exportada porque a tranca da assinatura usa ESTA MESMA lista para deixar as
 * contas de admin sempre entrarem (07/09/2026). Duplicar os e-mails, ou pior,
 * fixar `workspace_id` no código, criaria uma segunda allowlist que ninguém
 * revisa junto — e admin é a chave-mestra do produto.
 */
export function listaDeAdmins(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** `true` só quando o e-mail está na allowlist. Comparação exata, sem prefixo. */
export function ehAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return listaDeAdmins().has(email.trim().toLowerCase());
}
