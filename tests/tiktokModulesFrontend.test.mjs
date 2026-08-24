import test from "node:test"; import assert from "node:assert/strict";
import { moduleApiQuery,moduleConnectionHref,moduleError,moduleHref,moduleMoney,updatedModuleQuery } from "../src/app/components/TikTokModulesModel.ts";
test("links preserve connection and filters",()=>{const href=moduleHref("/tiktok/monitor","q=sku&status=paid&connection_id=tiktok_shop%3A1","tiktok_shop:2");const p=new URL(href,"http://x");assert.equal(p.searchParams.get("q"),"sku");assert.equal(p.searchParams.get("status"),"paid");assert.equal(p.searchParams.get("connection_id"),"tiktok_shop:2")});
test("API query isolates connection and retains only visible filters",()=>{const monitor=new URLSearchParams(moduleApiQuery("q=hidden&status=paid&order_id=o1&sku=s1&connection_id=tiktok_shop%3Aold&unsafe=no","tiktok_shop:new","monitor"));assert.equal(monitor.get("connection_id"),"tiktok_shop:new");assert.equal(monitor.get("order_id"),"o1");assert.equal(monitor.get("sku"),"s1");assert.equal(monitor.has("q"),false);assert.equal(monitor.has("unsafe"),false);assert.match(monitor.get("from"),/^\d{4}-\d{2}-\d{2}$/);const catalog=new URLSearchParams(moduleApiQuery("q=x&status=active&order_id=hidden","tiktok_shop:new","catalog"));assert.equal(catalog.get("q"),"x");assert.equal(catalog.get("status"),"active");assert.equal(catalog.has("order_id"),false)});
test("module links discard filters not exposed by their target",()=>{const catalog=new URL(moduleHref("/tiktok/catalogo","q=x&status=active&order_id=hidden&sku=hidden","tiktok_shop:1"),"http://x");assert.equal(catalog.searchParams.get("q"),"x");assert.equal(catalog.searchParams.has("order_id"),false);assert.equal(catalog.searchParams.has("sku"),false)});
test("ownership and invalid connection have explicit states",()=>{assert.match(moduleError("OWNERSHIP_CONFLICT"),/conflitante/);assert.match(moduleError("INVALID_CONNECTION_ID"),/não é válida/)});
test("financeiro preserva somente loja, período e paginação",()=>{
  const href=new URL(moduleHref("/tiktok/financeiro","connection_id=tiktok_shop%3Aold&from=2026-08-01&to=2026-08-10&limit=25&offset=50&order_id=hidden","tiktok_shop:42"),"http://x");
  assert.equal(href.pathname,"/tiktok/financeiro");
  assert.equal(href.searchParams.get("connection_id"),"tiktok_shop:42");
  assert.equal(href.searchParams.get("from"),"2026-08-01");
  assert.equal(href.searchParams.get("offset"),"50");
  assert.equal(href.searchParams.has("order_id"),false);
  const api=new URLSearchParams(moduleApiQuery(href.searchParams.toString(),"tiktok_shop:42","finance"));
  assert.equal(api.get("connection_id"),"tiktok_shop:42");
  assert.equal(api.get("limit"),"25");
  assert.equal(api.has("order_id"),false);
});
test("financeiro distingue zero conhecido de valor ausente",()=>{assert.match(moduleMoney(0),/0,00/);assert.equal(moduleMoney(null),"—")});
test("paginação avança e volta sem ser sobrescrita, enquanto filtros e loja resetam",()=>{
  assert.equal(new URLSearchParams(updatedModuleQuery("offset=50&status=paid",{offset:"100"})).get("offset"),"100");
  assert.equal(new URLSearchParams(updatedModuleQuery("offset=50&status=paid",{offset:"0"})).get("offset"),"0");
  assert.equal(new URLSearchParams(updatedModuleQuery("offset=50&status=paid",{status:"shipped"})).get("offset"),"0");
  const store=new URL(moduleConnectionHref("/tiktok/monitor","connection_id=tiktok_shop%3A1&offset=50&status=paid","tiktok_shop:2"),"http://x");
  assert.equal(store.searchParams.get("connection_id"),"tiktok_shop:2");
  assert.equal(store.searchParams.get("offset"),"0");
});
test("UI usa status canônicos e explica schema financeiro bloqueado",async()=>{
  const source=await import("node:fs/promises").then(fs=>fs.readFile(new URL("../src/app/components/TikTokModulePage.tsx",import.meta.url),"utf8"));
  const dashboard=await import("node:fs/promises").then(fs=>fs.readFile(new URL("../src/app/components/TikTokWorkspace.tsx",import.meta.url),"utf8"));
  const financePage=await import("node:fs/promises").then(fs=>fs.readFile(new URL("../src/app/tiktok/financeiro/page.tsx",import.meta.url),"utf8"));
  const nav=await import("node:fs/promises").then(fs=>fs.readFile(new URL("../src/app/components/Nav.tsx",import.meta.url),"utf8"));
  const workspaceModel=await import("node:fs/promises").then(fs=>fs.readFile(new URL("../src/app/components/TikTokWorkspace.tsx",import.meta.url),"utf8"));
  assert.match(source,/TIKTOK_CATALOG_STATUSES/);
  for(const invalid of ["inactive","draft","suspended"])assert.doesNotMatch(source,new RegExp(`"${invalid}"`));
  assert.match(financePage,/kind="finance"/);
  assert.doesNotMatch(financePage,/redirect/);
  assert.match(nav,/href: "\/tiktok\/financeiro"/);
  // "incompleto" saiu da tela em 23/08: adjetivo que se desculpa não diz o que
  // fazer. O painel agora nomeia o fato — o extrato oficial ainda não foi postado
  // pela TikTok. Ver AGENTS.md → "Como este projeto trata dado incerto".
  assert.match(source,/Extrato oficial ainda não postado/);
  assert.doesNotMatch(source,/incompleto|parcial/i);
  assert.match(source,/Somente campos sanitizados do ledger/);
  assert.match(source,/Financeiro aguardando estrutura de dados/);
  assert.match(dashboard,/Financeiro indisponível neste ambiente/);
  assert.match(dashboard,/nenhum valor foi convertido em zero/);
  for(const contractField of ["dailySeries","statusBreakdown","topProducts"]) assert.match(dashboard,new RegExp(contractField));
  assert.match(dashboard,/não substituem o ledger financeiro/);
  assert.ok(source.indexOf("providerIssue?") < source.indexOf("connections?.length===0"));
  assert.match(source,/description=\{providerIssue\.message\}/);
  assert.ok(workspaceModel.indexOf("if (provider.issue)") < workspaceModel.indexOf("provider.connections.length === 0"));
  assert.match(workspaceModel,/description=\{provider\.issue\.message\}/);
});
