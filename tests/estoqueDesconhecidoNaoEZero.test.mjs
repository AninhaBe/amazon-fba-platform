import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { classificarCobertura, ORDEM_DO_RADAR, ROTULO_DE_COBERTURA } from "../src/lib/coberturaDeEstoque.ts";

// ADR-033 — 29/08/2026. `available_qty` era `integer NOT NULL DEFAULT 0`, entao a
// coluna NAO CONSEGUIA dizer "nao sei". Tres estados chegavam a toda leitura como
// o mesmo zero, e so um era fato:
//   · a fonte devolveu o anuncio e informou 0  -> FATO
//   · a varredura nao devolveu o anuncio       -> ignorancia escrita como 0
//   · nunca sincronizamos este produto         -> nem linha existe
//
// Tamanho medido: 435 dos 747 anuncios da Shopee (58% do catalogo) e 30 dos 33
// zeros do TikTok (91%). Consequencia real: o briefing ia anunciar cinco produtos
// como "estoque ZERO"; TRES eram zero fabricado.
//
// ⚠️ ESTE TESTE NAO CONFERE "AS SETE SUPERFICIES TRATAM NULL". Ele PROIBE O
// IDIOMA que fabrica o zero — para que a OITAVA superficie, escrita amanha por
// alguem que nunca leu o ADR, quebre o portao em vez de nascer mentindo.

const RAIZ = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/**
 * O unico lugar onde `available_qty ?? 0` seria legitimo seria a ESCRITA de um
 * valor que a fonte informou. Nao ha nenhum hoje — e se aparecer, tem que vir
 * com motivo escrito aqui, como a allowlist do workspace_id.
 */
const FABRICA_ZERO_PERMITIDO = [];

async function arquivosTs(dir) {
  const encontrados = [];
  for (const entrada of await readdir(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, entrada.name);
    if (entrada.isDirectory()) encontrados.push(...(await arquivosTs(caminho)));
    else if (/\.tsx?$/.test(entrada.name)) encontrados.push(caminho);
  }
  return encontrados;
}

const semComentario = (fonte) =>
  fonte
    .split("\n")
    .filter((linha) => !/^\s*(\/\/|--|\*|\/\*)/.test(linha))
    .join("\n");

test("ninguem transforma estoque desconhecido em zero", async () => {
  // `x ?? 0`, `x || 0` e `COALESCE(available_qty, 0)` sao as tres formas de
  // escrever a mentira. Qualquer uma delas devolve "a fonte disse zero" para uma
  // pergunta que a fonte nao respondeu.
  const idiomas = [
    /available_?[Qq]ty\s*\?\?\s*0/,
    /available_?[Qq]ty\s*\|\|\s*0/,
    /COALESCE\(\s*\w*\.?available_qty\s*,\s*0\s*\)/i,
    /Number\(\s*\w+\.available_qty\s*\?\?\s*0\s*\)/,
  ];
  const culpados = [];
  for (const arquivo of await arquivosTs(RAIZ)) {
    const relativo = path.relative(RAIZ, arquivo);
    if (FABRICA_ZERO_PERMITIDO.includes(relativo)) continue;
    const codigo = semComentario(await readFile(arquivo, "utf8"));
    for (const idioma of idiomas) {
      const achado = codigo.match(idioma);
      if (achado) culpados.push(`${relativo}: ${achado[0]}`);
    }
  }
  assert.deepEqual(
    culpados,
    [],
    "estoque desconhecido virando zero — a fonte nao disse isso:\n" + culpados.join("\n")
  );
});

test("classificarCobertura devolve 'desconhecido' ANTES de qualquer outra coisa", () => {
  // Sem estoque conhecido nao da para dizer "esgotado" nem "saudavel": as duas
  // seriam afirmacao sobre o que ninguem informou. E "esgotado" e a pior das
  // duas, porque vira alarme de reposicao para produto que talvez esteja cheio.
  assert.equal(classificarCobertura({ disponivel: null, porDia: 0, diasRestantes: null }), "desconhecido");
  assert.equal(classificarCobertura({ disponivel: null, porDia: 5, diasRestantes: 2 }), "desconhecido");
  assert.equal(classificarCobertura({ disponivel: null, porDia: 5, diasRestantes: 999 }), "desconhecido");
  // E o zero REPORTADO continua sendo "esgotado", que e fato.
  assert.equal(classificarCobertura({ disponivel: 0, porDia: 1, diasRestantes: 0 }), "out");
});

test("'desconhecido' e o ULTIMO do radar — nao e urgencia, e lacuna", () => {
  const ordens = Object.values(ORDEM_DO_RADAR);
  assert.equal(ORDEM_DO_RADAR.desconhecido, Math.max(...ordens));
  assert.ok(ORDEM_DO_RADAR.desconhecido > ORDEM_DO_RADAR.out);
  assert.ok(ORDEM_DO_RADAR.desconhecido > ORDEM_DO_RADAR.critical);
});

test("o rotulo diz o que E, nao pede desculpa", () => {
  // Regra da casa: "parcial", "incompleto" e qualquer adjetivo que se desculpe
  // sao proibidos. A pessoa ja sabe que falta algo — ela precisa saber O QUE.
  const rotulo = ROTULO_DE_COBERTURA.desconhecido;
  assert.doesNotMatch(rotulo, /parcial|incomplet|indisponív|desculp/i);
  assert.equal(rotulo, "Estoque não informado");
});

test("a tela diz QUANTOS, de QUAL canal e de QUANDO — com caminho", async () => {
  const componente = await readFile(new URL("../src/app/components/FiltroDeAtividade.tsx", import.meta.url), "utf8");
  const aviso = componente.slice(componente.indexOf("export function AvisoDeEstoqueNaoInformado"));
  assert.match(aviso, /sem estoque confirmado pel/, "a frase precisa dizer o que falta");
  assert.match(aviso, /última varredura de catálogo/, "precisa dizer DE QUANDO e a varredura");
  assert.match(aviso, /\{anuncios\}/, "precisa do numero");
  assert.match(aviso, /\{canal\}/, "precisa dizer de qual canal");
  assert.match(aviso, /Ver quais/, "precisa de caminho, nao so de constatacao");
  // Zero nao vira frase: "0 anuncios sem estoque" e ruido.
  assert.match(aviso, /if \(!anuncios \|\| anuncios <= 0\) return null/);
  assert.doesNotMatch(aviso, /parcial|incomplet/i);
});

test("o item que sai da lista de capital parado e CONTADO, nao sumido", async () => {
  // A pior das sete superficies: `availableQty > 0` fazia o item DESAPARECER da
  // lista de capital parado sem deixar rastro. Erro que aparece a gente
  // conserta; erro que some ninguem procura — e capital parado e dinheiro dela.
  const full = await readFile(new URL("../src/lib/integrations/mercadoLivreFullStock.ts", import.meta.url), "utf8");
  assert.match(full, /ofertasSemEstoqueConhecido: number;/);
  assert.match(full, /const semEstoqueConhecido = ofertas\.filter\(\(item\) => item\.availableQty == null\)\.length/);
  assert.match(full, /item\.availableQty != null && item\.availableQty > 0/);
});

test("NENHUMA varredura escreve quantidade para item que ela nao encontrou", async () => {
  // ⚠️ ESTE TESTE NASCEU DE UMA FALHA MINHA, 29/08/2026: eu consertei as SETE
  // superficies de LEITURA e subi, e o backfill de 465 linhas foi DESFEITO em
  // minutos — o sync do TikTok rodou e reescreveu os 30 de volta para zero,
  // porque o ESCRITOR continuava fabricando.
  //
  // O dado percebeu antes de qualquer teste: fui conferir a frase da tela e os
  // nulos do TikTok eram ZERO de novo. Ler o banco depois de subir e o que
  // separou "consertei" de "achei que tinha consertado".
  //
  // A regra: quem nao encontra um item pode mudar o STATUS dele, nunca os
  // NUMEROS dele.
  const varreduras = [
    "../src/lib/integrations/shopeeSync.ts",
    "../src/lib/integrations/tiktokSync.ts",
  ];
  for (const caminho of varreduras) {
    const fonte = semComentario(await readFile(new URL(caminho, import.meta.url), "utf8"));
    const marca = fonte.indexOf("NOT_PRESENT_IN_COMPLETE_SNAPSHOT");
    assert.ok(marca > -1, `${caminho} nao marca item ausente do snapshot`);
    const bloco = fonte.slice(marca, marca + 600);
    assert.doesNotMatch(
      bloco,
      /available_qty\s*=\s*0/,
      `${caminho} escreve quantidade ZERO para item que a fonte nao devolveu — isso e inventar dado`
    );
    assert.match(
      bloco,
      /available_qty\s*=\s*NULL/i,
      `${caminho} precisa gravar NULL: a fonte nao informou a quantidade`
    );
  }
});
