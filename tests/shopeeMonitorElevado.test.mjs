import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { shopeePeriodRequest, ShopeeModuleError } from "../src/lib/integrations/shopeeModuleContract.ts";

// E3 do Monitor Unificado (28/08/2026): o monitor da Shopee sobe ao padrão da
// Amazon (base de data → cards → abas Composição | Pedidos), ganha BUSCA de
// servidor (não tinha nenhuma) e o período personalizado deixa de ser
// descartado. SEM aba Transações de propósito: extrato Shopee não implementado
// — aba vazia seria mentira.

const agora = new Date("2026-08-28T18:00:00-03:00");

test("o período personalizado deixa de ser descartado — from/to viram o período de verdade", () => {
  const p = shopeePeriodRequest(new URLSearchParams("from=2026-08-01&to=2026-08-10"), agora);
  assert.equal(p.from.toISOString(), new Date("2026-08-01T00:00:00-03:00").toISOString());
  assert.equal(p.to.toISOString(), new Date("2026-08-10T23:59:59.999-03:00").toISOString());
  assert.equal(p.label, "01/08 a 10/08");
  // `to` no futuro é aparado no agora — período não afirma dias que não existem.
  const aberto = shopeePeriodRequest(new URLSearchParams("from=2026-08-27&to=2026-12-31"), agora);
  assert.equal(aberto.to.toISOString(), agora.toISOString());
  // days continua funcionando como fallback (comportamento antigo intacto).
  assert.equal(shopeePeriodRequest(new URLSearchParams("days=7"), agora).label, "Últimos 7 dias");
  // Inválidos continuam rejeitados com o erro do contrato.
  for (const ruim of ["from=2026-08-10&to=2026-08-01", "from=abc&to=2026-08-10", "from=2020-01-01&to=2026-08-10"]) {
    assert.throws(() => shopeePeriodRequest(new URLSearchParams(ruim), agora), ShopeeModuleError);
  }
});

test("o monitor ganha a anatomia da referência — e SEM aba Transações, a omissão honesta", async () => {
  const fonte = await readFile(new URL("../src/app/components/ShopeeModulePage.tsx", import.meta.url), "utf8");
  const monitor = fonte.slice(fonte.indexOf("function ShopeeMonitorContent"), fonte.indexOf("function ShopeeTaxRateEditor"));
  assert.match(monitor, /<BaseDeData base="pedido" \/>/);
  assert.match(monitor, /viewKey="shopee-monitor"/, "cards customizáveis como na Amazon/ML/TikTok");
  assert.match(monitor, /className="monitor-section-tabs"/, "a MESMA barra de abas da referência");
  assert.match(monitor, /\[\["composicao","Composição"\],\["pedidos","Pedidos"\]\]/, "duas abas — nada de Transações");
  assert.doesNotMatch(monitor, /Transações|transacoes/, "aba de extrato não existe sem fonte implementada");
  assert.match(monitor, /params\.get\("secao"\)==="pedidos"/, "deep-link ?secao= como na referência");
  // A Composição REUSA o painel financeiro do dashboard — mesma peça, mesmos rótulos.
  assert.match(monitor, /FinancialSummaryPanel/);
  assert.match(monitor, /buildFinancialComposition/);
  // null nunca vira 0 nos cards: tarifa desconhecida diz o estado real.
  assert.match(monitor, /profit\.fees==null\?"Ainda não conciliadas"/);
  // Hierarquia: antes das abas (cards inclusos) não nasce aviso novo — o único
  // is-warning do monitor é o de cobertura que JÁ existia, dentro da aba Pedidos.
  const antesDasAbas = monitor.slice(0, monitor.indexOf("monitor-section-tabs"));
  assert.doesNotMatch(antesDasAbas, /is-warning|is-error|role="alert"/);
});

test("a busca é de SERVIDOR e a paginação sob busca usa o universo filtrado", async () => {
  const canonico = await readFile(new URL("../src/lib/integrations/shopeeOverviewCanonical.ts", import.meta.url), "utf8");
  assert.match(canonico, /detailQuery\?: string/);
  assert.match(canonico, /\$9 = '' OR external_order_id ILIKE/, "filtro dentro da query paginada — busca só na página seria mentira");
  assert.match(canonico, /universoDetalhe \?\? ordersProcessed/, "hasMore contra o conjunto FILTRADO quando há busca");
  const reader = await readFile(new URL("../src/lib/integrations/shopeeModules.ts", import.meta.url), "utf8");
  assert.match(reader, /detailQuery: q/);
  const fonte = await readFile(new URL("../src/app/components/ShopeeModulePage.tsx", import.meta.url), "utf8");
  assert.match(fonte, /placeholder="Pedido, SKU ou produto"/, "o formulário de busca existe no monitor");
});

test("o modelo encaminha from/to e q para o monitor — e a tabela/paginação de servidor continuam", async () => {
  const model = await readFile(new URL("../src/app/components/ShopeeModulesModel.ts", import.meta.url), "utf8");
  assert.match(model, /\["monitor", "catalog", "inventory", "costs"\]\.includes\(kind\)/, "q agora inclui o monitor");
  assert.match(model, /if \(from && to\) \{ output\.set\("from", from\); output\.set\("to", to\); \}/);
  const fonte = await readFile(new URL("../src/app/components/ShopeeModulePage.tsx", import.meta.url), "utf8");
  assert.match(fonte, /if\(p\.has\("from"\)&&p\.has\("to"\)\)update\(\{from:p\.get\("from"\),to:p\.get\("to"\),days:null\}\)/,
    "o callback do período deixou de jogar o custom fora");
  const monitor = fonte.slice(fonte.indexOf("function ShopeeMonitorContent"), fonte.indexOf("function ShopeeTaxRateEditor"));
  assert.match(monitor, /<Table kind="monitor"/, "a tabela existente fica");
  assert.match(monitor, /update\(\{offset:String\(body\.page!\.offset\+body\.page!\.limit\)\}\)/, "paginação de servidor pela URL fica");
});
