import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { createClient, supabaseConfigured } from "./supabase/server";
import { chaveDaSessao, comRenovacaoUnica } from "./supabase/renovacaoUnica";
import { runWithWorkspace } from "./workspaceScope";
import { lerAcesso } from "./billing/acessoDoServidor";
import { textoDoBloqueio } from "./billing/acesso";
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
      // Bloqueio é reversível: mudar a assinatura ou a data no
      // workspace_settings devolve o acesso na hora. Nenhum dado é apagado.
      //
      // ⚠️ A DECISÃO NÃO MORA AQUI (07/09/2026). Ela mora em `billing/acesso.ts`,
      // e a navegação em `(app)/layout.tsx` chama a MESMA função. Dois portões
      // com regras próprias divergem, e o sintoma é a tela abrir e o dado não
      // vir — que foi o defeito que este trabalho veio consertar.
      const acesso = await lerAcesso(String(workspaceId)).catch(
        () => ({ liberado: true, motivo: "sem-registro" }) as const
      );
      if (!acesso.liberado) {
        const trial = await getTrial().catch(() => null);
        return NextResponse.json(
          {
            error: textoDoBloqueio(acesso.motivo),
            errorInfo: {
              // O código antigo continua saindo: é o que a interface já sabe
              // tratar. O `motivo` é o campo novo, que distingue cortada de
              // vencida — e é ele que a tela nova lê.
              code: "TRIAL_EXPIRED",
              motivo: acesso.motivo,
              retryable: false,
              endsAt: trial?.endsAt ?? null,
            },
          },
          { status: 403 }
        ) as T;
      }
    }
    return fn();
  });
}
