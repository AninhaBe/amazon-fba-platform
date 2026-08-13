import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/app/components/ShopeeWorkspaceModel.ts", import.meta.url), "utf8")
  .replace(/^import type .*;$/gm, "")
  .replace(/export type .*;$/gm, "")
  .replace(/^type ShopeeConnectionSummary .*;$/gm, "")
  .replace(/: Record<[^;]+> =/, " =")
  .replace(/: ShopeeSyncPhase/g, "");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const model = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("estados de sync Shopee têm ação coerente", () => {
  const retryable = model.shopeeSyncContent("retryable_error");
  assert.equal(retryable.action, "refresh");
  assert.match(retryable.description, /processamento agendado/i);
  assert.equal(model.shopeeSyncContent("reauth_required").action, "reconnect");
  assert.equal(model.shopeeSyncContent("terminal_error").action, "manage");
  assert.equal(model.shopeeSyncContent("syncing").action, null);
});

test("lucro Shopee só é definitivo com cobertura financeira completa", () => {
  assert.equal(model.shopeeProfitPresentation({ coverageComplete: true, feesComplete: true, costsComplete: true }).complete, true);
  const partial = model.shopeeProfitPresentation({ coverageComplete: true, feesComplete: false, costsComplete: true });
  assert.equal(partial.complete, false);
  assert.match(partial.label, /parcial/i);
});

test("alíquota Shopee ausente não fabrica zero no label", () => {
  assert.equal(model.shopeeTaxLabel(null), "Impostos (—)");
});

test("alíquota Shopee explicitamente zero continua visível", () => {
  assert.equal(model.shopeeTaxLabel(0), "Impostos (0%)");
});

const connection = (demo, status = "connected") => ({ status, metadata: demo ? { demo: true } : {} });

test("conexão demo é distinguida de loja real autorizada", () => {
  assert.deepEqual(model.resolveShopeeConnectionState([connection(true)]), {
    demo: true, connectionStatus: "connected", connectionCount: 1,
  });
});

test("workspace sem Shopee preserva estado vazio", () => {
  assert.deepEqual(model.resolveShopeeConnectionState([]), {
    demo: false, connectionStatus: "missing", connectionCount: 0,
  });
});

test("issue isolado não é confundido com workspace Shopee vazio", () => {
  assert.equal(model.shopeeProviderIssueContent(null), null);
  const issue = model.shopeeProviderIssueContent({
    status: "attention",
    code: "PROVIDER_READ_FAILED",
    message: "Não foi possível carregar este canal agora.",
  });
  assert.match(issue.title, /temporariamente indisponível/i);
  assert.match(issue.description, /carregar este canal/i);
  assert.equal(issue.actionLabel, "Ver integrações");
});

test("loja real não recebe estado demo", () => {
  assert.equal(model.resolveShopeeConnectionState([connection(false)]).demo, false);
});

test("loja real prevalece quando também existe conexão demo", () => {
  assert.deepEqual(model.resolveShopeeConnectionState([connection(true), connection(false)]), {
    demo: false, connectionStatus: "connected", connectionCount: 1,
  });
});

test("aviso demo possui semântica acessível persistente", () => {
  const workspace = fs.readFileSync(new URL("../src/app/components/ShopeeWorkspace.tsx", import.meta.url), "utf8");
  assert.match(workspace, /<aside[^>]+aria-labelledby="shopee-demo-title"/);
  assert.match(workspace, /<h2 id="shopee-demo-title"/);
  assert.match(workspace, /Dados de demonstração/);
  assert.match(workspace, /Nenhuma loja Shopee real está autorizada/);
});

test("dashboard Shopee prioriza provider issue e não oferece nova conexão", () => {
  const workspace = fs.readFileSync(new URL("../src/app/components/ShopeeWorkspace.tsx", import.meta.url), "utf8");
  const issueBranch = workspace.slice(
    workspace.indexOf("const providerIssue = shopeeProviderIssueContent"),
    workspace.indexOf("if (status.demo"),
  );
  assert.match(issueBranch, /ShopeeProviderIssueContent|providerIssue/);
  assert.match(issueBranch, /href="\/integracoes"/);
  assert.doesNotMatch(issueBranch, /Conectar loja|connectHref/);
});
