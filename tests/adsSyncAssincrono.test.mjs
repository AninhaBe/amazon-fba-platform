import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// O SYNC DE ANÚNCIO É ASSÍNCRONO, E ISSO É REGRA, NÃO DETALHE.
//
// Medido em 25/08/2026, no primeiro relatório desta conta: mais de 30 minutos
// entre PENDING e COMPLETED. Se alguém ligar "abrir a aba dispara o relatório",
// a pessoa olha um esqueleto por meia hora.
//
// E se o ciclo pedir sem colher, a fila entope — foi exatamente o que travou o
// extrato financeiro do TikTok por 85 rodadas em agosto, com o cron reportando
// sucesso o tempo todo.

const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const sync = () => fonte("src/lib/integrations/amazonAdsSync.ts");

test("pedir e colher sao passos separados", () => {
  const s = sync();
  assert.match(s, /export async function pedirRelatorioDeAnuncios/);
  assert.match(s, /export async function colherRelatoriosDeAnuncios/);
});

test("nao pede relatorio novo com um em voo", () => {
  // Sem esta trava, cada ciclo do cron criaria um relatório e nunca colheria o
  // anterior. O TikTok já provou como isso termina.
  const s = sync();
  assert.match(s, /MAX_PENDENTES/);
  assert.match(s, /status='pending'/);
});

test("PENDING nao e tratado como erro", () => {
  const s = sync();
  // Só FAILED marca falha. PENDING/PROCESSING é o comportamento normal por ~30
  // minutos — tratar como erro faria o cron desistir de todo relatório.
  assert.match(s, /st\.status === "FAILED"/);
  assert.match(s, /st\.status !== "COMPLETED"/);
});

test("a tela le do banco, nunca da Amazon", () => {
  const s = sync();
  const i = s.indexOf("export async function resumoDeAnuncios");
  assert.ok(i > 0, "resumoDeAnuncios precisa existir");
  const corpo = s.slice(i);
  assert.doesNotMatch(corpo, /fetch\(/, "o resumo não pode chamar a Amazon — ele é lido pela tela");
  assert.match(corpo, /FROM workspace_ad_metrics/);
});

test("sem anuncio sincronizado devolve null, nao zero", () => {
  // `null ≠ 0`: "não sincronizou" e "não gastou" não podem virar o mesmo R$ 0,00
  // na tela. É a mesma regra que fez o card de custo da Amazon parar de afirmar
  // lucro zero quando o repasse ainda não tinha sido postado.
  const s = sync();
  assert.match(s, /if \(!r \|\| Number\(r\.linhas\) === 0\) return null;/);
});

test("a ingestao e idempotente", () => {
  // O relatório do mesmo período é pedido de novo todo dia; sem ON CONFLICT
  // cada rodada duplicaria o gasto e o ACOS despencaria sozinho.
  const s = sync();
  assert.match(s, /ON CONFLICT \(workspace_id,provider,connection_id,day,campaign_id\)/);
  assert.match(s, /DO UPDATE SET/);
});

test("a tabela nasce agnostica de canal", () => {
  const m = fonte("migrations/0012_metricas_de_anuncio.sql");
  assert.match(m, /provider\s+text\s+NOT NULL/);
  // ML (Product Ads), TikTok (GMV Max) e Shopee (AdsManager) também têm API —
  // o segundo canal tem que ser um INSERT, não uma tabela nova.
  assert.match(m, /Mercado Livre|TikTok|Shopee/);
});

test("dinheiro e numeric, nunca float", () => {
  const m = fonte("migrations/0012_metricas_de_anuncio.sql");
  assert.match(m, /cost\s+numeric\(12,2\)/);
  assert.match(m, /sales\s+numeric\(12,2\)/);
});
