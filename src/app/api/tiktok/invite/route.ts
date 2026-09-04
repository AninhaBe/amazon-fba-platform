import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { tiktokAuthorizationUrl } from "@/lib/tiktok";
import { appDaAutorizacao } from "@/lib/integrations/tiktokApps";
import { criarConviteTiktok } from "@/lib/tiktokInvite";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { currentWorkspaceId } from "@/lib/workspaceScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Link privado para o vendedor autorizar a loja dele sem ter conta aqui.
// Só quem está logado gera o link — é a sessão que define o workspace de destino,
// e a assinatura do state impede que ele seja apontado para outro.
export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    try {
      // ⚠️ `?app=publico` existe para a REVISAO FUNCIONAL do app publico, e cai
      // no custom sozinho se as tres variaveis do publico nao estiverem no
      // ambiente. Ele morre com a convivencia — ver `tiktokApps.ts`.
      const app = appDaAutorizacao(new URL(req.url).searchParams.get("app"));
      const state = criarConviteTiktok(currentWorkspaceId(), undefined, app);
      const convite = validade(state);
      return NextResponse.json({
        app,
        url: tiktokAuthorizationUrl(state, app),
        expiraEm: convite,
        instrucao:
          "Envie este link ao vendedor. Ele autoriza a loja na TikTok e a conexão " +
          "aparece aqui — não é preciso criar conta no NEXO.",
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "TikTok Shop ainda não configurado." },
        { status: 500 }
      );
    }
  });
}

/** Só para informar a data na resposta; o prazo real vive dentro do state assinado. */
function validade(state: string): string | undefined {
  try {
    const corpo = JSON.parse(Buffer.from(state.split(".")[1], "base64url").toString("utf8"));
    return new Date(corpo.exp * 1000).toISOString();
  } catch {
    return undefined;
  }
}
