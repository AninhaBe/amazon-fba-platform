import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

// Conexão de demonstração nunca pode ir para a API real: o token é sintético,
// cada tentativa grava erro no sync, e o erro aparece na frente do dashboard da
// conta que existe justamente para ser mostrada a um revisor.
//
// Medido em 27/08/2026, antes desta correção: `mercado_livre:demo` estava em
// `status=error` ("sem refresh token") nos dois workspaces demo, e a consulta do
// cron da Amazon trazia `amazon:demo` duas vezes no lote.

const PREDICADO = /metadata->'demo' IS DISTINCT FROM 'true'::jsonb/;

const CANAIS = [
  { canal: "Shopee", arquivo: "src/lib/integrations/shopeeScheduler.ts", ocorrencias: 1 },
  { canal: "Mercado Livre", arquivo: "src/lib/integrations/mercadoLivreScheduler.ts", ocorrencias: 2 },
  { canal: "Amazon", arquivo: "src/lib/integrations/amazonScheduler.ts", ocorrencias: 1 },
];

for (const { canal, arquivo, ocorrencias } of CANAIS) {
  test(`${canal}: conexão demo fica fora da seleção do cron`, () => {
    const fonteDoCanal = fonte(arquivo);
    assert.match(fonteDoCanal, PREDICADO, `${canal} precisa filtrar conexão demo`);
    const encontradas = fonteDoCanal.match(new RegExp(PREDICADO.source, "g"))?.length ?? 0;
    // O ML tem DUAS consultas de candidatos (pendentes/erro e revalidação do
    // que está completo). Filtrar só uma deixaria a demo entrar pela outra.
    assert.equal(encontradas, ocorrencias, `${canal}: o filtro precisa estar nas ${ocorrencias} consulta(s) de candidatos`);
  });
}

test("Amazon usa LEFT JOIN: conexão real não tem linha em workspace_integrations", () => {
  // Medido em 27/08/2026: as três contas Amazon vivas existem só em
  // `workspace_marketplace_syncs`. Com JOIN interno, o filtro derrubaria todas —
  // a correção pararia o sync real em silêncio, que é pior que o defeito.
  const amazon = fonte("src/lib/integrations/amazonScheduler.ts");
  const consulta = amazon.slice(amazon.indexOf("`SELECT sync.workspace_id"), amazon.indexOf("`", amazon.indexOf("`SELECT sync.workspace_id") + 1));
  assert.match(consulta, /LEFT JOIN workspace_integrations integration/);
  assert.doesNotMatch(consulta, /\n\s+JOIN workspace_integrations/, "join interno derrubaria as conexões reais");
});

test("TikTok filtra pelo prefixo do shop_id, porque a conexão dele mora em outra tabela", () => {
  const tiktok = fonte("src/lib/integrations/tiktokScheduler.ts");
  assert.match(tiktok, /DEMO_SHOP_PREFIX = "demo-%"/);
  assert.match(tiktok, /shop\.shop_id NOT LIKE \$3/);
  // `workspace_tiktok_shops` não tem coluna de metadata; por isso o predicado
  // dos outros três não serve aqui.
  assert.doesNotMatch(tiktok, PREDICADO);
});

test("o filtro só remove demo: identificador real nunca casa com o marcador", () => {
  const ehDemo = (connectionId) => connectionId.endsWith(":demo") || connectionId.includes(":demo-");
  for (const real of [
    "amazon:AO62LVXJMX3AA", "amazon:A15NQMF7A6J1Y0", "amazon:A16J64DRXI7OAU",
    "mercado_livre:648425194", "mercado_livre:1191100170",
    "tiktok_shop:7494291387899806731",
  ]) {
    assert.equal(ehDemo(real), false, `${real} é conexão viva e não pode ser pulada`);
  }
  for (const demo of ["amazon:demo", "mercado_livre:demo", "shopee:demo", "tiktok_shop:demo-tiktok-shop"]) {
    assert.equal(ehDemo(demo), true, `${demo} é do seed e tem que ficar fora do cron`);
  }
});
