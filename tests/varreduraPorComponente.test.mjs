import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// ⚠️ ESTA GUARDA VARRE A ARVORE, NAO UMA LISTA DE ARQUIVOS — e essa e a coisa
// mais importante dela.
//
// A auditoria de empilhamento (01/09/2026) foi feita por NOME DE TELA e deixou o
// ShopeeModulePage de fora, com o defeito inteiro vivo: quatro renders da mesma
// lista de sinais e o multiplexador que suprime a declaracao. Um `grep` de
// `<SinaisDoResultado` achou em um comando o que a lista de telas nao achou numa
// auditoria inteira.
//
// Por isso a regra virou: varredura por COMPONENTE que pede atencao, nao por
// tela. E um teste que varre o diretorio cobre o arquivo que ainda nao existe —
// que e o unico jeito de a proxima tela nascer protegida.

const RAIZ = new URL("../src/app/", import.meta.url);

async function arquivosDeTela() {
  const achados = [];
  async function andar(url) {
    for (const item of await readdir(url, { withFileTypes: true })) {
      const filho = new URL(`${item.name}${item.isDirectory() ? "/" : ""}`, url);
      if (item.isDirectory()) await andar(filho);
      else if (item.name.endsWith(".tsx")) achados.push(filho);
    }
  }
  await andar(RAIZ);
  return achados;
}

const semComentarios = (codigo) => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const nome = (url) => decodeURIComponent(url.pathname).split("/src/app/")[1];

test("NENHUM arquivo multiplexa aviso com explicacao no mesmo lugar", async () => {
  // O padrao `X ? <aviso/> : explicacao` NAO e economia de espaco: ele esconde a
  // explicacao exatamente quando ha pendencia — nas contas que mais precisam
  // dela. Foi assim que a declaracao de base ficou invisivel no ML e no modulo
  // da Shopee.
  //
  // `? <Marca/> : undefined` NAO conta: a alternativa e NADA, nao uma
  // explicacao suprimida.
  for (const arquivo of await arquivosDeTela()) {
    const codigo = semComentarios(await readFile(arquivo, "utf8"));
    const suspeitos = [...codigo.matchAll(/\?\s*<(SinaisDoResultado|MarcaDeEstimativa)[^>]*\/>\s*:\s*([^\s}]+)/g)]
      .filter((m) => m[2] !== "undefined" && m[2] !== "null");
    assert.equal(
      suspeitos.length, 0,
      `${nome(arquivo)}: voltou o multiplexador que suprime explicacao — ${suspeitos.map((m) => m[0].slice(0, 60)).join(" | ")}`,
    );
  }
});

test("os sinais aparecem no maximo UMA vez por VIEW", async () => {
  // Corte 1 da auditoria. O limite e por view, e nao por arquivo: o ML tem duas
  // telas no mesmo modulo (dashboard e Monitor), e cada uma mostra os sinais uma
  // vez — o corte proibe repetir a MESMA lista na MESMA tela, nao mostra-la nas
  // telas que a usam.
  const LIMITE_POR_ARQUIVO = { "components/MercadoLivreWorkspace.tsx": 2 };
  for (const arquivo of await arquivosDeTela()) {
    const codigo = semComentarios(await readFile(arquivo, "utf8"));
    const vezes = (codigo.match(/<SinaisDoResultado/g) ?? []).length;
    const limite = LIMITE_POR_ARQUIVO[nome(arquivo)] ?? 1;
    assert.ok(vezes <= limite, `${nome(arquivo)}: ${vezes} renders de sinais (limite ${limite})`);
  }
});

test("progresso nao divide espaco com progresso NA MESMA view", async () => {
  // `EstadoDoSync` e `SincronizacaoCompleta` descrevem o mesmo eixo — o quanto
  // do sync ja chegou. Hoje nunca coexistem numa view: EstadoDoSync mora nas
  // views de monitor e nos modulos, SincronizacaoCompleta nos dashboards.
  //
  // ⚠️ A COMPARACAO E POR FUNCAO, NAO POR ARQUIVO. A primeira versao desta
  // guarda era por arquivo e reprovou o MercadoLivreWorkspace, que tem as duas
  // em views DIFERENTES (Dashboard e Monitor). Teste vermelho por motivo que
  // nao e o produto ensina a ignorar teste vermelho — e a fragilidade era
  // minha: casei "no mesmo arquivo" quando a invariante e "no mesmo bloco".
  const funcaoDe = (codigo, posicao) => {
    const antes = codigo.slice(0, posicao);
    // Sem escapes de propósito: a linha anterior desta guarda saiu quebrada
    // ao ser gravada, e regex multilinha em teste é fragilidade sem ganho.
    return antes.lastIndexOf("function ");
  };
  for (const arquivo of await arquivosDeTela()) {
    const codigo = semComentarios(await readFile(arquivo, "utf8"));
    const a = codigo.indexOf("<EstadoDoSync");
    const b = codigo.indexOf("<SincronizacaoCompleta");
    if (a < 0 || b < 0) continue;
    assert.notEqual(
      funcaoDe(codigo, a), funcaoDe(codigo, b),
      `${nome(arquivo)}: as duas faixas de progresso na MESMA view`,
    );
  }
});

test("componentes de atencao ausentes CONTINUAM ausentes onde ja se concluiu que estao", async () => {
  // "Limpo por teste" e diferente de "limpo porque eu olhei". Onde a varredura
  // concluiu ausencia, a ausencia passa a ser reprovada se voltar sem regra.
  const codigo = semComentarios(await readFile(new URL("components/TikTokModulePage.tsx", RAIZ), "utf8"));
  assert.ok(!/<SinaisDoResultado/.test(codigo), "o modulo do TikTok ganhou sinais — passe pela regra do corte 1");
  assert.ok(!/<SincronizacaoCompleta/.test(codigo), "o modulo do TikTok ganhou uma segunda faixa de progresso");
});
