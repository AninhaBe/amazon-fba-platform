import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (codigo) =>
  codigo.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * ⚠️ ESTE TESTE MUDOU DE INTENCAO EM 02/09/2026, e a inversao e o ponto.
 *
 * Ele EXIGIA o aviso "Sua loja esta 100% sincronizada" nos quatro dashboards, e
 * garantia o dismiss em localStorage. A dona do produto mandou tirar, verbatim:
 * *"essa informacao nao e importante pq estamos assumindo que tudo ja esta
 * sincronizado"*.
 *
 * A REGRA QUE FICA, e ela e maior que este caso: ESTADO NORMAL NAO GERA AVISO.
 * Celebrar o normal e ruido — e ruido treina a pessoa a ignorar a faixa no dia
 * em que ela diz algo. Aviso so existe quando ha o que fazer ou o que esperar.
 *
 * O QUE CONTINUA APARECENDO, e por isso a remocao nao perde informacao:
 *   - periodo fora do historico importado -> `coberturaDoPeriodo` mostra o
 *     estado vazio com a data de inicio ("nao vendeu" != "nao importei");
 *   - importacao em andamento -> `ProgressoDaImportacao`;
 *   - sync parado ou com erro -> `AvisoDeSyncInterrompido` / takeover de
 *     conexao caida.
 * Os tres sao INCOMPLETUDE. O que saiu foi so a comemoracao do completo.
 */

test("o aviso de '100% sincronizada' NAO volta a nenhum dashboard", async () => {
  const telas = [
    "src/app/(app)/amazon/page.tsx",
    "src/app/components/MercadoLivreWorkspace.tsx",
    "src/app/components/ShopeeWorkspace.tsx",
    "src/app/components/TikTokWorkspace.tsx",
  ];
  for (const tela of telas) {
    // A proibicao le o fonte SEM COMENTARIOS: a nota que explica a remocao cita
    // o nome removido (caso 1 do catalogo de ancoragem).
    const codigo = semComentarios(await fonte(tela));
    assert.ok(!/SincronizacaoCompleta/.test(codigo), `${tela}: o aviso do estado normal voltou`);
    assert.ok(!/100% sincronizad/i.test(codigo), `${tela}: a frase do estado normal voltou`);
  }
});

test("e a peca nao existe mais na arvore — nem para ser importada por engano", async () => {
  const componentes = await readdir(new URL("../src/app/components/", import.meta.url));
  assert.ok(!componentes.includes("SincronizacaoCompleta.tsx"), "a peca voltou para a arvore");
});

test("o que e INCOMPLETO continua avisando — a remocao nao calou os tres estados", async () => {
  // Se esta assercao cair junto com a de cima, alguem apagou aviso demais.
  const shopee = semComentarios(await fonte("src/app/components/ShopeeWorkspace.tsx"));
  assert.match(shopee, /coberturaDoPeriodo\(\{/, "o estado de periodo nao importado sumiu");
  const tiktok = semComentarios(await fonte("src/app/components/TikTokWorkspace.tsx"));
  assert.match(tiktok, /syncPhase === "retryable_error"/, "o aviso de sync com erro sumiu");
  const base = semComentarios(await fonte("src/app/components/BaseDeData.tsx"));
  assert.match(base, /ProgressoDaImportacao/, "o progresso da importacao sumiu");
});
