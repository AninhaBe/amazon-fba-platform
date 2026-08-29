import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Domínio canônico do produto. Servir o mesmo app em dois endereços não é só
// feio: a sessão vive em cookie POR DOMÍNIO, então quem loga em `nexo.fly.dev`
// e depois abre `nexoaihub.com.br` aparece deslogada — e o OAuth dos canais está
// cadastrado só no domínio próprio (ADR-015).
//
// O `.fly.dev` continua existindo porque o Fly precisa dele para health check e
// deploy; aqui ele apenas redireciona, preservando caminho e query.
const DOMINIO_CANONICO = process.env.CANONICAL_HOST || "nexoaihub.com.br";

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const ehFlyDev = host.endsWith(".fly.dev");
  // Os dois endpoints de saúde ficam de fora: eles batem no .fly.dev e
  // tratariam um 308 como falha. `/api/vivo` é o que o check do Fly usa
  // (liveness); `/api/health` é readiness e continua existindo para nós.
  const ehSaude =
    request.nextUrl.pathname === "/api/health" || request.nextUrl.pathname === "/api/vivo";
  if (ehFlyDev && !ehSaude && DOMINIO_CANONICO) {
    const destino = new URL(request.nextUrl.toString());
    destino.host = DOMINIO_CANONICO;
    destino.protocol = "https:";
    destino.port = "";
    return NextResponse.redirect(destino, 308);
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|brands/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
