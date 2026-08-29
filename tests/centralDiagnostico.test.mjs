import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 29/08/2026 — os TRES sinais de causa do briefing estavam quebrados e ninguem
// sabia, porque os tres eram `.catch(() => [])`:
//
//   1. "canal sem anuncio ativo"  -> funcionava
//   2. "produto que vendia e parou" -> morria no teto de tempo com o banco disputado
//   3. "ruptura de estoque"       -> NUNCA RODOU. Erro de PARSE no SQL desde
//                                    que foi escrita: `USING (workspace_id, ...)`
//                                    depois de um JOIN que ja trazia a coluna.
//
// O briefing narrava com um terco dos sinais desde sempre. Silencio por desenho
// e da mesma familia da rede de seguranca que nao conta quantas vezes salvou.
//
// Estes testes cobrem o que da para cobrir sem banco: a FORMA do SQL e o
// contrato de "falha registra". A prova de que o SQL executa e a sonda contra o
// banco real — mas um `USING` voltando aqui quebra o gate na hora.

const fonte = await readFile(new URL("../src/lib/centralDiagnostico.ts", import.meta.url), "utf8");

// Os comentarios deste arquivo CITAM o codigo velho para explicar o defeito —
// entao procurar o padrao proibido no texto cru acusaria a propria explicacao.
const codigo = fonte
  .split("\n")
  .filter((linha) => !/^\s*(\/\/|\*|\/\*)/.test(linha))
  .join("\n");

test("nenhuma consulta usa USING depois de JOIN — foi assim que o sinal 3 nunca rodou", () => {
  assert.doesNotMatch(
    codigo,
    /USING\s*\(\s*workspace_id/i,
    "USING (workspace_id, ...) depois de um JOIN que ja traz workspace_id e erro de parse: a consulta nunca roda"
  );
});

test("falha de sinal NAO e mais engolida em silencio", () => {
  assert.doesNotMatch(
    codigo,
    /\.catch\(\(\)\s*=>\s*\[\]\)/,
    "catch que devolve lista vazia sem registrar esconde consulta quebrada por tempo indeterminado"
  );
  assert.match(fonte, /console\.error\("\[briefing\] sinal de causa indisponível"/);
  // O log precisa dizer QUAL sinal e POR QUE — "falhou" sozinho nao permite agir.
  assert.match(fonte, /sinal: nome/);
  assert.match(fonte, /motivo:/);
});

test("os tres sinais passam pelo registro de falha", () => {
  const nomes = ["anuncios-ativos", "produto-parou-de-vender", "ruptura-de-estoque"];
  for (const nome of nomes) {
    assert.match(fonte, new RegExp(`sinalOuVazio\\("${nome}"`), `sinal "${nome}" fora do registro de falha`);
  }
  const chamadas = codigo.match(/sinalOuVazio\("/g) ?? [];
  assert.equal(chamadas.length, nomes.length, "ha sinal novo sem registro de falha");
});

test("ruptura conta a venda antes de olhar o estoque — senao o numero sai multiplicado", () => {
  // Medido em producao: KIT2-ARR-G-CINZA_ML tem 2 anuncios com o mesmo SKU e
  // saia com 1328 vendas quando o real sao 664. Juntar produto com item por SKU
  // ANTES de agregar multiplica a venda pelo numero de anuncios que dividem o SKU.
  const ruptura = fonte.slice(fonte.indexOf('sinalOuVazio("ruptura-de-estoque"'));
  assert.match(ruptura, /WITH vendas AS/, "a agregacao de vendas precisa vir antes do produto");
  assert.match(ruptura, /NOT EXISTS/, "so e ruptura se NENHUM anuncio do SKU tiver estoque");
  assert.doesNotMatch(
    ruptura.slice(0, ruptura.indexOf("GROUP BY i.provider")),
    /JOIN workspace_channel_products/,
    "produto entrando no join antes da agregacao volta a multiplicar a venda"
  );
});

test("SKU vazio nao vira sinal", () => {
  // Agrupar por SKU vazio junta produtos diferentes e o NEXO diria
  // "o produto  parou de vender".
  const ocorrencias = fonte.match(/NULLIF\(TRIM\((?:i|p)\.sku\), ''\) IS NOT NULL/g) ?? [];
  assert.ok(ocorrencias.length >= 2, "os sinais por SKU precisam descartar SKU vazio");
});

test("ruptura exige anuncio ATIVO — zero de anuncio que a fonte nao reportou nao e ruptura", () => {
  // 29/08/2026, no mesmo dia em que o sinal nasceu: os tres primeiros da lista
  // eram anuncios com provider_status NOT_PRESENT_IN_COMPLETE_SNAPSHOT — a
  // Shopee nao devolveu o anuncio no snapshot e o NOSSO codigo escreveu
  // available_qty = 0. Zero fabricado em cima de desconhecido. Sao 435 dos 739
  // anuncios da Shopee dela nesse estado.
  //
  // available_qty e NOT NULL: a coluna nao consegue dizer "nao sei". Exigir
  // status 'active' e o que separa o zero que e FATO do zero que e ignorancia.
  const ruptura = fonte.slice(fonte.indexOf('sinalOuVazio("ruptura-de-estoque"'));
  const consulta = ruptura.slice(0, ruptura.indexOf("LIMIT 5"));
  assert.match(
    consulta,
    /p\.status = 'active' AND p\.available_qty = 0/,
    "sem exigir anuncio ativo, o sinal chama de ruptura o anuncio que sumiu do snapshot"
  );
});
