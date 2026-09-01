import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

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
  // ⚠️ VERDE POR NAO TER ENCONTRADO NADA E O PIOR TIPO DE VERDE, e e assim que
  // esta guarda morreria em silencio: um erro no andador, uma pasta que muda de
  // lugar, e as quatro assercoes passam sem olhar arquivo nenhum. O piso mora
  // AQUI, e nao em cada teste, porque todas dependem desta lista.
  //
  // O numero e folgado de proposito: ele reprova a arvore VAZIA ou quase, nao
  // uma tela a menos. Piso apertado vira teste que quebra por refatoracao,
  // que e o outro jeito de a guarda ser desligada.
  if (achados.length < 40) {
    throw new Error(`a varredura achou so ${achados.length} telas — o andador quebrou, e as assercoes passariam vazias`);
  }
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

test("sinal NAO mora dentro do value de um Flow", async () => {
  // ⚠️ O TikTok era o unico canal assim, e a forma tinha chegado ali POR COPIA:
  // ela existia no Flow da Shopee e saiu na auditoria de empilhamento. Tres
  // canais de um jeito e um de outro e o que a regra de replicar nos quatro
  // existe para impedir — inconsistencia entre canais cobra juros, porque quem
  // mexer no canal amanha copia o padrao errado.
  //
  // O sinal e ALARME (pede acao). O lugar dele e um bloco proprio: dentro do
  // `value` ele vira parte do dado, que e a categoria "informacao colada ao
  // numero" e nao a dele.
  //
  // ⚠️ A DETECCAO ANDA PARA TRAS CONTANDO CHAVES, e nao por regex de janela
  // fixa. A primeira versao casava `value={` ate 400 caracteres a frente e
  // reprovou a Amazon, cujo sinal esta num bloco proprio — o regex tinha
  // engolido codigo ate alcancar um `<SinaisDoResultado` distante. Guarda nova
  // que nasce fragil e a forma mais rapida de ensinar o time a ignorar guarda.
  const LIMITE = 2000; // ate onde vale procurar o `value` que envolve — alem disso o texto ja e outro componente
  const dentroDeValue = (codigo, posicao) => {
    let profundidade = 0;
    for (let i = posicao - 1; i >= 0; i -= 1) {
      const c = codigo[i];
      if (c === "}") profundidade += 1;
      else if (c === "{") {
        if (profundidade > 0) { profundidade -= 1; continue; }
        // Chave de nivel 0: ENVOLVE a posicao. Se for a do `value`, achamos; se
        // nao, seguimos PARA FORA — o sinal pode estar dentro de um fragmento
        // aninhado no value, que foi como a rodada de quebras o devolveu ali
        // (`value={cond ? <>{numero}{sinal}</> : "—"}`). Parar na primeira
        // chave deixava essa forma passar.
        if (codigo.slice(Math.max(0, i - 6), i).endsWith("value=")) return true;
        if (posicao - i > LIMITE) return false;
      }
    }
    return false;
  };
  // ⚠️ A AMAZON FOI A ULTIMA A SAIR DESSA FORMA (01/09/2026) e por um tempo
  // ficou aqui como excecao NOMEADA, porque mover peca da tela dela nao estava
  // aprovado. A excecao se limpou sozinha: ao mover, o teste ficou vermelho
  // dizendo "APAGUE a entrada de PENDENTE" — nunca o contrario. Fica o registro
  // de que a lista existiu e de como ela morreu, porque excecao que sobrevive
  // ao conserto e o jeito de a guarda morrer no lugar do defeito.
  const dentroDoValue = [];
  for (const arquivo of await arquivosDeTela()) {
    const codigo = semComentarios(await readFile(arquivo, "utf8"));
    let de = codigo.indexOf("<SinaisDoResultado");
    while (de >= 0) {
      if (dentroDeValue(codigo, de)) dentroDoValue.push(nome(arquivo));
      de = codigo.indexOf("<SinaisDoResultado", de + 1);
    }
  }
  assert.deepEqual(dentroDoValue, [], `sinal dentro do value de um Flow em: ${dentroDoValue.join(", ")}`);
});
