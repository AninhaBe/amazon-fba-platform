import test from "node:test";
import assert from "node:assert/strict";
import { gerarXlsx } from "../src/lib/planilha.ts";

/**
 * O DEFEITO QUE ESTE ARQUIVO REPROVA: exportar uma planilha que o Excel abre
 * como TEXTO. Em 10/09/2026 a exportação de "Pedidos a revisar" saiu primeiro em
 * CSV e ela reprovou na hora — "baixou em csv, não excel". O que ela quer não é
 * a extensão: é a coluna que SOMA, e para somar a célula precisa ser numérica.
 *
 * Por isso as asserções aqui olham os BYTES gerados, não o código-fonte: um
 * `assert.match(fonte, /inlineStr/)` continuaria verde com o gerador escrevendo
 * tudo como texto.
 */

/** Lê o ZIP "store" que `gerarXlsx` produz, sem biblioteca. */
function abrirZip(bytes) {
  const visao = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const partes = new Map();
  let posicao = 0;
  while (posicao + 4 <= bytes.length && visao.getUint32(posicao, true) === 0x04034b50) {
    const tamanho = visao.getUint32(posicao + 18, true);
    const tamanhoDoNome = visao.getUint16(posicao + 26, true);
    const tamanhoExtra = visao.getUint16(posicao + 28, true);
    const inicioDoNome = posicao + 30;
    const nome = new TextDecoder().decode(bytes.subarray(inicioDoNome, inicioDoNome + tamanhoDoNome));
    const inicio = inicioDoNome + tamanhoDoNome + tamanhoExtra;
    partes.set(nome, new TextDecoder().decode(bytes.subarray(inicio, inicio + tamanho)));
    posicao = inicio + tamanho;
  }
  return partes;
}

/* O contrato mudou em 10/09/2026: em vez de `negrito` e `colunasDeDinheiro`,
   cada celula declara um NOME de estilo. O motivo esta no cabecalho de
   `planilha.ts` — ela pediu cor e divisao, e dois sinalizadores nao davam conta
   de cabecalho escuro, linha de total e diferenca colorida. */
const planilha = () =>
  gerarXlsx({
    aba: "Teste",
    linhas: [
      [{ valor: "Pedido", estilo: "cabecalho" }, { valor: "Valor", estilo: "cabecalho" }],
      [{ valor: "2000000000000", estilo: "texto" }, { valor: 12.4, estilo: "dinheiro" }],
      [{ valor: "2000000000007", estilo: "texto" }, null],
    ],
    larguras: [18, 12],
  });

test("o arquivo é um ZIP com as partes que o Excel exige", () => {
  const bytes = planilha();
  assert.deepEqual([...bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04], "não começa com a assinatura de ZIP");
  const partes = abrirZip(bytes);
  for (const parte of [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/worksheets/sheet1.xml",
  ]) {
    assert.ok(partes.has(parte), `faltou ${parte} — o Excel recusa o arquivo`);
  }
});

test("número vira célula NUMÉRICA, e é isso que faz a coluna somar", () => {
  const folha = abrirZip(planilha()).get("xl/worksheets/sheet1.xml");
  // B2 é o 12,4: tem <v> e NÃO tem t="inlineStr".
  const b2 = folha.match(/<c r="B2"[^>]*>.*?<\/c>/)?.[0] ?? "";
  assert.ok(b2.includes("<v>12.4</v>"), `B2 não saiu como número: ${b2}`);
  assert.ok(!b2.includes("inlineStr"), `B2 saiu como texto: ${b2}`);
});

test("texto vira inlineStr — inclusive o código do pedido, que não pode virar número", () => {
  const folha = abrirZip(planilha()).get("xl/worksheets/sheet1.xml");
  const a2 = folha.match(/<c r="A2"[^>]*>.*?<\/c>/)?.[0] ?? "";
  assert.ok(a2.includes("inlineStr"), `A2 deveria ser texto: ${a2}`);
  assert.ok(a2.includes("2000000000000"), "o código do pedido sumiu");
});

test("null não vira zero — a célula simplesmente não existe", () => {
  const folha = abrirZip(planilha()).get("xl/worksheets/sheet1.xml");
  // B3 é o `null`. Zero ali somaria como se o valor fosse conhecido.
  // B3 e `null` SEM estilo: nada e escrito. Com estilo, a celula existe (e o que
  // estende borda e fundo pela linha) mas continua SEM `<v>` — o que importa e
  // nunca haver um zero ali.
  const b3 = folha.match(/<c r="B3"[^>]*>?/)?.[0] ?? "";
  assert.ok(!b3.includes("<v>"), `a célula vazia ganhou valor: ${b3}`);
});

test("cabeçalho e dinheiro saem com estilo, e o catálogo tem cor e borda", () => {
  const partes = abrirZip(planilha());
  const folha = partes.get("xl/worksheets/sheet1.xml");
  // Os índices vêm de `ORDEM_DOS_ESTILOS`: 3 = cabeçalho, 5 = dinheiro.
  const a1 = folha.match(/<c r="A1"[^>]*/)?.[0] ?? "";
  assert.ok(a1.includes('s="3"'), `o cabeçalho não recebeu o estilo de cabeçalho: ${a1}`);
  const b2 = folha.match(/<c r="B2"[^>]*/)?.[0] ?? "";
  assert.ok(b2.includes('s="5"'), `o valor não ficou com formato de dinheiro: ${b2}`);

  // ⚠️ A COR E A BORDA SÃO O PEDIDO DELA, não enfeite meu:
  // *"nenhuma cor? divisão? ainda não tá legal"*. Sem preenchimento sólido e sem
  // borda, a planilha volta a ser a tabela cinza que ela reprovou — e nada mais
  // no projeto avisaria.
  const estilos = partes.get("xl/styles.xml");
  assert.match(estilos, /patternType="solid"><fgColor rgb="FF171717"/, "o cabeçalho perdeu o fundo escuro");
  assert.match(estilos, /<color rgb="FFFFFFFF"\/>/, "o cabeçalho perdeu o texto branco");
  assert.match(estilos, /style="thin"/, "a grade de bordas sumiu");
  assert.match(estilos, /rgb="FFC83A31"/, "a cor de cobrança a mais sumiu");
  assert.match(estilos, /rgb="FF167A56"/, "a cor de valor a favor sumiu");
  // E o estilo 2 tem de existir no styles.xml apontando para o formato 164.
  //
  // O formato mudou em 10/09/2026: passou a carregar o "R$", porque a planilha
  // sem símbolo obrigava quem abre a lembrar quais colunas eram dinheiro. A
  // intenção da guarda não mudou — dinheiro com DUAS CASAS —, e o símbolo entra
  // no formato, não no texto, para a célula seguir numérica e somável.
  assert.match(partes.get("xl/styles.xml"), /numFmtId="164" formatCode="[^"]*#,##0\.00"/);
  assert.match(partes.get("xl/styles.xml"), /formatCode="&quot;R\$&quot;/, "o R$ sumiu do formato");
});

test("o mesmo conteúdo gera os MESMOS bytes — a hora do ZIP é fixa", () => {
  // O ZIP guarda data/hora do arquivo. Se ela vier do relógio, dois cliques
  // produzem arquivos diferentes — impossível comparar duas exportações e
  // impossível testar a saída.
  assert.deepEqual([...planilha()], [...planilha()]);

  // ⚠️ COMPARAR DUAS CHAMADAS NÃO BASTA, e eu descobri isso
  // quebrando: troquei a hora fixa por `Date.now() % 60000` e o teste continuou
  // VERDE, porque as duas chamadas caem no mesmo milissegundo. A asserção que
  // pega o defeito olha os bytes do cabeçalho: hora no deslocamento 10, data no
  // 12 — os dois têm de ser as constantes, não um valor qualquer.
  const bytes = planilha();
  const visao = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(visao.getUint16(10, true), 0, "a hora do ZIP deixou de ser fixa");
  assert.equal(visao.getUint16(12, true), 33, "a data do ZIP deixou de ser fixa");
});
