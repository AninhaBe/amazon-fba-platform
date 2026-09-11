/**
 * Gerador de .xlsx — planilha do Excel de verdade, sem biblioteca.
 *
 * ⚠️ EXISTE PORQUE CSV NÃO É EXCEL. A primeira versão da
 * exportação de "Pedidos a revisar" gerava CSV com BOM e ponto e vírgula: abre
 * no Excel, os números somam, e mesmo assim ela reprovou na hora — *"baixou em
 * csv, não excel"*. E está certa no essencial: CSV não guarda tipo, não guarda
 * largura de coluna e não guarda formato; quem recebe o arquivo vê texto e tem
 * de arrumar tudo à mão.
 *
 * ⚠️ E POR QUE NÃO UMA BIBLIOTECA. As candidatas de mercado
 * passam de 800 KB e entrariam no pacote de um app que hoje não carrega nenhuma
 * — para um botão. Um `.xlsx` é um ZIP de arquivos XML, e a parte que assusta
 * (compressão) é opcional: o formato aceita "store", sem compressão nenhuma.
 *
 * ⚠️ OS ESTILOS SÃO UM CATÁLOGO FECHADO, e isso foi a segunda
 * correção dela: *"nenhuma cor? divisão? ainda não tá legal"*. A primeira versão
 * tinha só negrito e duas casas — uma tabela cinza de ponta a ponta, onde o olho
 * não acha o cabeçalho nem o total. Em vez de expor fonte, preenchimento e borda
 * (que viraria um editor de planilha dentro do projeto), cada célula escolhe um
 * NOME de estilo, e a lista de nomes está logo abaixo. Estilo novo se adiciona
 * aqui, uma vez, e vale para todas as telas que exportarem.
 *
 * ⚠️ O QUE ISSO NÃO FAZ, para quem for revisitar: não há
 * fórmulas, não há mais de uma aba e não há formatação condicional. A cor da
 * diferença positiva/negativa é decidida por quem monta as linhas, não pelo
 * Excel — se um dia a planilha precisar recalcular a cor ao editar o valor,
 * isso é trabalho novo.
 */

/**
 * Nomes de estilo. A ordem aqui é a ordem de `cellXfs` no `styles.xml`, e as
 * duas precisam andar juntas: trocar uma sem a outra muda a aparência de todas
 * as células em silêncio.
 */
export type EstiloDaCelula =
  | "normal"
  | "titulo"
  | "rotulo"
  | "cabecalho"
  | "texto"
  | "dinheiro"
  | "dinheiroCobradoAMais"
  | "dinheiroAFavor"
  | "totalTexto"
  | "totalDinheiro"
  | "nota";

const ORDEM_DOS_ESTILOS: EstiloDaCelula[] = [
  "normal",
  "titulo",
  "rotulo",
  "cabecalho",
  "texto",
  "dinheiro",
  "dinheiroCobradoAMais",
  "dinheiroAFavor",
  "totalTexto",
  "totalDinheiro",
  "nota",
];

/** `null` vira célula VAZIA, nunca zero — a regra `null ≠ 0` vale na planilha. */
export type ValorDaCelula = string | number | null;
export type CelulaDaPlanilha = ValorDaCelula | { valor: ValorDaCelula; estilo: EstiloDaCelula };

export interface PlanilhaPedida {
  /** Nome da aba. O Excel recusa > 31 caracteres e alguns símbolos. */
  aba: string;
  linhas: CelulaDaPlanilha[][];
  /** Largura de cada coluna, em caracteres. Sem isto o Excel usa 8,43 para todas. */
  larguras?: number[];
  /**
   * Congela as linhas acima desta (contagem do Excel, base 1), para o cabeçalho
   * não sumir ao rolar. Sem isto, na linha 40 ninguém sabe mais de que coluna é
   * o número que está olhando.
   */
  congelarAcimaDe?: number;
  /** Liga o filtro do Excel no cabeçalho da tabela. Índices base 0. */
  filtro?: { linha: number; daColuna: number; ateColuna: number; ateLinha: number };
  /**
   * ⚠️ CÓDIGO É TEXTO, E O EXCEL RECLAMA DISSO. Número de pedido
   * e de envio precisam ser texto — como número, 2000000000000 perde precisão e
   * vira notação científica. O Excel então marca cada célula com um triângulo
   * verde ("número armazenado como texto"), e trinta triângulos numa planilha de
   * conferência parecem trinta erros. Este intervalo silencia o aviso sem mudar
   * o dado. Índices base 0.
   */
  colunasDeCodigo?: { daColuna: number; ateColuna: number; daLinha: number; ateLinha: number };
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function escapar(texto: string) {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** A1, B1, … Z1, AA1 — o Excel exige a referência em cada célula. */
function referencia(coluna: number, linha: number) {
  let nome = "";
  let n = coluna;
  do {
    nome = String.fromCharCode(65 + (n % 26)) + nome;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return nome + (linha + 1);
}

function partesDaCelula(celula: CelulaDaPlanilha): { valor: ValorDaCelula; estilo: EstiloDaCelula } {
  if (celula !== null && typeof celula === "object") return celula;
  return { valor: celula, estilo: "normal" };
}

/**
 * ⚠️ NÚMERO VAI SEM `t`, TEXTO VAI COM `t="inlineStr"`. É essa
 * diferença que faz a coluna somar. Texto por `inlineStr` evita a tabela de
 * strings compartilhadas (`sharedStrings.xml`) — um arquivo a menos, e nenhuma
 * diferença para quem abre.
 */
function celulaXml(celula: CelulaDaPlanilha, coluna: number, linha: number) {
  const { valor, estilo } = partesDaCelula(celula);
  const ref = referencia(coluna, linha);
  const indice = ORDEM_DOS_ESTILOS.indexOf(estilo);
  const s = indice > 0 ? ` s="${indice}"` : "";
  /* ⚠️ CÉLULA VAZIA COM ESTILO AINDA É ESCRITA: é ela que
     estende a borda e o preenchimento pela linha inteira. Sem isto, a linha do
     total teria fundo em três colunas e branco no resto. */
  if (valor == null || valor === "") return indice > 0 ? `<c r="${ref}"${s}/>` : "";
  if (typeof valor === "number" && Number.isFinite(valor)) {
    return `<c r="${ref}"${s}><v>${valor}</v></c>`;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapar(String(valor))}</t></is></c>`;
}

function folhaXml(pedido: PlanilhaPedida) {
  const colunas = (pedido.larguras ?? [])
    .map((largura, indice) => `<col min="${indice + 1}" max="${indice + 1}" width="${largura}" customWidth="1"/>`)
    .join("");
  const linhas = pedido.linhas
    .map((linha, y) => {
      const celulas = linha.map((celula, x) => celulaXml(celula, x, y)).join("");
      return `<row r="${y + 1}">${celulas}</row>`;
    })
    .join("");

  /* ⚠️ A ORDEM DOS ELEMENTOS DENTRO DE <worksheet> É FIXA no
     formato: sheetViews, cols, sheetData, autoFilter, ignoredErrors. Fora de
     ordem o Excel recusa o arquivo INTEIRO, e a mensagem que ele dá não diz qual
     elemento está no lugar errado. */
  const congelar = pedido.congelarAcimaDe
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${pedido.congelarAcimaDe}" `
      + `topLeftCell="A${pedido.congelarAcimaDe + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : "";
  const filtro = pedido.filtro
    ? `<autoFilter ref="${referencia(pedido.filtro.daColuna, pedido.filtro.linha)}:`
      + `${referencia(pedido.filtro.ateColuna, pedido.filtro.ateLinha)}"/>`
    : "";
  const codigos = pedido.colunasDeCodigo
    ? `<ignoredErrors><ignoredError sqref="${referencia(pedido.colunasDeCodigo.daColuna, pedido.colunasDeCodigo.daLinha)}:`
      + `${referencia(pedido.colunasDeCodigo.ateColuna, pedido.colunasDeCodigo.ateLinha)}" numberStoredAsText="1"/></ignoredErrors>`
    : "";

  return `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + congelar
    + (colunas ? `<cols>${colunas}</cols>` : "")
    + `<sheetData>${linhas}</sheetData>`
    + filtro
    + codigos
    + `</worksheet>`;
}

/* ── O catálogo de estilos ──────────────────────────────────────────────────
   Fontes, preenchimentos e bordas são listas numeradas, e `cellXfs` combina as
   três. Os índices estão comentados porque errar um deles não quebra nada — só
   troca a aparência, em silêncio.

   ⚠️ O SEGUNDO PREENCHIMENTO TEM DE SER `gray125`. É exigência
   do formato, não escolha: o Excel assume que o índice 1 é esse padrão, e uma
   lista sem ele desloca todos os outros preenchimentos em um. */
const ESTILOS = `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
  /* 164 é o primeiro id livre para formato personalizado; abaixo disso são os
     formatos que o Excel já traz.

     ⚠️ O FORMATO CARREGA O "R$". Sem ele a planilha mostra 23,00
     e 74,10 soltos, e quem abre precisa lembrar quais colunas são dinheiro. Com
     o símbolo no FORMATO (e não no texto), a célula continua numérica e
     somável. */
  + `<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00"/></numFmts>`
  /* 0 normal · 1 negrito · 2 título · 3 branco negrito · 4 vermelho · 5 verde · 6 nota */
  + `<fonts count="7">`
  + `<font><sz val="11"/><name val="Calibri"/></font>`
  + `<font><b/><sz val="11"/><name val="Calibri"/></font>`
  + `<font><b/><sz val="14"/><name val="Calibri"/></font>`
  + `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>`
  + `<font><b/><sz val="11"/><color rgb="FFC83A31"/><name val="Calibri"/></font>`
  + `<font><b/><sz val="11"/><color rgb="FF167A56"/><name val="Calibri"/></font>`
  + `<font><i/><sz val="10"/><color rgb="FF6B6B6B"/><name val="Calibri"/></font>`
  + `</fonts>`
  /* 0 nenhum · 1 gray125 (exigido) · 2 tinta do cabeçalho · 3 cinza do total */
  + `<fills count="4">`
  + `<fill><patternFill patternType="none"/></fill>`
  + `<fill><patternFill patternType="gray125"/></fill>`
  + `<fill><patternFill patternType="solid"><fgColor rgb="FF171717"/><bgColor indexed="64"/></patternFill></fill>`
  + `<fill><patternFill patternType="solid"><fgColor rgb="FFF1F1EE"/><bgColor indexed="64"/></patternFill></fill>`
  + `</fills>`
  /* 0 sem borda · 1 grade fina · 2 grade com traço forte em cima (linha do total) */
  + `<borders count="3">`
  + `<border><left/><right/><top/><bottom/><diagonal/></border>`
  + `<border><left style="thin"><color rgb="FFDDDDD8"/></left><right style="thin"><color rgb="FFDDDDD8"/></right>`
  + `<top style="thin"><color rgb="FFDDDDD8"/></top><bottom style="thin"><color rgb="FFDDDDD8"/></bottom><diagonal/></border>`
  + `<border><left style="thin"><color rgb="FFDDDDD8"/></left><right style="thin"><color rgb="FFDDDDD8"/></right>`
  + `<top style="medium"><color rgb="FF171717"/></top><bottom style="thin"><color rgb="FFDDDDD8"/></bottom><diagonal/></border>`
  + `</borders>`
  + `<cellStyleXfs count="1"><xf/></cellStyleXfs>`
  + `<cellXfs count="11">`
  + `<xf xfId="0"/>`
  + `<xf xfId="0" fontId="2" applyFont="1"/>`
  + `<xf xfId="0" fontId="1" applyFont="1"/>`
  + `<xf xfId="0" fontId="3" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>`
  + `<xf xfId="0" borderId="1" applyBorder="1"/>`
  + `<xf xfId="0" numFmtId="164" borderId="1" applyNumberFormat="1" applyBorder="1"/>`
  + `<xf xfId="0" numFmtId="164" fontId="4" borderId="1" applyNumberFormat="1" applyFont="1" applyBorder="1"/>`
  + `<xf xfId="0" numFmtId="164" fontId="5" borderId="1" applyNumberFormat="1" applyFont="1" applyBorder="1"/>`
  + `<xf xfId="0" fontId="1" fillId="3" borderId="2" applyFont="1" applyFill="1" applyBorder="1"/>`
  + `<xf xfId="0" numFmtId="164" fontId="1" fillId="3" borderId="2" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>`
  + `<xf xfId="0" fontId="6" applyFont="1"/>`
  + `</cellXfs></styleSheet>`;

/* ── ZIP sem compressão ─────────────────────────────────────────────────────
   O .xlsx é um ZIP. Usar o método "store" (0) dispensa deflate e mantém este
   arquivo sem dependência — o preço é o tamanho, e uma planilha de algumas
   centenas de linhas não passa de dezenas de KB. */

const TABELA_CRC = (() => {
  const tabela = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[i] = c >>> 0;
  }
  return tabela;
})();

function crc32(bytes: Uint8Array<ArrayBuffer>) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ArquivoDoZip { nome: string; bytes: Uint8Array<ArrayBuffer>; crc: number }

function zipar(arquivos: { nome: string; conteudo: string }[]) {
  const codificador = new TextEncoder();
  const preparados: ArquivoDoZip[] = arquivos.map((a) => {
    const bytes = codificador.encode(a.conteudo);
    return { nome: a.nome, bytes, crc: crc32(bytes) };
  });

  const partes: Uint8Array<ArrayBuffer>[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let deslocamento = 0;

  const numero = (valor: number, tamanho: number) => {
    const saida = new Uint8Array(tamanho);
    for (let i = 0; i < tamanho; i++) saida[i] = (valor >>> (i * 8)) & 0xff;
    return saida;
  };
  const juntar = (...pedacos: Uint8Array<ArrayBuffer>[]) => {
    const total = pedacos.reduce((soma, p) => soma + p.length, 0);
    const saida = new Uint8Array(total);
    let posicao = 0;
    for (const p of pedacos) { saida.set(p, posicao); posicao += p.length; }
    return saida;
  };

  for (const arquivo of preparados) {
    const nome = codificador.encode(arquivo.nome);
    /* ⚠️ DATA E HORA FIXAS (1980-01-01). O ZIP guarda o horário
       do arquivo; vindo do relógio, o mesmo conteúdo geraria bytes diferentes a
       cada clique — impossível comparar duas exportações, e impossível testar a
       saída. O teste confere estes dois campos, e não só a igualdade entre duas
       chamadas: duas chamadas seguidas caem no mesmo milissegundo e passariam. */
    const local = juntar(
      numero(0x04034b50, 4), numero(20, 2), numero(0, 2), numero(0, 2),
      numero(0, 2), numero(33, 2),
      numero(arquivo.crc, 4), numero(arquivo.bytes.length, 4), numero(arquivo.bytes.length, 4),
      numero(nome.length, 2), numero(0, 2), nome,
    );
    partes.push(local, arquivo.bytes);
    central.push(juntar(
      numero(0x02014b50, 4), numero(20, 2), numero(20, 2), numero(0, 2), numero(0, 2),
      numero(0, 2), numero(33, 2),
      numero(arquivo.crc, 4), numero(arquivo.bytes.length, 4), numero(arquivo.bytes.length, 4),
      numero(nome.length, 2), numero(0, 2), numero(0, 2), numero(0, 2), numero(0, 2),
      numero(0, 4), numero(deslocamento, 4), nome,
    ));
    deslocamento += local.length + arquivo.bytes.length;
  }

  const diretorio = juntar(...central);
  const fim = juntar(
    numero(0x06054b50, 4), numero(0, 2), numero(0, 2),
    numero(preparados.length, 2), numero(preparados.length, 2),
    numero(diretorio.length, 4), numero(deslocamento, 4), numero(0, 2),
  );
  return juntar(...partes, diretorio, fim);
}

/** Bytes de um .xlsx pronto. No navegador, embrulhe num `Blob` para baixar. */
export function gerarXlsx(pedido: PlanilhaPedida): Uint8Array<ArrayBuffer> {
  /* O Excel recusa nome de aba com mais de 31 caracteres ou com : \ / ? * [ ] */
  const aba = pedido.aba.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Planilha";
  return zipar([
    {
      nome: "[Content_Types].xml",
      conteudo: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
        + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
        + `<Default Extension="xml" ContentType="application/xml"/>`
        + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
        + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
        + `</Types>`,
    },
    {
      nome: "_rels/.rels",
      conteudo: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
        + `</Relationships>`,
    },
    {
      nome: "xl/workbook.xml",
      conteudo: `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
        + `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
        + `<sheets><sheet name="${escapar(aba)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      nome: "xl/_rels/workbook.xml.rels",
      conteudo: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`
        + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
        + `</Relationships>`,
    },
    { nome: "xl/styles.xml", conteudo: ESTILOS },
    { nome: "xl/worksheets/sheet1.xml", conteudo: folhaXml(pedido) },
  ]);
}
