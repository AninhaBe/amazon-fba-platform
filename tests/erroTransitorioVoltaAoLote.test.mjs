import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Defeito estrutural corrigido em 28/08/2026: no Mercado Livre, `status='error'`
// era estado TERMINAL DE FATO — o scheduler só elegia pending/syncing/complete,
// então um timeout de banco às 11:34 prendeu a conta real da vendedora por 7h30
// (e o token venceu junto, porque o refresh só roda dentro do passo de sync).
// Regra da casa: estado terminal só é terminal quando o MOTIVO é terminal.

test("o ML reelege erro transitório após backoff — e a conta parada volta sozinha", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/mercadoLivreScheduler.ts", import.meta.url), "utf8");
  assert.match(fonte, /OR \(sync\.status = 'error'\s*\n\s*AND sync\.updated_at < now\(\) - interval '15 minutes'/,
    "erro volta ao lote depois de 15 min");
  // O backoff é obrigatório: sem ele, uma conexão em erro rodaria em loop
  // apertado contra a API do canal.
  assert.doesNotMatch(fonte, /sync\.status = 'error'\)\s*\n\s*OR/, "nada de erro elegível sem espera");
  // Lease continua respeitada na cláusula nova (worker vivo não é atropelado).
  const clausula = fonte.slice(fonte.indexOf("OR (sync.status = 'error'"), fonte.indexOf("-- A janela vem de FRESH_FOR_MS"));
  assert.match(clausula, /lease_until IS NULL OR sync\.lease_until < now\(\)/);
});

test("erro de AUTORIZAÇÃO não entra em loop de retry — no ML, pela porta do canal", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/mercadoLivreScheduler.ts", import.meta.url), "utf8");
  // O scheduler do ML só considera integração conectada...
  assert.match(fonte, /integration\.status = 'connected'/);
  // ...e o adapter persiste 'disconnected' quando o refresh é recusado, que é o
  // que tira a conexão do lote sem depender do texto do erro.
  const adapter = await readFile(new URL("../src/lib/integrations/mercadoLivre.ts", import.meta.url), "utf8");
  assert.match(adapter, /saveIntegration\(\{ \.\.\.latest, status: "disconnected" \}\)/);
  assert.match(adapter, /ChannelAuthExpiredError/);
});

test("o batch do ML TENTA o primeiro passo mesmo em erro — a segunda camada do defeito", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/mercadoLivreSync.ts", import.meta.url), "utf8");
  const batch = fonte.slice(fonte.indexOf("export async function runMercadoLivreSyncBatch"));
  // O break só vale para 'error' a partir da SEGUNDA iteração: o primeiro passo
  // é a tentativa de retomada. Sem isso, o scheduler elegia e o batch saía sem
  // tocar em nada (updated_at congelado por 8h, medido em produção).
  assert.match(batch, /if \(terminal \|\| \(status\.status === "error" && step > 0\)\) break/);
  // complete e unavailable continuam interrompendo de imediato.
  assert.match(batch, /const terminal = status\.status === "complete" \|\| status\.status === "unavailable"/);
  assert.doesNotMatch(batch.slice(0, batch.indexOf("runMercadoLivreSyncStep")),
    /status\.status === "error"\) break/, "erro não pode voltar a interromper antes do primeiro passo");
});

test("Shopee e Amazon já rodavam o primeiro passo — é de onde veio o desenho", async () => {
  const shopee = await readFile(new URL("../src/lib/integrations/shopeeSync.ts", import.meta.url), "utf8");
  const batchShopee = shopee.slice(shopee.indexOf("export async function runShopeeSyncBatch"));
  // Primeiro passo fora do laço = incondicional.
  assert.match(batchShopee, /let status = await runShopeeSyncStep\([\s\S]{0,120}\);\s*\n\s*while/);
  const amazon = await readFile(new URL("../src/lib/integrations/amazonSync.ts", import.meta.url), "utf8");
  assert.match(amazon, /if \(step === 0\) await runAmazonSyncStep\(account, forcarJanela\)/);
});

test("os outros três canais já tratavam erro transitório — e cada um do seu jeito", async () => {
  // Shopee: reelege com backoff de 5 min e EXCLUI reauth/terminal por prefixo
  // carimbado em last_error (o canal carimba; o ML não).
  const shopee = await readFile(new URL("../src/lib/integrations/shopeeScheduler.ts", import.meta.url), "utf8");
  assert.match(shopee, /sync\.status = 'error'[\s\S]{0,200}NOT LIKE '\[REAUTH_REQUIRED\]%'/);
  assert.match(shopee, /NOT LIKE '\[TERMINAL_ERROR\]%'/);
  // TikTok: 'error' está na mesma lista de pending/syncing (reelege no ciclo
  // seguinte); reauth sai do lote pela fase do próprio contrato.
  const tiktok = await readFile(new URL("../src/lib/integrations/tiktokScheduler.ts", import.meta.url), "utf8");
  assert.match(tiktok, /sync\.status IN \('pending', 'syncing', 'error'\)/);
  // Amazon: reelege erro após 30 min.
  const amazon = await readFile(new URL("../src/lib/integrations/amazonScheduler.ts", import.meta.url), "utf8");
  assert.match(amazon, /sync\.status = 'error' AND sync\.updated_at < now\(\) - interval '30 minutes'/);
});
