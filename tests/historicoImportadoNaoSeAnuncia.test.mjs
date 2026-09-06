import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
/**
 * ⚠️ NORMALIZA A QUEBRA DE LINHA ANTES DE QUALQUER COISA. Sem isso, uma
 * assercao que casa "algo" + QUEBRA passa nos arquivos gravados em LF e falha
 * nos gravados em CRLF — e a arvore tem os dois. Descoberto ao rodar a quebra:
 * a mesma assercao passava em tres canais e reprovava a Shopee, que esta em
 * CRLF. E a familia "CRLF vira no-op" do catalogo, do outro lado.
 */
const semComentarios = (codigo) =>
  codigo
    .split(String.fromCharCode(13)).join("")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const QUEBRA = String.fromCharCode(10);
const BASE = "src/app/components/BaseDeData.tsx";
const TELAS = [
  "src/app/(app)/amazon/page.tsx",
  "src/app/components/MercadoLivreWorkspace.tsx",
  "src/app/components/ShopeeWorkspace.tsx",
  "src/app/components/TikTokWorkspace.tsx",
];

/**
 * ⚠️ ESTADO BOM NÃO É NOTÍCIA — segunda aplicação da mesma doutrina.
 *
 * Em 02/09/2026 saiu o banner de "100% sincronizada". Em 06/09/2026 saiu a
 * frase "Histórico 99% importado — os números abaixo já estão disponíveis",
 * pelo mesmo motivo e com as mesmas palavras dela: *"esse dado aqui não tem
 * relevância alguma, nossa arquitetura tem que ter todos os dados, estamos
 * assumindo isso"*.
 *
 * ⚠️ MAS A PEÇA NÃO SAIU INTEIRA, e é isso que este arquivo protege dos dois
 * lados. Ela tinha DOIS estados no mesmo componente:
 *
 *   sem `cobreDesde` -> "N% importado, os números abaixo já estão disponíveis".
 *     O período está coberto; o percentual fala de um backfill que não muda
 *     nenhum número da tela. Anúncio de estado bom — SAIU.
 *
 *   com `cobreDesde` -> "os números cobrem a partir de DD/MM". Os números na
 *     tela NÃO cobrem o período pedido. É o que separa "não vendeu" de "não
 *     importei" — FICOU, e tem de continuar ficando.
 *
 * Consertar não é remover: a metade que informava permanece.
 */

test("a frase do estado bom nao existe mais no codigo", async () => {
  // ⚠️ SEM COMENTÁRIOS, obrigatoriamente: a nota que explica a remoção CITA
  // a frase removida. Esta é a armadilha que o AGENTS.md documenta e que já
  // pegou este projeto quatro vezes — proibição sempre lê o fonte limpo.
  const codigo = semComentarios(await fonte(BASE));
  for (const frase of ["já estão disponíveis", "ja estao disponiveis"]) {
    assert.ok(!codigo.includes(frase), `a comemoração do estado bom voltou: "${frase}"`);
  }
});

test("sem periodo descoberto, a faixa nao aparece — nem so a barrinha", async () => {
  const codigo = semComentarios(await fonte(BASE));
  // ⚠️ O PORTÃO É `cobreDesde`, não `progresso`. Se voltasse a ser
  // `!temProgresso && !cobreDesde`, a faixa reapareceria em toda conta com
  // backfill em andamento — que é o caso que ela mandou tirar. E a barra
  // sozinha seria a mesma comemoração, sem as palavras.
  assert.ok(codigo.includes("if (!cobreDesde) return null;"),
    "o portão da faixa deixou de ser o período descoberto: o anúncio do estado bom volta");
});

test("o que e INCOMPLETO continua avisando — as duas clausulas", async () => {
  // Se esta asserção cair junto com as de cima, alguém removeu demais: sobrou a
  // tela em silêncio sobre números que não cobrem o período pedido.
  const codigo = semComentarios(await fonte(BASE));
  assert.ok(codigo.includes("os números abaixo cobrem a partir de"),
    "o aviso de período descoberto sumiu — 'não vendeu' e 'não importei' voltam a se confundir");
  // As duas dizem coisas DIFERENTES: uma promete mais histórico, a outra diz
  // que não vem mais. Colapsar as duas apaga a distinção.
  assert.ok(codigo.includes("o início do período ainda está sendo importado"),
    "a clausula de importacao EM CURSO sumiu — o progresso legitimo foi junto com o anuncio");
  assert.ok(codigo.includes("o histórico importado começa aí"),
    "a clausula de historico que NAO vai crescer sumiu");
});

test("os quatro canais continuam montando a peca — nada ficou orfao", async () => {
  // ⚠️ A PEÇA É COMPARTILHADA, então a correção de um canal chega aos
  // quatro por construção. O risco aqui é o oposto: alguém "limpar" o import de
  // um canal e deixar aquele sem o aviso de período descoberto.
  for (const tela of TELAS) {
    const codigo = semComentarios(await fonte(tela));
    // ⚠️ COM O DELIMITADOR, e a primeira versao NAO tinha. Ela casava
    // `includes("<ProgressoDaImportacao")`, que e PREFIXO de
    // `<ProgressoDaImportacaoRemovido` — a quebra que renomeia a peca ficou
    // VERDE. Quarta vez que casamento por prefixo passa batido neste projeto;
    // nas quatro telas a tag abre com quebra de linha logo apos o nome.
    assert.ok(codigo.includes("<ProgressoDaImportacao" + QUEBRA),
      `${tela}: parou de montar a faixa — este canal ficou mudo sobre periodo descoberto`);
  }
});
