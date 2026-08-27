import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { chaveDeAvisoSincronizada, mesesDeHistorico } from "../src/lib/coberturaPeriodo.ts";

const DAY = 86_400_000;
const now = 1_700_000_000_000;

test("meses de histórico saem do span coberto, nunca menos de 1 com cobertura real", () => {
  assert.equal(mesesDeHistorico(new Date(now - 60 * DAY).toISOString(), new Date(now).toISOString()), 2);
  assert.equal(mesesDeHistorico(new Date(now - 366 * DAY).toISOString(), new Date(now).toISOString()), 12);
  assert.equal(mesesDeHistorico(new Date(now - 10 * DAY).toISOString(), new Date(now).toISOString()), 1);
  assert.equal(mesesDeHistorico(null, new Date(now).toISOString()), null);
  assert.equal(mesesDeHistorico(new Date(now).toISOString(), new Date(now - DAY).toISOString()), null);
});

test("a chave do dismiss inclui os meses — aprofundar o alvo reexibe o aviso com o número novo", () => {
  const antes = chaveDeAvisoSincronizada("shopee:123", 2);
  const depois = chaveDeAvisoSincronizada("shopee:123", 12);
  assert.notEqual(antes, depois);
  assert.match(antes, /^nexo:sync-completa:shopee:123:/);
});

test("o aviso é derivado do estado, com dismiss em localStorage e a limitação documentada", async () => {
  const componente = await readFile(new URL("../src/app/components/SincronizacaoCompleta.tsx", import.meta.url), "utf8");
  assert.match(componente, /status !== "complete"/);
  assert.match(componente, /localStorage/);
  // Trade-off aceito em 27/08/2026: o dismiss não acompanha entre dispositivos.
  assert.match(componente, /Limitação aceita/);
  assert.match(componente, /entre dispositivos/);
});

test("os quatro dashboards exibem o aviso de sincronização completa", async () => {
  const telas = [
    "../src/app/components/ShopeeWorkspace.tsx",
    "../src/app/components/MercadoLivreWorkspace.tsx",
    "../src/app/components/TikTokWorkspace.tsx",
    "../src/app/amazon/page.tsx",
  ];
  for (const tela of telas) {
    const fonte = await readFile(new URL(tela, import.meta.url), "utf8");
    assert.match(fonte, /<SincronizacaoCompleta/, `${tela} não renderiza o aviso`);
  }
});
