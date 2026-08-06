import { NextResponse } from "next/server";
import { createClient, supabaseConfigured } from "./supabase/server";
import { runWithWorkspace } from "./workspaceScope";
import { getTrial } from "./trial";

export interface WorkspaceGuardOptions {
  /**
   * Deixa passar mesmo com o período de avaliação vencido. Só para rotas que
   * PRECISAM responder nesse estado — a que informa o próprio trial e o logout.
   */
  allowExpiredTrial?: boolean;
}

export async function withAuthenticatedWorkspace<T>(
  fn: () => Promise<T>,
  options: WorkspaceGuardOptions = {}
): Promise<T | NextResponse> {
  if (!supabaseConfigured()) {
    return NextResponse.json(
      { error: "Autenticação ainda não configurada no servidor." },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const workspaceId = data?.claims?.sub;
  if (error || !workspaceId) {
    return NextResponse.json({ error: "Faça login para continuar." }, { status: 401 });
  }

  return runWithWorkspace(String(workspaceId), async () => {
    if (!options.allowExpiredTrial) {
      // Bloqueio é reversível: estender a data no workspace_settings devolve o
      // acesso na hora. Nenhum dado é apagado aqui.
      const trial = await getTrial().catch(() => null);
      if (trial?.expired) {
        return NextResponse.json(
          {
            error: "O período de avaliação desta conta terminou.",
            errorInfo: { code: "TRIAL_EXPIRED", retryable: false, endsAt: trial.endsAt },
          },
          { status: 403 }
        ) as T;
      }
    }
    return fn();
  });
}
