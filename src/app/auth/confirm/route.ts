import { type EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Para onde mandar depois de trocar o token do e-mail por sessão. Confirmação de
// cadastro cai na home; recuperação de senha precisa cair na tela da senha nova.
// Só caminho relativo: `next` vem da URL, e aceitar "https://..." (ou "//host")
// transformaria esta rota em trampolim de phishing — o link sairia do domínio do
// NEXO, com a sessão recém-criada, para onde o atacante quisesse.
function destinoSeguro(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const destino = destinoSeguro(url.searchParams.get("next"));
  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(destino, url.origin));
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(destino, url.origin));
  }

  return NextResponse.redirect(new URL("/login?error=confirmation", url.origin));
}
