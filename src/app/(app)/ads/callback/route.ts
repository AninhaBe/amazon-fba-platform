import { NextRequest, NextResponse } from "next/server";
import {
  exchangeAdsCode,
  adsAccessToken,
  listAdsProfiles,
  saveAdsCredentials,
} from "@/lib/integrations/amazonAdsAuth";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ⚠️ O caminho desta rota é `/ads/callback`, NÃO `/api/...`, porque é esse o valor
// registrado em "Allowed Return URLs" no perfil de segurança da Amazon
// (developer.amazon.com → `SellerCore Ads` → Web Settings). ⚠️ `SellerCore Ads` e o
// NOME CADASTRADO do perfil LWA no console da Amazon, nao o nome do produto: e o
// que aparece na tela de la, entao renomear aqui so faria a instrucao nao achar.
// Mudar o caminho aqui
// exige mudar lá antes, senão a Amazon recusa o redirecionamento.
//
// Registrado em 21/08/2026 apontando para nexoaihub.com.br — antes apontava para
// sellercore.onrender.com, que morreu na migração e devolvia 503.

export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    const { searchParams, origin } = new URL(req.url);
    const uiBaseUrl = process.env.APP_UI_BASE_URL || process.env.APP_BASE_URL || origin;
    const fail = (mensagem: string) =>
      NextResponse.redirect(`${uiBaseUrl}/integracoes?error=${encodeURIComponent(mensagem)}`);

    // A Amazon devolve `error` quando a vendedora recusa o consentimento.
    const erro = searchParams.get("error");
    if (erro) return fail(`Autorização da Amazon Ads recusada (${erro}).`);

    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const esperado = req.cookies.get("ads_oauth_state")?.value;
    if (!state || !esperado || state !== esperado) {
      return fail("Falha na verificação de segurança da Amazon Ads.");
    }
    if (!code) return fail("Autorização da Amazon Ads incompleta.");

    try {
      const token = await exchangeAdsCode(code);
      const agora = new Date().toISOString();

      // O perfil só é descoberto DEPOIS do consentimento — é ele que diz em qual
      // marketplace a conta de publicidade vive. Com uma conta só, escolher o
      // primeiro do Brasil é o comportamento certo; com mais de um, guardamos
      // nulo e a escolha vira decisão explícita, em vez de chute silencioso.
      let profileId: string | null = null;
      try {
        const perfis = await listAdsProfiles(await adsAccessToken(token.refresh_token));
        const brasileiros = perfis.filter((p) => p.countryCode === "BR");
        if (brasileiros.length === 1) profileId = String(brasileiros[0].profileId);
      } catch (error) {
        // Falhar aqui não pode perder o refresh token recém-obtido: reconquistá-lo
        // exige novo consentimento da vendedora.
        console.error("[ads/callback] listagem de perfis falhou; token preservado", error);
      }

      await saveAdsCredentials({
        refreshToken: token.refresh_token,
        profileId,
        connectedAt: agora,
        updatedAt: agora,
      });

      const res = NextResponse.redirect(
        `${uiBaseUrl}/integracoes?ads=${profileId ? "conectado" : "conectado-sem-perfil"}`,
      );
      res.cookies.delete("ads_oauth_state");
      return res;
    } catch (error) {
      console.error("[ads/callback] falha na troca de código", error);
      return fail("Não foi possível concluir a conexão com a Amazon Ads.");
    }
  });
}
