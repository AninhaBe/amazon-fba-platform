import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { createClient, supabaseConfigured } from "./supabase/server";
import { chaveDaSessao, comRenovacaoUnica } from "./supabase/renovacaoUnica";
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
  // ⚠️ UMA renovação de sessão em voo por vez, ENTRE requisições.
  //
  // `getClaims()` renova o token quando ele venceu. Uma carga de tela dispara
  // muitas requisições, todas veem o token vencido ao mesmo tempo e todas
  // tentavam renovar o MESMO refresh token — que é de uso único e rotativo. A
  // primeira rotacionava, as outras chegavam com token morto, e a sessão da
  // dona morria no meio (29/08/2026: 409 oito vezes em seis segundos).
  //
  // Ver `supabase/renovacaoUnica.ts` — mesmo padrão que a Shopee já usa.
  const chave = chaveDaSessao((await cookies()).getAll());
  const { data, error } = await comRenovacaoUnica(chave, () => supabase.auth.getClaims());
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
