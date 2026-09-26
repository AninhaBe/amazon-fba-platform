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
  // A trava é sobre as CAPACIDADES estarem declaradas como implementadas, não
  // sobre a frase exata. A versão anterior casava uma sentença literal e
  // quebrou quando `estado-atual.md` foi reescrito — o doc passou a listar
  // mais coisa (Dashboard e Financeiro), o que deveria FORTALECER a asserção
  // e em vez disso a derrubou. Teste de documentação que exige uma frase ao pé
  // da letra impede o doc de melhorar.
  for (const capacidade of ["sync paginado", "cron", "modelo canônico", "overview"]) {
    assert.match(state, new RegExp(`TikTok Shop[^\\n]*${capacidade}`, "i"), `TikTok: ${capacidade}`);
  }
  assert.match(state, /TikTok Shop[^\n]*implementados/i);
  // Sem sensibilidade a caixa: a frase virou início de período no doc
  // ("Conciliação financeira real segue parcial") e o regex minúsculo passou a
  // falhar por causa de uma letra. A trava é sobre o doc AFIRMAR que a
  // conciliação está parcial, não sobre onde a frase cai no parágrafo.
  //
  // ⚠️ REAPONTADO EM 20/09/2026, com a intenção anterior registrada: o regex
  // exigia a FRASE ("segue parcial") e a reescrita do estado-atual disse a
  // verdade melhor — "a conciliação financeira desse cliente NUNCA RODOU"
  // (ledger travado na estreia do app público). A trava sempre foi sobre a
  // AFIRMAÇÃO: o doc não pode dar a conciliação por concluída enquanto ela não
  // estiver. Casar a letra impediria o doc de melhorar — a regra escrita logo
  // acima, aplicada a esta mesma linha.
  assert.match(state, /conciliaç[aã]o financeira[^.]*(nunca rodou|segue parcial|travada)/i);
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
  // ⚠️ REAPONTADO EM 26/09/2026, com a intenção anterior registrada: as duas
  // linhas exigiam que o doc registrasse o Go Live como PENDENTE ("under
  // review", datado de 07/08) — verdade quando foram escritas. O Go Live foi
  // APROVADO em 02/09/2026 (apps ONLINE no console, conferido com a dona na
  // tela), e a partir daí a exigência antiga passou a DEFENDER a afirmação
  // superada: quem corrigisse o doc quebraria a suíte. É a família da recusa
  // temporária da Shopee de 31/08 (AGENTS.md) — recusa morre junto com a
  // limitação que a justificou, e o teste se inverte registrando a intenção.
  // A trava continua a MESMA de sempre: o doc não pode afirmar um estado do
  // Go Live que já foi superado. Defeito real que este bloco reprova:
  // docs/estado-atual.md afirmou "Live **BLOCKED**" (§5) por 24 dias depois da
  // aprovação, contradizendo a própria tabela de Canais — corrigido em 26/09.
  assert.match(state, /Go Live[^\n]*APROVADO[^\n]*02\/09/i);
  assert.doesNotMatch(state, /Live \*\*BLOCKED\*\*/);
  assert.doesNotMatch(state, /último estado comprovado é .under review./i);
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
