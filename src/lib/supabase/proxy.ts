import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const publicPaths = [
  "/login",
  // Landing: é a porta de entrada; exigir sessão para vê-la não faria sentido.
  "/landing",
  "/privacidade",
  // Quem esqueceu a senha não tem sessão para provar quem é — pedir login para
  // recuperar o login seria o laço fechado que tranca a pessoa do lado de fora.
  // `/nova-senha` NÃO entra aqui de propósito: lá a sessão já existe, criada por
  // `/auth/confirm` a partir do token do e-mail.
  "/recuperar-senha",
  "/auth/confirm",
  "/api/health",
  // Todos os endpoints de cron: já se protegem com CRON_SECRET, então ficam
  // fora do login (o proxy do Supabase os barraria antes de checar o segredo).
  "/api/cron/",
  "/api/webhooks/mercado-livre",
  // Idem: a Stripe assina cada evento com HMAC-SHA256 (STRIPE_WEBHOOK_SECRET) e
  // a rota recusa 400 sem assinatura válida. Exigir sessão aqui só derrubaria a
  // entrega — quem chama é a Stripe, que nunca terá cookie de login.
  "/api/webhooks/stripe",
];

export async function updateSession(request: NextRequest) {
  const configured = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
  // Laboratório de protótipos (`/lab`): liberado SÓ em desenvolvimento. Não tem
  // dado nem API atrás dele, mas em produção seria superfície pública sem
  // motivo — e a regra da casa é não deixar nada aberto por conveniência.
  const isLab =
    process.env.NODE_ENV !== "production" && request.nextUrl.pathname.startsWith("/lab");
  const isPublic =
    isLab || publicPaths.some((path) => request.nextUrl.pathname.startsWith(path));
  const isApi = request.nextUrl.pathname.startsWith("/api/");

  if (isPublic && request.nextUrl.pathname === "/api/health") {
    const commit = process.env.RENDER_GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA;
    return NextResponse.json({ ok: true, version: commit?.slice(0, 7) || "local" });
  }

  if (!configured) {
    if (isApi) {
      return NextResponse.json(
        { error: "Autenticação ainda não configurada no servidor." },
        { status: 503 }
      );
    }
    if (!isPublic) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("setup", "1");
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value)
          );
        },
      },
    }
  );

  const { data } = await supabase.auth.getClaims();
  const authenticated = !!data?.claims?.sub;

  if (!authenticated && !isPublic) {
    if (isApi) {
      return NextResponse.json({ error: "Faça login para continuar." }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  if (authenticated && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
