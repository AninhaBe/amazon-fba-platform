import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// NF-e da Shopee (decisão da Ana, 28/08/2026): pedido travado por nota vira
// pendência visível com número, motivo (quando a Shopee o manda) e link.
// Regra dura: nota pendente BLOQUEIA o envio na Shopee desde 29/07/2026.

test("o detalhe do pedido passa a PEDIR invoice_data — campo opcional não vem de graça", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/shopee.ts", import.meta.url), "utf8");
  const bloco = fonte.slice(fonte.indexOf("getShopeeOrderDetail"));
  assert.match(bloco.slice(0, 1200), /"invoice_data",/, "response_optional_fields precisa listar invoice_data");
});

test("o sanitize guarda SÓ status e motivo da NF-e — e registra a condição de retenção", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/shopeeCanonical.ts", import.meta.url), "utf8");
  // Sub-allowlist explícito: nada além de status + pending_reason entra em raw.
  assert.match(fonte, /invoice_data: order\.invoice_data == null \? undefined : \{\s*status: order\.invoice_data\.status,\s*pending_reason: order\.invoice_data\.pending_reason,\s*\}/);
  // Condição registrada pelo cérebro: a tela lê raw; o expurgo do ADR-026/R2-b
  // precisa poupar estes campos (ou migrá-los para coluna) — no código e no ADR.
  assert.match(fonte, /RETENÇÃO.*ADR-026\/R2-b/s);
  const adr = await readFile(new URL("../docs/adr/ADR-026-camadas-por-ciclo-de-vida.md", import.meta.url), "utf8");
  assert.match(adr, /NF-e da Shopee lê `raw`/);
});

test("a contagem é operacional: sem recorte de período, só pedidos vivos, motivo nunca inventado", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/shopeeOverviewCanonical.ts", import.meta.url), "utf8");
  // lastIndexOf: o doc do tipo usa a mesma frase; a query vem depois.
  const inicio = fonte.lastIndexOf("NF-e pendente AGORA");
  assert.ok(inicio > -1, "a query da NF-e existe e explica por que ignora o período");
  const query = fonte.slice(inicio, inicio + 900);
  assert.match(query, /raw #>> '\{invoice_data,status\}' = 'pending'/);
  assert.match(query, /status = 'paid'/);
  assert.doesNotMatch(query, /occurred_at/, "pendência operacional não tem filtro de período");
  // Motivo vazio vira null (NULLIF), nunca string fabricada.
  assert.match(query, /NULLIF\(TRIM\(raw #>> '\{invoice_data,pending_reason\}'\), ''\)/);
});

test("a faixa aparece só com contagem real, mostra motivo apenas se a Shopee mandou, e tem link", async () => {
  const fonte = await readFile(new URL("../src/app/components/ShopeeWorkspace.tsx", import.meta.url), "utf8");
  assert.match(fonte, /\(overview\.notasPendentes\?\.pedidos \?\? 0\) > 0 &&/, "sem pedido pendente, nada na tela");
  assert.match(fonte, /pedido\(s\) aguardando NF-e — a Shopee bloqueia o envio/);
  assert.match(fonte, /motivos\.some\(\(item\) => item\.motivo != null\)/, "motivo ausente não vira frase");
  assert.match(fonte, /aguardando NF-e[\s\S]{0,700}?href="\/shopee\/monitor"/, "pendência com link");
  // Regra da casa: nada de "parcial" se desculpando na tela.
  assert.doesNotMatch(fonte.slice(fonte.indexOf("aguardando NF-e"), fonte.indexOf("aguardando NF-e") + 600), /parcial/i);
});
