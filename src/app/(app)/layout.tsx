import { AppShell } from "../components/AppShell";

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
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
