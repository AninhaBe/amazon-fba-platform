import { NextResponse } from "next/server";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Redireciona para a tela de autorização do TikTok Shop.
// A URL de autorização (com service_id) vem do Partner Center → TIKTOK_AUTH_URL.
export async function GET() {
  return withAuthenticatedWorkspace(async () => {
  const authUrl = process.env.TIKTOK_AUTH_URL;
  if (!authUrl) {
    return NextResponse.json(
      {
        error:
          "Configure TIKTOK_AUTH_URL (Authorization URL do app no TikTok Shop Partner Center).",
      },
      { status: 500 }
    );
  }
  return NextResponse.redirect(authUrl);
  });
}
