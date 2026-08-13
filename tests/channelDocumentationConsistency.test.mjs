import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PROVIDERS } from "../src/lib/integrations/registry.ts";

test("documentação, registry e navegação refletem as capacidades TikTok e Shopee implementadas", async () => {
  const [state, docsReadme, canonicalSchema, integrationsArchitecture, overview, syncEngine, agentHarness, workflow, nav] = await Promise.all([
    readFile(new URL("../docs/estado-atual.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/canonical-schema.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/integrations-architecture.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/architecture/overview.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/architecture/sync-engine.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/ai-agent-harness.md", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/cron.yml", import.meta.url), "utf8"),
    readFile(new URL("../src/app/components/Nav.tsx", import.meta.url), "utf8"),
  ]);
  const provider = PROVIDERS.find((item) => item.id === "tiktok_shop");
  assert.equal(provider?.availability, "available");
  for (const capability of ["catalog", "orders", "inventory", "finance"]) {
    assert.ok(provider?.capabilities.includes(capability), `capability ${capability}`);
  }
  assert.doesNotMatch(state, /não existe sync, cron nem overview|a ingestão não existe/);
  assert.match(state, /sync paginado, cron, modelo canônico e overview estão implementados/);
  assert.match(state, /conciliação financeira real segue parcial/);
  assert.doesNotMatch(docsReadme, /TikTok Shop[^\n]*(?:backlog|aguardando credenciais)/i);
  assert.match(docsReadme, /OAuth, sync, cron e leitura canônica implementados/);
  for (const file of [overview, syncEngine]) {
    assert.match(file, /tiktokSync\.ts/);
    assert.match(file, /tiktokScheduler\.ts/);
    assert.match(file, /validação financeira real[\s\S]{0,80}parcial/i);
  }
  assert.match(overview, /tiktokOverviewCanonical\.ts/);
  assert.match(syncEngine, /\/api\/cron\/tiktok-sync/);
  assert.match(workflow, /sync-tiktok:[\s\S]*\/api\/cron\/tiktok-sync/);
  for (const route of ["/tiktok/monitor", "/tiktok/catalogo", "/tiktok/produtos", "/tiktok/estoque", "/tiktok/abc"]) {
    assert.match(nav, new RegExp(route));
  }

  const shopee = PROVIDERS.find((item) => item.id === "shopee");
  assert.equal(shopee?.availability, "available");
  for (const capability of ["catalog", "orders", "inventory", "finance"]) {
    assert.ok(shopee?.capabilities.includes(capability), `Shopee capability ${capability}`);
  }
  assert.match(state, /Go Live submetido em 07\/08, em análise/i);
  assert.doesNotMatch(state, /Shopee Go Live[^\n]*(?:depende[^\n]*ser submetido|aguarda(?:ndo)? submissão)/i);
  assert.match(canonicalSchema, /Shopee → canônico \(implementado e testado em sandbox\)/);
  assert.doesNotMatch(canonicalSchema, /Shopee → canônico \(quando chegar\)/i);
  assert.match(integrationsArchitecture, /Shopee no mesmo contrato\.[\s\S]{0,100}Concluído/i);
  assert.doesNotMatch(integrationsArchitecture, /(?:^|\n)\s*\d+\. Implementar Shopee no mesmo contrato\./im);
  assert.match(agentHarness, /Shopee já está implementada e testada em sandbox/i);
  assert.match(agentHarness, /validação Live[\s\S]{0,160}(?:Go Live|credenciais de produção)/i);
  assert.doesNotMatch(
    agentHarness,
    /futuramente[^\n]*(?:Shopee|TikTok)|(?:Shopee|TikTok)[^\n]*(?:quando chegar|for retomad[ao]|não implementad[ao]|a implementar)/i,
  );
  for (const file of [overview, syncEngine]) {
    assert.match(file, /shopeeSync\.ts/);
    assert.match(file, /shopeeScheduler\.ts/);
    assert.match(file, /validação Live[\s\S]{0,160}(?:Go Live|credenciais)/i);
  }
  assert.match(overview, /shopeeOverviewCanonical\.ts/);
  assert.match(syncEngine, /\/api\/cron\/shopee-sync/);
  assert.match(workflow, /sync-shopee:[\s\S]*\/api\/cron\/shopee-sync/);
  for (const route of ["/shopee/monitor", "/shopee/catalogo", "/shopee/produtos", "/shopee/estoque", "/shopee/abc"]) {
    assert.match(nav, new RegExp(route));
  }
});
