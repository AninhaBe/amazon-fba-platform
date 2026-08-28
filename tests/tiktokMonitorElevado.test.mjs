import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// E2 do Monitor Unificado (28/08/2026): o monitor do TikTok sobe de tabela
// plana para o padrão da Amazon (base de data → cards do período → abas),
// PRESERVANDO as virtudes do canal e SEM criar aviso novo com peso de alarme
// (hierarquia da Vitrine é premissa).

test("o monitor ganha a anatomia da referência: base de data, cards do período e abas", async () => {
  const fonte = await readFile(new URL("../src/app/components/TikTokModulePage.tsx", import.meta.url), "utf8");
  const monitor = fonte.slice(fonte.indexOf("function MonitorContent"));
  assert.match(monitor, /<BaseDeData base="pedido" \/>/, "mesma frase de base dos quatro canais");
  assert.match(monitor, /viewKey="tiktok-monitor"/, "cards customizáveis como na Amazon e no ML");
  assert.match(monitor, /className="monitor-section-tabs"/, "a MESMA barra de abas do monitor Amazon");
  assert.match(monitor, /sp\.get\("secao"\)==="transacoes"/, "deep-link ?secao= como na referência");
  // Cards são métrica, não aviso: nenhum bloco de alarme nasce aqui.
  assert.doesNotMatch(monitor.slice(0, monitor.indexOf("function TransacoesDoMonitor")), /is-warning|is-error|role="alert"/);
});

test("as virtudes do canal FICAM: filtros exatos de servidor, paginação de servidor e a coluna Conciliação", async () => {
  const fonte = await readFile(new URL("../src/app/components/TikTokModulePage.tsx", import.meta.url), "utf8");
  // Filtros exatos por pedido e SKU + status continuam no formulário do monitor.
  assert.match(fonte, /kind==="monitor"&&<><label><span>Pedido<\/span>/);
  assert.match(fonte, /placeholder="SKU exato"/);
  // A tabela de pedidos segue com a coluna de conciliação por pedido.
  assert.match(fonte, /\["financialStatus","Conciliação"\]/);
  // Paginação de servidor da aba Pedidos segue pela URL (update de offset).
  assert.match(fonte, /update\(\{offset:String\(body\.page!\.offset\+body\.page!\.limit\)\}\)/);
  // OrderProfitabilityTable NÃO entra nesta etapa — o risco dos dois modos
  // continua fora do monitor TikTok (destaque preservado do plano).
  assert.doesNotMatch(fonte, /OrderProfitabilityTable/);
});

test("a aba Transações REUSA o extrato do financeiro — mesma rota, mesmos componentes, paginação local", async () => {
  const fonte = await readFile(new URL("../src/app/components/TikTokModulePage.tsx", import.meta.url), "utf8");
  const aba = fonte.slice(fonte.indexOf("function TransacoesDoMonitor"), fonte.indexOf("function TikTokAbcInsights"));
  assert.match(aba, /\/api\/integrations\/tiktok\/finance\?/, "sem endpoint novo — o extrato é o do /financeiro");
  assert.match(aba, /<DataTable kind="finance"/, "sem tabela duplicada");
  assert.match(aba, /FinanceCoveragePanel/, "o painel de cobertura honesto vem junto");
  assert.match(aba, /<BaseDeData base="pedido-extrato" prefixo="Transações" \/>/, "a pegadinha da data do extrato continua dita");
  // Falha/bloqueio degrada limpo — nunca zeros.
  assert.match(aba, /Não foi possível carregar as transações/);
  assert.match(aba, /Nenhum valor foi estimado ou convertido em zero/);
  // O offset da URL pertence à aba Pedidos; a paginação daqui é local.
  assert.match(aba, /const \[offset,setOffset\]=useState\(0\)/);
});

test("os cards vêm de agregado do PERÍODO no servidor, com a régua de liquidação coluna-primeiro", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/tiktokModules.ts", import.meta.url), "utf8");
  const resumo = fonte.slice(fonte.indexOf("Cards do monitor"));
  assert.match(resumo, /COUNT\(\*\) FILTER \(WHERE status IN \('paid','shipped','delivered'\)\)::int AS confirmados/);
  assert.match(resumo, /financial_settled OR COALESCE\(\(raw #>> '\{_sellercore,statementSettled\}'\)::boolean,false\)/,
    "mesma expressão coluna-primeiro do resto do canal (ADR-026)");
  assert.match(resumo, /aguardandoExtrato: Math\.max\(0, confirmados - conciliados\)/);
});
