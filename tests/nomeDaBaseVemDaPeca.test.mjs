import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { declaracaoDeBase, nomeDaBase } from "../src/app/components/baseDaMargem.ts";

/**
 * ⚠️ ESTA GUARDA E SOBRE A PROCEDENCIA DO TEXTO, NAO SOBRE O TEXTO.
 *
 * A varredura de frases explicativas foi MEDIDA antes de virar guarda e
 * reprovada: gatilho de texto deu 84 achados, ZERO mentiras vivas e ~95% de
 * falso positivo, e o teste de recall matou de vez — ela nao teria pego nenhum
 * dos dois casos reais do dia (um era ternario, o outro nao era string). O
 * registro esta em `docs/achado-frase-com-validade-nao-vira-guarda.md`.
 *
 * O que sobra com poder e julgar DE ONDE A FRASE VEIO: o vocabulario que nomeia
 * a base de um numero sai de `baseDaMargem.ts` e de lugar nenhum mais. Isso e
 * verificavel sem adivinhar intencao, e a peca e funcao pura — da para chamar e
 * conferir a saida, que e a resposta certa a familia "guarda que depende da
 * forma do codigo" (`docs/achado-guarda-que-depende-da-forma.md`).
 */

test("nomeDaBase NOMEIA quando nao ha divergencia — e nao inventa 'sobre vendas'", () => {
  // O defeito que isto reprova: rotear o monitor e o modulo da Shopee por
  // `declaracaoDeBase`, que devolve null sem divergencia, trocaria
  // "sobre a receita processada" por "sobre vendas" — perda de especificidade
  // travestida de refatoracao. Medido em 01/09/2026, antes de aplicar.
  const monitor = { baseApurada: 1000, faturamentoExibido: 1000, moeda: "BRL", rotuloDaBase: "a receita" };
  assert.equal(nomeDaBase(monitor), "sobre a receita");

  const shopee = { baseApurada: 500, faturamentoExibido: 500, moeda: "BRL", rotuloDaBase: "a receita processada" };
  assert.equal(nomeDaBase(shopee), "sobre a receita processada");

  // E quando o backend mandar `revenueDoLucro`, o nome acompanha o campo usado.
  const shopeeComFaturamento = { ...shopee, rotuloDaBase: "o faturamento" };
  assert.equal(nomeDaBase(shopeeComFaturamento), "sobre o faturamento");
});

test("e DELEGA quando ha divergencia — a declaracao continua ganhando do nome", () => {
  const comDivergencia = { baseApurada: 748.56, faturamentoExibido: 1068.37, moeda: "BRL", rotuloDaBase: "a receita" };
  assert.equal(nomeDaBase(comDivergencia), declaracaoDeBase(comDivergencia));
  assert.match(nomeDaBase(comDivergencia), /apurados de/);
});

test("a peca sabe nomear AS DUAS razoes de a base ser menor", () => {
  // ⚠️ O DEFEITO QUE ISTO REPROVA (01/09/2026, na central): rotear a Margem
  // consolidada pela peca fazia a frase GANHAR o segundo numero e PERDER a
  // causa — "a parte com custo cadastrado". E o pior negocio possivel: o numero
  // a pessoa ja ve no cartao ao lado, a causa nao esta em lugar nenhum, e a
  // causa e a unica parte da frase que diz O QUE FAZER.
  const comum = { baseApurada: 748.56, faturamentoExibido: 1068.37, moeda: "BRL" };
  assert.match(nomeDaBase({ ...comum, rotuloDaBase: "o faturamento", custoNaoCadastrado: true }), / — a parte com custo cadastrado$/);
  assert.match(nomeDaBase({ ...comum, rotuloDaBase: "o faturamento", pedidosAguardando: 3 }), / — 3 pedidos aguardando confirmação$/);
  // ⚠️ CUSTO NAO CADASTRADO GANHA quando as duas existem, e este teste ja
  // afirmou o CONTRARIO: a primeira versao dizia que "aguardando" vinha
  // primeiro, com o argumento de que e a causa que se resolve sozinha. E o
  // inverso — "aguardando" NAO E ACIONAVEL, e a linha da tela nao pode ser
  // gasta explicando o que ela nao controla. Fica registrado porque o teste
  // mudou de intencao: quem o vir vermelho amanha precisa saber que a ordem foi
  // decidida, nao herdada.
  assert.match(nomeDaBase({ ...comum, rotuloDaBase: "o faturamento", pedidosAguardando: 3, custoNaoCadastrado: true }), /a parte com custo cadastrado$/);
});

test("o PREFIXO diz QUAL numero esta sendo declarado", () => {
  // Sem ele, "sobre o faturamento do periodo" no cartao da Amazon deixa a
  // pessoa adivinhar se a base e do lucro, da margem ou do ROI.
  assert.equal(nomeDaBase({ prefixo: "Lucro", rotuloDaBase: "o faturamento do período" }), "Lucro sobre o faturamento do período");
  assert.equal(nomeDaBase({ rotuloDaBase: "a receita" }), "sobre a receita");
});

test("a frase do CARTAO DE MARGEM vem da peca, em toda a arvore", async () => {
  // ⚠️ A REGRA VALE PARA O CARTAO DE MARGEM, NAO PARA QUALQUER TEXTO — e o
  // escopo estreito e o que dispensa lista de excecao. A versao anterior
  // reprovava "Gasto com anuncio sobre o faturamento total" (a definicao do
  // TACOS, que E sobre o faturamento total) e "X% sobre o faturamento" (a base
  // da ALIQUOTA). Os dois saem por CONSTRUCAO, nao por excecao escrita.
  //
  // ⚠️ E o fonte vai SEM COMENTARIOS: assercao que PROIBE casa o comentario que
  // explica a proibicao. Pegou quatro vezes em dois dias neste repo.
  const VOCABULARIO = /(["'])[^"'\n]*\bsobre (o|a) (faturamento|receita|base)[^"'\n]*\1/;
  const MARGEM = /key: "marginPct"|label: "Margem"|label="Margem"|label=\{comSemImposto\("Margem"/g;
  const arquivos = [];
  const anda = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const caminho = `${dir}/${e.name}`;
      if (e.isDirectory()) await anda(caminho);
      else if (/\.tsx?$/.test(e.name)) arquivos.push(caminho);
    }
  };
  await anda("src/app");
  // O cartao e delimitado pela CHAVE QUE O ENVOLVE — contagem de chaves, nunca
  // janela fixa de caracteres. Janela fixa foi o que reprovou arquivo errado na
  // guarda dos sinais, no mesmo dia.
  const cartao = (codigo, posicao) => {
    let i = posicao, profundidade = 0;
    for (; i >= 0; i -= 1) {
      if (codigo[i] === "}") profundidade += 1;
      else if (codigo[i] === "{") { if (profundidade === 0) break; profundidade -= 1; }
    }
    if (i < 0) return "";
    let fim = i, nivel = 0;
    for (; fim < codigo.length; fim += 1) {
      if (codigo[fim] === "{") nivel += 1;
      else if (codigo[fim] === "}") { nivel -= 1; if (nivel === 0) break; }
    }
    return codigo.slice(i, fim + 1);
  };
  let vistos = 0;
  for (const arquivo of arquivos) {
    if (arquivo.includes("/lab/")) continue; // mockup, nao produto
    const codigo = (await readFile(arquivo, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const m of codigo.matchAll(MARGEM)) {
      vistos += 1;
      const achado = cartao(codigo, m.index).match(VOCABULARIO);
      assert.equal(achado, null, `${arquivo}: a frase que nomeia a base da margem tem de vir de nomeDaBase() — derive do mesmo lugar que decide o valor. Achado: ${achado?.[0]}`);
    }
  }
  assert.ok(vistos >= 4, `a guarda so achou ${vistos} cartoes de margem — o padrao de busca envelheceu`);
});

test("e a CENTRAL continua passando a causa — ela pode sumir em silencio", async () => {
  // ⚠️ ESTE TESTE NASCEU DE UMA QUEBRA QUE NAO FICOU VERMELHA (01/09/2026):
  // trocar `custoNaoCadastrado: true` por `false` apagava "a parte com custo
  // cadastrado" da tela dela e nenhuma assercao reclamava. E a mesma familia do
  // "nada desaparece" — a causa e a UNICA parte da frase que diz o que fazer.
  //
  // ⚠️ A ANCORA E A CHAMADA INTEIRA, nao o par `chave: valor` avulso: um
  // `assert.match(fonte, /custoNaoCadastrado: true/)` fica verde depois de
  // alguem apagar a propriedade, porque a frase sobrevive no comentario logo
  // acima. Aconteceu neste repo, com `filaDeFundo: false`.
  const codigo = (await readFile("src/app/(app)/page.tsx", "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const inicio = codigo.indexOf("nomeDaBase({");
  assert.ok(inicio > 0, "a Margem consolidada da central deixou de usar a peca");
  let nivel = 0, fim = inicio;
  for (; fim < codigo.length; fim += 1) {
    if (codigo[fim] === "{") nivel += 1;
    else if (codigo[fim] === "}") { nivel -= 1; if (nivel === 0) break; }
  }
  const chamada = codigo.slice(inicio, fim + 1);
  assert.match(chamada, /custoNaoCadastrado: true/, "a causa saiu da chamada — a frase volta a dizer so o numero");
  assert.match(chamada, /baseApurada: margemTotal\.base/, "a base deixou de sair do numero que foi de fato usado");
});
