import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (codigo) => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// O DEFEITO QUE ESTE ARQUIVO REPROVA — pedido da Ana, 01/09/2026, verbatim:
// "https://nexoaihub.com.br/ essa url precisa cair na landing page por default".
//
// A raiz respondia REDIRECT para /login?next=/ para quem nao tem sessao: a pior
// primeira tela possivel para quem nunca viu o produto — um formulario pedindo
// credencial de uma conta que a pessoa ainda nao tem. E, para um buscador, a
// raiz nao tinha conteudo indexavel NENHUM: so um 307.
//
// ⚠️ ESTE E O TESTE QUE ALGUEM DESFAZ SEM PERCEBER ao mexer na lista de rotas
// publicas do proxy. E por isso ele casa a RAIZ na lista, e nao o tamanho dela.

// ⚠️ A PRIMEIRA VERSAO DESTA GUARDA PEDIA UMA IMPLEMENTACAO PERIGOSA.
//
// Eu tinha escrito "a raiz precisa estar em publicPaths". O backend recusou, e
// estava certo: `publicPaths` e avaliado com
// `publicPaths.some((path) => pathname.startsWith(path))` — com "/" na lista,
// TODA rota do app vira publica. /amazon, /configuracoes, /admin, tudo. Seria
// trocar "a primeira tela e um formulario de login" por "o produto inteiro esta
// aberto".
//
// A assercao abaixo passou a casar a ramificacao REAL (excecao para o caminho
// EXATO "/", antes do bloco de rota protegida) — e ganhou a linha que reprova a
// implementacao que eu mesma tinha pedido. Guarda que aceita a versao insegura
// de um conserto e pior que guarda nenhuma: ela CARIMBA a versao insegura.

test("a RAIZ serve a landing — visitante sem sessao nao cai no formulario de login", async () => {
  const proxy = await fonte("src/lib/supabase/proxy.ts");
  const codigo = semComentarios(proxy);

  // A excecao e para o caminho EXATO, e so para quem nao tem sessao.
  assert.match(
    codigo,
    /!authenticated && request\.nextUrl\.pathname === "\/"/,
    "a raiz voltou a cair no bloco de rota protegida",
  );

  // REWRITE, nao redirect: o endereco tem de continuar sendo a raiz, que e o
  // que ela divulga. `redirect` trocaria a barra por /landing e quebraria o
  // link do cartao.
  const ramo = codigo.slice(codigo.indexOf('!authenticated && request.nextUrl.pathname === "/"'));
  assert.match(ramo.slice(0, 300), /NextResponse\.rewrite/, "a raiz voltou a redirecionar em vez de servir");
  assert.ok(!/NextResponse\.redirect/.test(ramo.slice(0, 300)), "o endereco da raiz voltaria a mudar na barra");
});

test("⚠️ a raiz NAO pode entrar em publicPaths — seria abrir o app inteiro", async () => {
  // A assercao mais importante deste arquivo, e a que nasceu de um erro meu.
  // `startsWith("/")` casa com QUALQUER caminho.
  const proxy = await fonte("src/lib/supabase/proxy.ts");
  const lista = proxy.slice(proxy.indexOf("const publicPaths"), proxy.indexOf("];", proxy.indexOf("const publicPaths")));
  assert.ok(
    !/["']\/["']\s*[,\]]/.test(semComentarios(lista)),
    "a raiz entrou em publicPaths: com startsWith isso torna TODAS as rotas publicas",
  );
});

test("quem JA tem sessao continua indo para a Visao geral", async () => {
  // A outra metade do pedido, e a que protege o dia a dia dela: ela vive no
  // produto e nao pode atravessar pagina de marketing toda vez que abre.
  const proxy = await fonte("src/lib/supabase/proxy.ts");
  assert.match(
    semComentarios(proxy),
    /authenticated/,
    "o proxy deixou de distinguir quem tem sessao",
  );
});

test("o ?next= das rotas protegidas continua voltando para elas", async () => {
  // Tirar a raiz da protecao nao pode mexer no retorno das OUTRAS rotas: quem
  // for barrado em /monitor tem de voltar para /monitor depois do login, e nao
  // para a landing.
  const proxy = await fonte("src/lib/supabase/proxy.ts");
  assert.match(
    semComentarios(proxy),
    /searchParams\.set\("next", request\.nextUrl\.pathname\)/,
    "o retorno para a rota barrada foi embora",
  );
});

test("a casca autenticada NAO aparece para quem nao tem sessao", async () => {
  // ⚠️ Com REWRITE o pathname continua sendo "/", entao a lista de caminhos
  // publicos NAO casa — e a landing renderizaria dentro da moldura, com sidebar
  // e seletor de conta, para um visitante que nunca logou.
  const shell = await fonte("src/app/components/AppShell.tsx");
  assert.match(shell, /if \(\s*semSessao \|\|/, "a casca voltou a decidir so por endereco");
  assert.match(shell, /function usarSemSessao\(\): boolean \{/);
  // A decisao le o COOKIE — nao faz chamada de auth por pagina (postmortem do
  // pool esgotado, 29/08/2026).
  const codigo = semComentarios(shell);
  assert.match(codigo, /sb-\[\^=\]\*-auth-token/, "a deteccao de sessao mudou de fonte");
  assert.ok(!/getUser\(\)|getClaims\(\)/.test(codigo), "a casca passou a chamar auth por pagina");
});

test("o canonico das duas rotas da landing aponta para a RAIZ", async () => {
  // O mesmo conteudo responde em "/" e em "/landing". Quem acumula reputacao
  // tem de ser a raiz — e o endereco que ela divulga.
  for (const tela of ["src/app/landing/page.tsx", "src/app/landing-v2/page.tsx"]) {
    assert.match(
      await fonte(tela),
      /alternates: \{ canonical: "\/" \}/,
      `${tela}: o canonico deixou de apontar para a raiz`,
    );
  }
});

test("a landing NAO foi redesenhada — as duas rotas seguem a mesma peca", async () => {
  // O pedido era de roteamento. Acrescimo nao e redesenho.
  for (const tela of ["src/app/landing/page.tsx", "src/app/landing-v2/page.tsx"]) {
    assert.match(await fonte(tela), /return <LandingV2Experience \/>;/, `${tela}: a landing mudou de conteudo`);
  }
});

test("a casca NAO e renderizada no SERVIDOR para a raiz", async () => {
  // ⚠️ O DEFEITO QUE ESTA GUARDA REPROVA — medido no HTML servido em
  // 01/09/2026, DEPOIS de o rewrite subir:
  //
  //   curl na raiz, sem cookie -> 6.663 bytes de <aside class="nexo-sidebar">
  //   no markup, com o nome e a descricao de cada aba do produto ("Publicidade
  //   nos 4 canais", "Contas e canais"), para um visitante anonimo. Mais o
  //   flash: a casca vinha no HTML e so saia depois da hidratacao.
  //
  // A causa foi uma decisao minha: `usarSemSessao()` devolve `false` no
  // servidor, e eu escolhi isso pensando nas telas autenticadas — nao na raiz
  // reescrita, onde o pathname continua sendo "/" e nenhuma lista casa.
  //
  // ⚠️ A LICAO: defesa que so existe de um lado da fronteira NAO E DEFESA. A
  // regra de sessao valia no cliente e nao existia no servidor.
  const shell = await fonte("src/app/components/AppShell.tsx");
  assert.match(
    shell,
    /function cascaIndecidivelNoServidor\(pathname: string\): boolean \{\s*return typeof document === "undefined" && pathname === "\/";/,
    "a raiz voltou a renderizar a casca no servidor",
  );
  assert.match(shell, /cascaIndecidivelNoServidor\(pathname\) \|\|/, "a guarda existe mas nao esta ligada");
});
