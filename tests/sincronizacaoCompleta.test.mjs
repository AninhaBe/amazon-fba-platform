import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { chaveDeAvisoSincronizada } from "../src/lib/coberturaPeriodo.ts";

test("a chave do dismiss é uma por conexão — o aviso aparece uma vez e não volta", () => {
  // O histórico de conta nova é o mês vigente e cresce para frente (decisão da
  // Ana, 27/08/2026): sem aprofundamento retroativo, não há motivo para o
  // aviso reaparecer depois do dismiss.
  assert.equal(chaveDeAvisoSincronizada("shopee:123"), "nexo:sync-completa:shopee:123");
  assert.notEqual(chaveDeAvisoSincronizada("shopee:123"), chaveDeAvisoSincronizada("shopee:456"));
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
    "../src/app/(app)/amazon/page.tsx",
  ];
  for (const tela of telas) {
    const fonte = await readFile(new URL(tela, import.meta.url), "utf8");
    assert.match(fonte, /<SincronizacaoCompleta/, `${tela} não renderiza o aviso`);
  }
});
