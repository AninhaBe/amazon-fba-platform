import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (codigo) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// ═══ A RAIZ SERVE A LANDING PARA VISITANTE — metade do backend ══════════════
//
// Pedido da Ana, 01/09/2026, verbatim: "https://nexoaihub.com.br/ essa url
// precisa cair na landing page por default". Antes, visitante sem sessao em "/"
// caia em /login?next=/ — a primeira tela de quem nunca viu o produto era um
// formulario pedindo credencial de uma conta que a pessoa ainda nao tem.
//
// ⚠️ E A REGRA NAO PODE SER "POR A RAIZ EM publicPaths". Este arquivo existe em
// boa parte para registrar isso: `publicPaths` e avaliado com `startsWith`, e
// "/" e prefixo de TODA rota do app. Uma entrada "/" ali abriria /amazon,
// /configuracoes, /admin e o resto para qualquer visitante — trocaria a primeira
// tela ruim por um vazamento do produto inteiro.
//
// A regra certa e uma excecao para o caminho EXATO "/", com REWRITE.

test("visitante sem sessao recebe a landing NA RAIZ, por rewrite", async () => {
  const codigo = semComentarios(await fonte("src/lib/supabase/proxy.ts"));
  // Ramificacao, nao identificador: tem de existir um caminho que so roda para
  // quem NAO esta autenticado, no pathname exato "/", e que REESCREVE.
  assert.match(
    codigo,
    /!authenticated && request\.nextUrl\.pathname === "\/"/,
    "sumiu a excecao da raiz — o visitante volta a cair no formulario de login",
  );
  const ramo = codigo.slice(codigo.indexOf('!authenticated && request.nextUrl.pathname === "/"'));
  assert.match(ramo.slice(0, 300), /pathname = "\/landing"/);
  assert.match(ramo.slice(0, 300), /NextResponse\.rewrite/, "tem de ser rewrite");
});

test("🔑 e NAO por redirect — o endereco divulgado tem de continuar sendo a raiz", async () => {
  // O pedido dela e literal: a URL que ela divulga e a raiz. `redirect` trocaria
  // a barra de enderecos por /landing e quebraria o link.
  const codigo = semComentarios(await fonte("src/lib/supabase/proxy.ts"));
  const ramo = codigo.slice(
    codigo.indexOf('!authenticated && request.nextUrl.pathname === "/"'),
    codigo.indexOf("if (!authenticated && !isPublic)"),
  );
  assert.doesNotMatch(ramo, /NextResponse\.redirect/, "a raiz virou redirect e o endereco muda");
});

test("🔒 a raiz NAO entra em publicPaths — isso abriria o produto inteiro", async () => {
  // ⚠️ A ASSERCAO MAIS IMPORTANTE DO ARQUIVO, e ela reprova uma implementacao
  // que PARECE atender ao pedido. `publicPaths.some(p => pathname.startsWith(p))`
  // com "/" na lista libera TODAS as rotas — /amazon, /configuracoes, /admin.
  // O pedido e "a raiz mostra a landing", nao "o app fica publico".
  const codigo = semComentarios(await fonte("src/lib/supabase/proxy.ts"));
  const lista = codigo.slice(codigo.indexOf("publicPaths"), codigo.indexOf("publicPaths") + 400);
  assert.doesNotMatch(
    lista,
    /["']\/["']\s*[,\]]/,
    "a raiz entrou em publicPaths: com startsWith isso abre o app inteiro",
  );
  // E a avaliacao continua sendo por prefixo — se isso mudar, a nota acima
  // deixa de valer e este teste precisa ser relido.
  assert.match(codigo, /publicPaths\.some\(\(path\) => request\.nextUrl\.pathname\.startsWith\(path\)\)/);
});

test("quem TEM sessao na raiz continua indo para a Visao geral", async () => {
  // Ela vive no produto e nao pode atravessar marketing toda vez que abre.
  // O rewrite so roda para `!authenticated`; com sessao, a raiz segue normal.
  const codigo = semComentarios(await fonte("src/lib/supabase/proxy.ts"));
  assert.match(codigo, /const authenticated = !!data\?\.claims\?\.sub/);
  assert.doesNotMatch(
    codigo,
    /pathname === "\/"[\s\S]{0,120}pathname = "\/landing"[\s\S]{0,60}authenticated \?/,
    "a landing passou a valer para quem tem sessao",
  );
});

test("o ?next= continua valendo para TODAS as outras rotas protegidas", async () => {
  // A excecao e so para "/". Se alguem generalizar, quem tenta abrir /amazon sem
  // sessao para de voltar para /amazon depois do login.
  const codigo = semComentarios(await fonte("src/lib/supabase/proxy.ts"));
  assert.match(codigo, /url\.searchParams\.set\("next", request\.nextUrl\.pathname\)/);
  // E ele e escrito UMA vez — duas gravacoes seriam dois contratos.
  assert.equal((codigo.match(/searchParams\.set\("next"/g) ?? []).length, 1);
});
