import { NextResponse } from "next/server";
import { createClient, supabaseConfigured } from "./supabase/server";
import { ehAdmin } from "./adminAllowlist";

export { ehAdmin };

// Portão da tela de administração — a ÚNICA parte do produto que lê entre
// workspaces. Ver docs/adr/ADR-024-tela-de-administracao.md.
//
// Três decisões que este arquivo implementa, e que não são detalhe:
//
// 1. A lista vive em VARIÁVEL DE AMBIENTE, não em tabela. Numa tabela, quem tem
//    acesso ao banco se promove a admin; na env, precisa de acesso ao deploy.
// 2. A conferência é NO SERVIDOR, a cada requisição. Esconder o link não é
//    controle de acesso.
// 3. Quem não está na lista recebe 404, não 403 — 403 confirma que a tela
//    existe. Para quem não é admin, ela não existe.

/** Resposta para quem não é admin: a rota simplesmente não existe. */
export function naoEncontrado(): NextResponse {
  return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
}

/**
 * Envolve um handler de `/api/admin/*`.
 *
 * NÃO usa `withAuthenticatedWorkspace`: aquele fixa o escopo no workspace de
 * quem chamou, e é exatamente o que estas consultas precisam atravessar. Aqui a
 * autenticação é feita à mão e o escopo fica deliberadamente ausente.
 */
export async function comAdmin<T>(fn: () => Promise<T>): Promise<T | NextResponse> {
  if (!supabaseConfigured()) return naoEncontrado();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const email = (data?.claims as { email?: string } | undefined)?.email;
  if (error || !ehAdmin(email)) return naoEncontrado();
  return fn();
}
