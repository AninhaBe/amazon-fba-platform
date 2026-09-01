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

// ⚠️ `todo` ENQUANTO A METADE DO BACKEND NAO CHEGA — e nao porque e opcional.
//
// Tirar "/" da protecao e servir a landing mora em src/lib/supabase/proxy.ts,
// que e do backend (docs/donos-da-arvore.md:33). Este teste ja descreve o
// contrato acordado; ele fica VERMELHO de proposito ate a regra existir, e
// `todo` e o unico jeito de registrar isso sem travar o portao de todo mundo.
//
// QUANDO O BACKEND ENTREGAR: tire o `{ todo: ... }` e o teste passa a valer como
// qualquer outro. Se alguem tirar a raiz da lista depois disso, ele fica
// vermelho — que e o motivo de ele existir.
test("a RAIZ e publica — visitante sem sessao nao cai no formulario de login", { todo: "aguardando a regra no proxy (backend)" }, async () => {
  const proxy = await fonte("src/lib/supabase/proxy.ts");
  const codigo = semComentarios(proxy);
  // A raiz precisa estar entre os caminhos publicos. Sem isso, o `!isPublic`
  // manda para /login?next=/ e o pedido dela volta a nao valer.
  assert.match(
    codigo,
    /publicPaths[\s\S]{0,600}["']\/["']/,
    "a raiz saiu da lista publica — o visitante voltou a cair no login",
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
