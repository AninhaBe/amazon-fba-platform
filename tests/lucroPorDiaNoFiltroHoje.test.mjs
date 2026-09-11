import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JANELA_DE_SETE_DIAS, serieDoBlocoDeLucro } from "../src/app/components/serieDoLucroPorDia.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (codigo) =>
  codigo.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const ML = "src/app/components/MercadoLivreWorkspace.tsx";
const dias = (n) => Array.from({ length: n }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}` }));

/**
 * ⚠️ ESTE ARQUIVO JÁ REPROVOU O CONTRÁRIO DO QUE REPROVA HOJE, e a
 * inversão é decisão da dona (09/09/2026): *"sobre o ritmo dos últimos 7 dias,
 * vai ser a única coisa que não vai mudar com base no filtro de data, vai ficar
 * últimos 7 dias sempre"*.
 *
 * **O que ele exigia antes (v262, 03/09/2026):** que SÓ o filtro "Hoje"
 * trocasse de fonte — havia um teste chamado *"nos OUTROS filtros a serie
 * continua sendo a do periodo"* que hoje seria vermelho de propósito. Aquilo
 * corrigia um defeito real, fotografado pela dona: com "Hoje" o bloco recebia
 * UM ponto e virava uma coluna gigante ocupando a régua inteira, sob um título
 * que prometia sete.
 *
 * **Por que mudou:** o título do bloco é fixo — "Ritmo dos últimos 7 dias". Com
 * 15 ou 30 dias o corte `slice(-7)` coincidia com os sete últimos de verdade e
 * ninguém via nada. Com **Personalizado** (1 a 20 de agosto, por exemplo) o
 * bloco mostrava os últimos sete dias DAQUELA janela sob aquele título. A
 * decisão da dona resolve a divergência pela raiz: o bloco não olha o filtro.
 */

test("o bloco exibe os SETE dias da janela", () => {
  const resultado = serieDoBlocoDeLucro({ janelaDeSeteDias: dias(7) });
  assert.equal(resultado.length, 7, "o bloco deixou de exibir sete colunas");
  assert.deepEqual(resultado, dias(7), "as colunas não são as da janela de sete dias");
});

test("janela maior que sete e cortada nos SETE MAIS RECENTES", () => {
  // ⚠️ O corte é `slice(-7)`, e o lado importa: pegar os sete
  // PRIMEIROS devolveria a semana mais antiga com o título "últimos 7 dias" —
  // vermelho aqui, invisível na tela, porque sete colunas continuam sete.
  const resultado = serieDoBlocoDeLucro({ janelaDeSeteDias: dias(30) });
  assert.equal(resultado.length, 7, "o corte deixou de ser de sete");
  assert.equal(resultado[6].date, "2026-09-30", "o corte deixou de pegar os dias mais recentes");
  assert.equal(resultado[0].date, "2026-09-24", "o corte passou a pegar a ponta errada da série");
});

test("enquanto a janela nao chegou, o bloco fica VAZIO", () => {
  // ⚠️ Este é o estado intermediário, e ele é visível: melhor o bloco
  // não existir por um instante do que aparecer com as colunas do período sob
  // um título que promete sete — que é como o defeito de 03/09 se parecia.
  assert.deepEqual(
    serieDoBlocoDeLucro({ janelaDeSeteDias: null }),
    [],
    "o bloco voltou a desenhar algo enquanto a janela carrega",
  );
});

test("a serie do PERIODO nao alcanca mais o bloco", () => {
  /**
   * ⚠️ ASSERÇÃO SOBRE A ASSINATURA, e é de propósito. O jeito de o
   * filtro voltar a influenciar o bloco é alguém aceitar `serieDoPeriodo` ou
   * `filtro` de novo aqui — e um teste que só chama a função com a janela nunca
   * veria isso, porque parâmetro a mais não quebra chamada nenhuma.
   *
   * Chamo com os nomes antigos junto: se voltarem a ser lidos, a saída deixa de
   * ser a janela.
   */
  const resultado = serieDoBlocoDeLucro({
    janelaDeSeteDias: dias(7),
    filtro: "from=2026-08-01&to=2026-08-20",
    serieDoPeriodo: dias(20),
  });
  assert.deepEqual(resultado, dias(7), "a série do período voltou a alcançar o bloco de ritmo");
});

test("a janela e a MESMA chave do filtro de 7 dias — nao uma busca paralela", () => {
  // ⚠️ Se a janela fosse buscada com outra query, ela cairia em outra
  // chave de cache e poderia DISCORDAR do que o filtro "7 dias" mostra: duas
  // janelas de sete dias no mesmo dia, uma em cada aba. É o "dois consumidores,
  // dois universos" aplicado ao tempo. E é também o que faz esta decisão sair
  // de graça: quem já passou pelo filtro de 7 dias não busca nada de novo.
  assert.equal(JANELA_DE_SETE_DIAS, "days=7", "a janela deixou de ser a query do filtro de 7 dias");
});

test("o componente nao volta a condicionar a janela ao filtro", async () => {
  const codigo = semComentarios(await fonte(ML));

  // ⚠️ FONTE SEM COMENTÁRIO É OBRIGATÓRIO NESTA, porque ela PROÍBE
  // uma string — e o comentário que explica a decisão cita "FILTRO_DE_HOJE"
  // justamente para contar que ele saiu. É a armadilha que o AGENTS.md registra
  // ter pegado quatro vezes em dois dias.
  assert.ok(
    !codigo.includes("FILTRO_DE_HOJE"),
    "o filtro Hoje voltou a decidir se a janela de sete dias existe",
  );

  // A chamada INTEIRA, não o par chave:valor — o AGENTS.md registra o dia em
  // que casar só `chave: valor` ficou verde com a propriedade apagada, porque a
  // frase existia no comentário logo acima.
  assert.ok(
    codigo.includes("const serieDoBloco = serieDoBlocoDeLucro({ janelaDeSeteDias: serieDeSeteDias });"),
    "o bloco parou de passar pela escolha testada, ou voltou a receber a série do período",
  );

  // O hook não recebe mais o período: se receber, é porque alguém religou a
  // condição. Comparação de string literal, sem regex montada — o AGENTS.md
  // registra três guardas de tela que ficaram verdes por recorte "esperto".
  assert.ok(
    codigo.includes("const serieDeSeteDias = useJanelaDeSeteDias(view, connectionId);"),
    "o hook da janela voltou a receber o período selecionado",
  );

  // O destaque verde acompanha a série EXIBIDA, não a do período.
  // ⚠️ A VARIAVEL DO LACO TROCOU DE NOME (`ponto` -> `d`) quando o
  // ritmo passou para o `PainelV3` em 11/09/2026. A regra e a mesma e continua
  // ancorada no que importa: o destaque sai da serie EXIBIDA (`serieDoBloco`),
  // nunca da serie do periodo.
  assert.match(
    codigo,
    /destaque: d\.date === serieDoBloco\[serieDoBloco\.length - 1\]\?\.date,/,
    "o destaque voltou a sair da série do período e pode pintar a coluna errada",
  );

  // A busca da janela usa o MESMO escritor do cache que o aquecimento.
  assert.match(
    codigo,
    /void buscarEGuardarPeriodo\(view, JANELA_DE_SETE_DIAS, controller\.signal\)/,
    "a janela passou a ser buscada por fora do escritor único do cache",
  );
});
