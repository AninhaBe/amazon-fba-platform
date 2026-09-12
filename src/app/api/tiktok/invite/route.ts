import { NextResponse } from "next/server";
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
export async function GET() {
  return withAuthenticatedWorkspace(async () => {
    try {
      // ⚠️ O PARAMETRO `?app=` MORREU em 11/09/2026, e nao por limpeza: com o
      // publico sendo o unico app de autorizacao, deixar o chamador ESCOLHER
      // seria a mesma porta que o botao acabou de fechar. O convite vai pelo
      // publico, como tudo que autoriza daqui para frente.
      const app = appDaAutorizacao();
      if (!app) {
        return NextResponse.json(
          { error: "A conexão com a TikTok Shop está indisponível no momento." },
          { status: 503 }
        );
      }
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
