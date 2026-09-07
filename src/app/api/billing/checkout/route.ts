import { NextResponse } from "next/server";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { currentWorkspaceId } from "@/lib/workspaceScope";
import { checkoutConfigurado, criarSessaoDeCheckout } from "@/lib/billing/checkoutStripe";
import { createClient } from "@/lib/supabase/server";

/**
 * Cria a sessão de pagamento e devolve para onde a pessoa vai.
 *
 * ⚠️ `allowExpiredTrial: true` NÃO É FROUXIDÃO — é a única exceção que a tranca
 * exige para funcionar. Quem está cortado é exatamente quem precisa pagar; se
 * esta rota fosse barrada junto com as outras, a pessoa ficaria trancada do
 * lado de fora sem porta para voltar, e a tranca viraria uma prisão.
 *
 * A sessão continua nascendo dentro do workspace autenticado: o `workspaceId`
 * vem de `claims.sub`, nunca do corpo da requisição.
 */
export async function POST(request: Request) {
  return withAuthenticatedWorkspace(
    async () => {
      if (!checkoutConfigurado()) {
        return NextResponse.json(
          { error: "Pagamento ainda não está configurado nesta instalação." },
          { status: 503 }
        );
      }
      const workspaceId = currentWorkspaceId();
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      const email = data.user?.email ?? null;

      const base = process.env.APP_BASE_URL || new URL(request.url).origin;
      try {
        const sessao = await criarSessaoDeCheckout({ email, workspaceId, baseUrl: base });
        return NextResponse.json({ url: sessao.url });
      } catch (motivo) {
        console.error("[billing] falha ao criar sessão de checkout:", motivo);
        return NextResponse.json(
          { error: "Não foi possível abrir o pagamento agora. Tente de novo em instantes." },
          { status: 502 }
        );
      }
    },
    { allowExpiredTrial: true }
  );
}
