import { redirect } from "next/navigation";
import { AppShell } from "../components/AppShell";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";
import { lerAcesso } from "@/lib/billing/acessoDoServidor";

/**
 * A CASCA MORA AQUI — no route group das telas autenticadas, e não no layout
 * raiz.
 *
 * ⚠️ POR QUE ELA SAIU DA RAIZ (01/09/2026): enquanto o `AppShell` era do layout
 * raiz, TODA rota nascia envolvida por ele e cada tela pública precisava se
 * desinscrever — por lista de caminhos, e depois por sessão, porque a lista não
 * cobria a raiz reescrita. Uma defesa por enumeração protege o que alguém
 * lembrou de escrever; a rota pública seguinte nasce desprotegida.
 *
 * Medido antes: 6.663 bytes de `<aside class="nexo-sidebar">` no HTML servido a
 * um visitante anônimo — 42% do markup do body, com o nome de cada aba do
 * produto (`docs/achado-medir-html-servido.md`).
 *
 * Com o grupo, a inclusão é que passa a ser explícita: quem quiser a casca
 * entra em `(app)/`. A landing não pode ser envolvida por engano, por rewrite,
 * por rota nova nem por esquecimento de lista.
 *
 * ⚠️ O PARÊNTESES NÃO ENTRA NA URL. `(app)` é route group: `(app)/amazon/page.tsx`
 * continua servindo `/amazon`. Foi conferido rota a rota — URL quebrada em
 * produção é pior que o flash que este movimento apaga.
 *
 * ⚠️ E LAYOUT ANINHADO COMPÕE COM O RAIZ, não o substitui: o `<html>`, o
 * `<body>`, a fonte e o link de pular para o conteúdo continuam no layout raiz,
 * para todo mundo. Aqui entra só a moldura.
 */
/**
 * ⚠️ E A TRANCA MORA AQUI TAMBÉM (07/09/2026), pelo mesmo motivo que a casca:
 * este é o ponto por onde TODA tela autenticada passa e por onde NENHUMA tela
 * pública passa. Uma lista de caminhos protegeria o que alguém lembrou de
 * escrever — a tela seguinte nasceria destrancada.
 *
 * A decisão não é tomada aqui: vem de `billing/acesso.ts`, a mesma função que
 * `withAuthenticatedWorkspace` usa nas rotas de dado. Antes disto, conta cortada
 * recebia 403 no dado mas a navegação abria: a pessoa via o produto inteiro
 * cheio de erro em vez de ser levada à reativação.
 *
 * ⚠️ SEM SESSÃO NÃO REDIRECIONA AQUI. Cada página já manda para o `/login` com
 * o seu próprio `next=`; assumir isso aqui apagaria o destino de volta.
 */
export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (supabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const workspaceId = data?.claims?.sub;
    if (workspaceId) {
      const acesso = await lerAcesso(String(workspaceId));
      if (!acesso.liberado) redirect(`/reativar?motivo=${acesso.motivo}`);
    }
  }
  return <AppShell>{children}</AppShell>;
}
