import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { periodoNaUrl } from "../src/app/components/periodoNaUrl.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

// O DEFEITO QUE ESTE ARQUIVO REPROVA (revisao da aba de Ads, 31/08/2026):
// `/ads` chamava `useDashboardPeriod()` SEM argumento. O hook so le a URL pelo
// primeiro parametro e so avisa a tela pelo segundo, entao:
//   • `/ads?days=30` abria em "Hoje", descartando o pedido em silencio;
//   • clicar num preset nao mudava o endereco. Num periodo em que os quatro
//     canais estao sem dado, a tela fica IDENTICA — o botao funciona e parece
//     morto. Foi lido na revisao como "nenhum botao de periodo funciona".
//
// A familia do erro e a mesma do `from`/`to` da Shopee: existia o simbolo, nao
// existia o uso.

test("preset entra na URL e limpa o intervalo personalizado", () => {
  assert.equal(periodoNaUrl("", "days=30"), "days=30");
  // Trocar de personalizado para preset nao pode deixar from/to para tras: o
  // servidor prefere from/to e mostraria o periodo antigo sob o botao novo.
  assert.equal(periodoNaUrl("from=2026-08-01&to=2026-08-10", "days=7"), "days=7");
});

test("intervalo personalizado entra na URL e limpa o preset", () => {
  assert.equal(periodoNaUrl("days=30", "from=2026-08-01&to=2026-08-10"), "from=2026-08-01&to=2026-08-10");
});

test("intervalo pela metade nao vira intervalo — cai no preset", () => {
  // `resolvePeriod` so aceita from E to. Meio intervalo na URL seria um estado
  // que o servidor ignora e o filtro exibe, e os dois discordariam.
  assert.equal(periodoNaUrl("", "from=2026-08-01"), "days=today");
});

test("o que nao e periodo sobrevive", () => {
  const proxima = new URLSearchParams(periodoNaUrl("connection_id=abc&days=today", "days=15"));
  assert.equal(proxima.get("connection_id"), "abc");
  assert.equal(proxima.get("days"), "15");
});

test("a aba de Ads LIGA o filtro na URL — os dois argumentos, nao so o import", async () => {
  const pagina = await fonte("src/app/ads/page.tsx");

  // Casar a CHAMADA COM ARGUMENTOS, nao o identificador: `useDashboardPeriod`
  // aparece no import de qualquer jeito, e foi exatamente assim que a chamada
  // surda passou despercebida.
  assert.match(
    pagina,
    /useDashboardPeriod\(\s*searchParams\.toString\(\),/,
    "a aba de Ads voltou a ignorar o ?days= do endereco",
  );
  assert.match(
    pagina,
    /router\.push\(`\$\{location\.pathname\}\?\$\{periodoNaUrl\(searchParams\.toString\(\), query\)\}`/,
    "clicar num preset voltou a nao mudar o endereco",
  );

  // A chamada sem argumento e o defeito em pessoa: se ela reaparecer, o resto
  // acima pode continuar verde num trecho morto.
  assert.ok(
    !/useDashboardPeriod\(\)/.test(pagina),
    "voltou a existir uma chamada surda de useDashboardPeriod() em /ads",
  );

  // `useSearchParams` sem fronteira de Suspense quebra o build da rota.
  assert.match(pagina, /<Suspense fallback=\{<InlineLoading[\s\S]{0,120}<Ads \/>/);
});
