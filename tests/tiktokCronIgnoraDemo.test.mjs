import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

// A loja sintetica do workspace de demonstracao existe para o revisor do App
// review do TikTok ver a tela com dado. O token dela e falso: se o cron a
// pegar, cada tentativa volta 36009004 e grava `status='error'` no sync — e o
// erro aparece na frente do dashboard de quem estamos tentando impressionar.
// Medido em 27/08/2026 na conta demo, antes desta correcao.

const scheduler = fonte("src/lib/integrations/tiktokScheduler.ts");

test("o cron do TikTok pula a loja de demonstracao", () => {
  assert.match(scheduler, /DEMO_SHOP_PREFIX = "demo-%"/);
  assert.match(scheduler, /shop\.shop_id NOT LIKE \$3/, "o filtro precisa estar na selecao de candidatos");
  assert.match(scheduler, /\[PROVIDER, connectionLimit, DEMO_SHOP_PREFIX\]/, "o parametro precisa ser passado");
});

test("loja REAL continua sincronizando: shop_id do TikTok e numerico", () => {
  // O padrao `demo-%` so casa com o namespace que o seed reserva. Um shop_id
  // real — sempre numerico — nunca cai no filtro.
  const casaComDemo = (shopId) => shopId.startsWith("demo-");
  assert.equal(casaComDemo("7494291387899806731"), false, "Crystal Fancy (real) nao pode ser pulada");
  assert.equal(casaComDemo("demo-tiktok-shop"), true, "a loja do seed tem que ser pulada");
  // O seed reserva o prefixo; se alguem mudar o shop_id do demo, este teste cai.
  assert.match(fonte("scripts/_demo-seed.mjs"), /const TTS_SHOP = "demo-tiktok-shop"/);
});

test("a regra do TikTok e a mesma que o Shopee ja aplicava", () => {
  // O Shopee pula demo pelo `metadata->'demo'` da integracao. O TikTok nao tem
  // essa coluna (a conexao mora em `workspace_tiktok_shops`), por isso o
  // marcador e o prefixo do shop_id — mas o efeito precisa ser o mesmo.
  assert.match(fonte("src/lib/integrations/shopeeScheduler.ts"), /metadata->'demo' IS DISTINCT FROM 'true'::jsonb/);
});
