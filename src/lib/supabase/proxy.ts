import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const publicPaths = [
  "/login",
  // Landing: é a porta de entrada; exigir sessão para vê-la não faria sentido.
  "/landing",
  "/privacidade",
  // Termos de uso: documento legal que auditor SEM CONTA precisa alcançar —
  // GET /termos devolvendo 307 para o login foi a causa exata da reprovação
  // da AbacatePay em 22/09/2026.
  "/termos",
  // Quem esqueceu a senha não tem sessão para provar quem é — pedir login para
  // recuperar o login seria o laço fechado que tranca a pessoa do lado de fora.
  // `/nova-senha` NÃO entra aqui de propósito: lá a sessão já existe, criada por
  // `/auth/confirm` a partir do token do e-mail.
  "/recuperar-senha",
  "/auth/confirm",
  "/api/health",
  // Liveness do Fly. Precisa responder sem sessão — check que leva 401 marca a
  // máquina como critical, que é exatamente o apagão que ele deveria evitar.
  "/api/vivo",
  // Todos os endpoints de cron: já se protegem com CRON_SECRET, então ficam
  // fora do login (o proxy do Supabase os barraria antes de checar o segredo).
  "/api/cron/",
  "/api/webhooks/mercado-livre",
  // Idem: a Stripe assina cada evento com HMAC-SHA256 (STRIPE_WEBHOOK_SECRET) e
  // a rota recusa 400 sem assinatura válida. Exigir sessão aqui só derrubaria a
  // entrega — quem chama é a Stripe, que nunca terá cookie de login.
  "/api/webhooks/stripe",
  // Push da Shopee: quem chama e a Shopee, que nunca tera cookie. A rota se
  // protege sozinha — HMAC-SHA256 com a chave PROPRIA do push, conferido em
  // tempo constante ANTES de qualquer leitura, e sem a chave configurada ela
  // rejeita tudo. Ver a nota longa em shopeePush.ts.
  "/api/webhooks/shopee",

  // Formulario de orcamento da landing: quem preenche NAO tem sessao — e a
  // pessoa ainda nem e cliente. Exigir login aqui devolveria 401 e o formulario
  // mostraria "nao foi possivel enviar" para todo mundo, sempre.
  //
  // ⚠️ Publica NAO quer dizer desprotegida: a propria rota valida formato e
  // tamanho, reduz os campos de escolha ao vocabulario conhecido e aplica teto
  // por IP e teto global antes de disparar qualquer e-mail. Ver a nota longa la.
  "/api/contato/orcamento",
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

  // ⚠️ AQUI HAVIA UM ATALHO QUE RESPONDIA /api/health SEM CHEGAR NA ROTA.
  //
  // Ele devolvia `{ ok: true, version }` direto do middleware — ou seja, nem a
  // rota nem o banco eram tocados. No incidente de 29/08/2026 (02:10-02:17Z) o
  // app passou 7 minutos sem conseguir NENHUMA conexao, com `ECHECKOUTTIMEOUT`
  // FATAL no log e toda tela com dado quebrada, e este atalho respondeu 200 o
  // tempo todo. Duas pessoas leram esse verde como "o app esta de pe".
  //
  // O atalho saiu para que `/api/health` chegue na rota, que consulta o banco e
  // devolve 503 quando ele nao responde. `/api/health` continua em `publicPaths`,
  // entao segue sem exigir autenticacao — o que o atalho economizava era a
  // execucao da rota, e era exatamente isso que escondia o defeito.
  //
  // Ver `docs/postmortem-2026-08-29-pool-esgotado.md`.

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

  // ═══ A RAIZ SERVE A LANDING PARA QUEM NÃO TEM SESSÃO ══════════════════════
  //
  // Pedido dela (01/09/2026): *"https://nexoaihub.com.br/ essa url precisa cair
  // na landing page por default"*. Até aqui, visitante sem sessão em `/` caía em
  // `/login?next=/` — a primeira tela de quem nunca viu o produto era um
  // formulário de login.
  //
  // ⚠️ REWRITE, NÃO REDIRECT, e a diferença é o pedido dela ao pé da letra: o
  // endereço tem de continuar sendo a raiz, que é o que ela divulga. `redirect`
  // trocaria a barra de endereços por `/landing` e quebraria o link divulgado.
  //
  // ⚠️ E A RAIZ NÃO ENTRA EM `publicPaths`, de propósito. `publicPaths` usa
  // `startsWith`, então `"/"` casaria com TODA rota do app e abriria o produto
  // inteiro. É por isso que esta regra é uma exceção explícita para o caminho
  // exato `"/"`, e não uma entrada na lista.
  //
  // Quem ESTÁ logado em `/` continua indo para a Visão geral — ela vive no
  // produto e não pode atravessar marketing toda vez que abre. Esta é a regra
  // espelhada da que já manda quem está logado em `/login` de volta para `/`.
  if (!authenticated && request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/landing";
    return NextResponse.rewrite(url);
  }

  if (!authenticated && !isPublic) {
    if (isApi) {
      return NextResponse.json({ error: "Faça login para continuar." }, { status: 401 });
    }
    // ⚠️ O `?next=` continua sendo escrito para TODA rota protegida. A exceção
    // acima é só para `"/"`, que nem chega aqui — as demais seguem voltando para
    // a rota original depois do login.
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
