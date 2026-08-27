// Seed do workspace de demonstração para a análise da Shopee (Go Live / ISV).
// Cria o usuário trial no Supabase Auth (admin API), conexões demo e dados
// canônicos sintéticos (pedidos, itens, fees, produtos, custos) para Amazon e
// Mercado Livre — no workspace ISOLADO do usuário demo, nunca no da Ana.
// Rodar: node --experimental-transform-types --import ./scripts/ts-resolver.mjs --env-file=.env.local scripts/_demo-seed.mjs

import { dbQuery } from "../src/lib/db.ts";
import { runWithWorkspace } from "../src/lib/workspaceScope.ts";
import { saveCanonicalOrders, saveCanonicalProducts } from "../src/lib/integrations/canonicalStore.ts";
import { tiktokConnectionId, tiktokCostId } from "../src/lib/integrations/tiktokContract.ts";
import crypto from "node:crypto";

const DEMO_EMAIL = process.env.DEMO_EMAIL ?? "trial.sellercore@gmail.com";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "";
if (!DEMO_PASSWORD) {
  console.error("Defina DEMO_PASSWORD no ambiente ao rodar o script.");
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;

async function adminFetch(path, init) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: SECRET,
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

async function ensureDemoUser() {
  const created = await adminFetch("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD, email_confirm: true }),
  });
  if (created.ok && created.body?.id) {
    console.log("usuario demo criado:", created.body.id);
    return created.body.id ;
  }
  // Já existe → localizar e resetar a senha para a informada.
  const list = await adminFetch(`/admin/users?page=1&per_page=200`);
  const existing = (list.body?.users ?? []).find((u) => u.email?.toLowerCase() === DEMO_EMAIL.toLowerCase());
  if (!existing) throw new Error(`criação falhou (${created.status}: ${JSON.stringify(created.body)}) e usuário não encontrado`);
  const updated = await adminFetch(`/admin/users/${existing.id}`, {
    method: "PUT",
    body: JSON.stringify({ password: DEMO_PASSWORD, email_confirm: true }),
  });
  if (!updated.ok) throw new Error(`reset de senha falhou: ${updated.status}`);
  console.log("usuario demo ja existia, senha atualizada:", existing.id);
  return existing.id ;
}

// ----- dados sintéticos ------------------------------------------------------

const ML_ITEMS = [
  { id: "MLB-DEMO-001", sku: "ORG-CZ-30", title: "Kit 30 Potes Herméticos para Cozinha com Tampa", price: 89.9, cost: 41.5, qty: 180, thumbnail: null, weight: 5 },
  { id: "MLB-DEMO-002", sku: "LED-FITA-5M", title: "Fita LED RGB 5m com Controle e Fonte Bivolt", price: 49.9, cost: 22.3, qty: 320, thumbnail: null, weight: 4 },
  { id: "MLB-DEMO-003", sku: "SUP-NOTE-ALU", title: "Suporte de Notebook em Alumínio Regulável", price: 74.9, cost: 33.8, qty: 95, thumbnail: null, weight: 3 },
  { id: "MLB-DEMO-004", sku: "GARRAFA-TERM-1L", title: "Garrafa Térmica Inox 1L Parede Dupla", price: 62.5, cost: 27.9, qty: 240, thumbnail: null, weight: 3 },
  { id: "MLB-DEMO-005", sku: "ORGAN-GAV-4", title: "Organizador de Gavetas Modular Kit 4 Peças", price: 39.9, cost: 16.2, qty: 60, thumbnail: null, weight: 2 },
];

const SHOPEE_ITEMS = [
  { id: "SHP-DEMO-001", sku: "MOCHILA-USB", title: "Mochila Antifurto com Porta USB Resistente a Agua", price: 129.9, cost: 61.4, qty: 140, thumbnail: null, weight: 5 },
  { id: "SHP-DEMO-002", sku: "SMARTWATCH-D20", title: "Smartwatch Esportivo com Monitor Cardiaco", price: 89.9, cost: 38.2, qty: 260, thumbnail: null, weight: 4 },
  { id: "SHP-DEMO-003", sku: "LUMINARIA-LED", title: "Luminaria de Mesa LED com Ajuste de Intensidade", price: 54.9, cost: 21.7, qty: 80, thumbnail: null, weight: 3 },
  { id: "SHP-DEMO-004", sku: "TECLADO-MEC-BT", title: "Teclado Mecanico Sem Fio Compacto 61 Teclas", price: 189.9, cost: 96.5, qty: 45, thumbnail: null, weight: 2 },
];

const AMZ_ITEMS = [
  { id: "B0DEMO0001", sku: "CAPA-CEL-PRETA", title: "Capa Anti-Impacto para Smartphone com Película", price: 34.9, cost: 12.4, qty: 410, thumbnail: null, weight: 5 },
  { id: "B0DEMO0002", sku: "FONE-BT-TWS", title: "Fone Bluetooth TWS com Estojo de Carregamento", price: 119.9, cost: 58.7, qty: 150, thumbnail: null, weight: 4 },
  { id: "B0DEMO0003", sku: "CABO-USBC-2M", title: "Cabo USB-C Reforçado 2m Carga Rápida", price: 27.9, cost: 9.8, qty: 500, thumbnail: null, weight: 4 },
  { id: "B0DEMO0004", sku: "MOUSE-ERGO-BT", title: "Mouse Ergonômico Vertical Sem Fio", price: 89.9, cost: 42.1, qty: 120, thumbnail: null, weight: 2 },
];

const TIKTOK_ITEMS = [
  { id: "TTS-DEMO-001", sku: "RING-LIGHT-10", title: "Ring Light 10 Polegadas com Tripé e Suporte de Celular", price: 79.9, cost: 34.6, qty: 210, thumbnail: null, weight: 5 },
  { id: "TTS-DEMO-002", sku: "MINI-VENT-USB", title: "Mini Ventilador Portátil USB Recarregável", price: 45.9, cost: 18.4, qty: 340, thumbnail: null, weight: 4 },
  { id: "TTS-DEMO-003", sku: "ORGAN-MAQ-6", title: "Organizador de Maquiagem Acrílico 6 Gavetas", price: 99.9, cost: 44.2, qty: 120, thumbnail: null, weight: 3 },
  { id: "TTS-DEMO-004", sku: "MASSAG-PESCOCO", title: "Massageador de Pescoço Elétrico Recarregável", price: 149.9, cost: 71.8, qty: 70, thumbnail: null, weight: 2 },
];

// PRNG determinístico (sem Math.random) — seed fixa deixa o script idempotente.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildOrders(provider, items, days, perDayAvg, seed) {
  const rand = mulberry32(seed);
  const orders = [];
  const now = Date.now();
  const weights = items.flatMap((item, index) => Array(item.weight).fill(index));
  let sequence = 1000;

  for (let day = days; day >= 0; day--) {
    const dayStart = now - day * 24 * 60 * 60 * 1000;
    const count = Math.max(0, Math.round(perDayAvg + (rand() - 0.5) * perDayAvg * 1.4));
    for (let i = 0; i < count; i++) {
      const item = items[weights[Math.floor(rand() * weights.length)]];
      const qty = rand() < 0.85 ? 1 : 2;
      const gross = Number((item.price * qty).toFixed(2));
      const occurred = new Date(dayStart + Math.floor(rand() * 22 * 60 * 60 * 1000));
      const cancelled = rand() < 0.06;
      const delivered = day > 7 || rand() < 0.5;
      const status = cancelled ? "cancelled" : delivered ? "delivered" : day > 2 ? "shipped" : "paid";
      sequence += 1 + Math.floor(rand() * 7);
      const orderId = provider === "amazon"
        ? `701-${sequence}-${(2000000 + sequence * 3) % 9999999}`
        : provider === "tiktok_shop" ? `5770${sequence}${(sequence * 7) % 97}` : `20000${sequence}`;

      const feeRates = { amazon: 0.15, mercado_livre: 0.14, shopee: 0.12, tiktok_shop: 0.11 };
      const feeCodes = { amazon: "ReferralFee", mercado_livre: "sale_fee", shopee: "commission_fee", tiktok_shop: "platform_commission" };
      const shipCodes = { amazon: "FBAPerUnitFulfillmentFee", mercado_livre: "shipping_fee", shopee: "actual_shipping_fee", tiktok_shop: "shipping_fee" };
      const fees = cancelled ? [] : [
        {
          feeType: "commission",
          providerFeeCode: feeCodes[provider],
          amount: Number((gross * feeRates[provider]).toFixed(2)),
          currency: "BRL",
        },
        {
          feeType: provider === "amazon" ? "fulfillment" : "shipping_seller",
          providerFeeCode: shipCodes[provider],
          amount: Number((provider === "amazon" ? 6.75 * qty : gross > 79 ? 21.9 : 0).toFixed(2)),
          currency: "BRL",
        },
      ].filter((fee) => fee.amount > 0);

      orders.push({
        externalOrderId: orderId,
        status,
        providerStatus: cancelled ? "cancelled" : status,
        occurredAt: occurred.toISOString(),
        closedAt: status === "delivered" ? new Date(occurred.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString() : null,
        currency: "BRL",
        gross,
        buyerShipping: 0,
        fulfillment: provider === "amazon" ? "platform" : rand() < 0.7 ? "platform" : "seller",
        packId: null,
        items: [{ externalProductId: item.id, sku: item.sku, title: item.title, qty, unitPrice: item.price }],
        fees,
        // O TikTok le o financeiro do LEDGER, nao do pedido: `statementSettled`
        // e as flags de `financialEvidence` sao o que faz tarifa e frete serem
        // CONHECIDOS em vez de `null`. Sem isso o painel do canal fica em
        // travessao mesmo com pedido gravado. Nos outros canais o campo e
        // ignorado, entao vai so no TikTok.
        raw: provider === "tiktok_shop"
          ? {
              demo: true,
              _sellercore: {
                statementSettled: !cancelled,
                financialEvidence: { fees: !cancelled, sellerShipping: !cancelled, ads: true, taxesWithheld: true, refunds: true },
              },
            }
          : { demo: true },
      });
    }
  }
  return orders;
}

function buildProducts(items, provider) {
  return items.map((item) => ({
    externalProductId: item.id,
    sku: item.sku,
    title: item.title,
    status: "active",
    providerStatus: "active",
    price: item.price,
    currency: "BRL",
    availableQty: item.qty,
    fulfillment: provider === "amazon" ? "platform" : "platform",
    thumbnail: item.thumbnail,
    permalink: null,
    raw: { demo: true },
  }));
}

/** Linha de sync — comum aos quatro canais. */
async function seedSync(workspaceId, provider, connectionId) {
  await dbQuery(
    `INSERT INTO workspace_marketplace_syncs
       (workspace_id, provider, connection_id, status, target_from, target_to,
        covered_from, covered_to, cursor_from, cursor_to, processed_orders,
        products_synced_at, products_total, active_products, products_complete, last_success_at)
     VALUES ($1, $2, $3, 'complete', now() - interval '60 days', now(),
             now() - interval '60 days', now(), now(), now(), 0,
             now(), 0, 0, true, now())
     ON CONFLICT (workspace_id, provider, connection_id) DO UPDATE SET
       status = 'complete', covered_to = now(), last_success_at = now(), last_error = NULL`,
    [workspaceId, provider, connectionId]
  );
}

/**
 * Loja sintetica do TikTok.
 *
 * ⚠️ O TikTok NAO usa `workspace_integrations` como os outros tres: a conexao
 * dele mora em `workspace_tiktok_shops`, com token proprio. Por isso este canal
 * tem funcao separada em vez de passar pelo `seedConnection`.
 *
 * Token sintetico com validade longa: o codigo do canal recusa operar com token
 * vencido, e a conta precisa continuar aberta durante toda a moderacao.
 */
async function seedTiktokShop(workspaceId, shopId, shopName) {
  await dbQuery(
    `INSERT INTO workspace_tiktok_shops
       (workspace_id, shop_id, shop_name, shop_cipher, region, access_token, refresh_token,
        access_expires_at, refresh_expires_at, tax_rate)
     VALUES ($1, $2, $3, $4, 'BR', $5, $6, now() + interval '365 days', now() + interval '365 days', 8.5)
     ON CONFLICT (workspace_id, shop_id) DO UPDATE SET
       shop_name = EXCLUDED.shop_name,
       access_expires_at = EXCLUDED.access_expires_at,
       refresh_expires_at = EXCLUDED.refresh_expires_at,
       tax_rate = EXCLUDED.tax_rate`,
    [workspaceId, shopId, shopName, `demo-cipher-${shopId}`, `demo-access-${shopId}`, `demo-refresh-${shopId}`]
  );
  await seedSync(workspaceId, "tiktok_shop", tiktokConnectionId(shopId));
}

async function seedConnection(workspaceId, provider, connectionId, displayName) {
  await dbQuery(
    `INSERT INTO workspace_integrations
       (workspace_id, id, provider, external_account_id, display_name, mode, status, metadata)
     VALUES ($1, $2, $3, $4, $5, 'local', 'connected', '{"demo": true}'::jsonb)
     ON CONFLICT (workspace_id, id) DO UPDATE SET status = 'connected', metadata = '{"demo": true}'::jsonb`,
    [workspaceId, connectionId, provider, `demo-${provider}`, displayName]
  );
  await seedSync(workspaceId, provider, connectionId);
}

async function seedCosts(workspaceId, items) {
  for (const item of items) {
    await dbQuery(
      `INSERT INTO workspace_product_costs (workspace_id, id, sku, asin, title, cost)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workspace_id, id) DO UPDATE SET cost = EXCLUDED.cost, title = EXCLUDED.title`,
      [workspaceId, item.sku, item.sku, item.id, item.title, item.cost]
    );
  }
}

/**
 * Extrato liquidado sintetico do TikTok: e ele que tira Taxas/Lucro/Margem do
 * travessao.
 *
 * A tela do TikTok NAO soma o pedido: ela le `workspace_financial_transactions`
 * e, sem cobertura, cai em `per_order_fallback` com `periodCovered: false` — e
 * `calculateTiktokFinancialV2` devolve lucro `null` nesse caso. Entao o seed
 * precisa das DUAS metades: as transacoes e os checkpoints que provam a janela.
 *
 * Sinais: `commission` e `seller_shipping` entram em MAGNITUDE POSITIVA, igual
 * ao que o `normalizeTransaction` grava (ele aplica `Math.abs`). Inverter aqui
 * faria o lucro do demo estourar para cima.
 *
 * `ads`, `taxes_withheld`, `refunds` e `buyer_shipping` vao com ZERO EXPLICITO,
 * nao `null`: num extrato liquidado, ausencia de anuncio e ausencia de retencao
 * sao fatos ("a plataforma nao cobrou"), e e o que faz esses componentes
 * fecharem `complete` em vez de ficarem pendurados como desconhecidos.
 */
async function seedTiktokLedger(workspaceId, connectionId, orders) {
  const REVENUE = new Set(["paid", "shipped", "delivered"]);
  const liquidados = orders.filter((order) => REVENUE.has(order.status));
  let gravadas = 0;
  for (const order of liquidados) {
    const dia = order.occurredAt.slice(0, 10);
    const commission = order.fees.find((fee) => fee.feeType === "commission")?.amount ?? 0;
    const frete = order.fees.find((fee) => fee.feeType === "shipping_seller")?.amount ?? 0;
    const settlement = Number((order.gross - commission - frete).toFixed(2));
    const transactionId = `demo-tx-${order.externalOrderId}`;
    // 32 bytes exatos: a 0005 tem CHECK de octet_length no raw_sha256.
    const hash = crypto.createHash("sha256").update(transactionId).digest();
    await dbQuery(
      `INSERT INTO workspace_financial_transactions
         (workspace_id, provider, connection_id, transaction_id, statement_id, order_id,
          transaction_type, occurred_at, currency, revenue, seller_shipping, commission,
          buyer_shipping, ads, taxes_withheld, refunds,
          settlement_amount, settlement_state, is_estimated, source_resource,
          source_record_id, source_observed_at, source_rank, raw_allowlisted, raw_sha256)
       VALUES ($1,'tiktok_shop',$2,$3,$4,$5,'ORDER',$6,'BRL',$7,$8,$9,
               0, 0, 0, 0,
               $10,
               'settled', FALSE, 'statement_transactions', $3, now(), 100,
               '{"demo": true}'::jsonb, $11)
       ON CONFLICT (workspace_id, provider, connection_id, transaction_id) DO UPDATE SET
         revenue = EXCLUDED.revenue, commission = EXCLUDED.commission,
         seller_shipping = EXCLUDED.seller_shipping, settlement_amount = EXCLUDED.settlement_amount,
         buyer_shipping = 0, ads = 0, taxes_withheld = 0, refunds = 0,
         updated_at = now()`,
      [workspaceId, connectionId, transactionId, `demo-stmt-${dia}`, order.externalOrderId,
       order.occurredAt, order.gross, frete, commission, settlement, hash]
    );
    gravadas += 1;
  }

  // Checkpoint unico e largo. `checkpointsCoverPeriod` exige `completed_at`,
  // `terminal_cursor` e `error_count = 0`, e recusa qualquer periodo que termine
  // depois da fronteira do dia fechado — por isso a janela vai ate hoje 00:00 BRT.
  for (const resource of ["statements", "payments", "unsettled"]) {
    await dbQuery(
      `INSERT INTO workspace_financial_sync_checkpoints
         (workspace_id, provider, connection_id, resource, window_from, window_to,
          owner_token, fencing_token, page_number, terminal_cursor, completed_at,
          rows_seen, rows_written, error_count, lease_until)
       VALUES ($1,'tiktok_shop',$2,$3, now() - interval '90 days',
               date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo',
               gen_random_uuid(), 1, 1, TRUE, now(), $4, $4, 0, now())
       ON CONFLICT (workspace_id, provider, connection_id, resource, window_from, window_to)
         DO UPDATE SET terminal_cursor = TRUE, completed_at = now(), error_count = 0,
                       rows_seen = EXCLUDED.rows_seen, rows_written = EXCLUDED.rows_written`,
      [workspaceId, connectionId, resource, gravadas]
    );
  }
  return gravadas;
}

async function main() {
  const workspaceId = await ensureDemoUser();

  const ML_CONN = "mercado_livre:demo";
  const AMZ_CONN = "amazon:demo";

  const SHP_CONN = "shopee:demo";
  await seedConnection(workspaceId, "mercado_livre", ML_CONN, "Loja Demo ML");
  await seedConnection(workspaceId, "amazon", AMZ_CONN, "Loja Demo Amazon");
  await seedConnection(workspaceId, "shopee", SHP_CONN, "Loja Demo Shopee");
  const TTS_SHOP = "demo-tiktok-shop";
  const TTS_CONN = tiktokConnectionId(TTS_SHOP);
  await seedTiktokShop(workspaceId, TTS_SHOP, "Loja Demo TikTok");
  await seedCosts(workspaceId, [...ML_ITEMS, ...AMZ_ITEMS]);
  // A Shopee lê custo pela chave própria do canal (shopee:<conexao>:sku:<sku>).
  for (const item of SHOPEE_ITEMS) {
    await dbQuery(
      `INSERT INTO workspace_product_costs (workspace_id, id, sku, asin, title, cost)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workspace_id, id) DO UPDATE SET cost = EXCLUDED.cost, title = EXCLUDED.title`,
      [workspaceId, `shopee:${SHP_CONN}:sku:${item.sku}`, item.sku, item.id, item.title, item.cost]
    );
  }

  // O TikTok resolve custo por chave propria do canal, como a Shopee.
  for (const item of TIKTOK_ITEMS) {
    await dbQuery(
      `INSERT INTO workspace_product_costs (workspace_id, id, sku, asin, title, cost)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workspace_id, id) DO UPDATE SET cost = EXCLUDED.cost, title = EXCLUDED.title`,
      [workspaceId, tiktokCostId(TTS_CONN, item.id, item.sku), item.sku, item.id, item.title, item.cost]
    );
  }

  const mlOrders = buildOrders("mercado_livre", ML_ITEMS, 45, 4, 42);
  const amzOrders = buildOrders("amazon", AMZ_ITEMS, 45, 3, 7);
  const shpOrders = buildOrders("shopee", SHOPEE_ITEMS, 45, 5, 91);
  const ttsOrders = buildOrders("tiktok_shop", TIKTOK_ITEMS, 45, 5, 17);

  await runWithWorkspace(workspaceId, async () => {
    await saveCanonicalProducts({ provider: "mercado_livre", connectionId: ML_CONN }, buildProducts(ML_ITEMS, "mercado_livre"));
    await saveCanonicalProducts({ provider: "amazon", connectionId: AMZ_CONN }, buildProducts(AMZ_ITEMS, "amazon"));
    await saveCanonicalOrders({ provider: "mercado_livre", connectionId: ML_CONN }, mlOrders);
    await saveCanonicalOrders({ provider: "amazon", connectionId: AMZ_CONN }, amzOrders);
    await saveCanonicalProducts({ provider: "shopee", connectionId: SHP_CONN }, buildProducts(SHOPEE_ITEMS, "shopee"));
    await saveCanonicalOrders({ provider: "shopee", connectionId: SHP_CONN }, shpOrders);
    await saveCanonicalProducts({ provider: "tiktok_shop", connectionId: TTS_CONN }, buildProducts(TIKTOK_ITEMS, "tiktok_shop"));
    await saveCanonicalOrders({ provider: "tiktok_shop", connectionId: TTS_CONN }, ttsOrders);
  });

  const ttsLedger = await seedTiktokLedger(workspaceId, TTS_CONN, ttsOrders);

  const counts = await dbQuery(
    `SELECT provider, COUNT(*)::text AS total FROM workspace_channel_orders WHERE workspace_id = $1 GROUP BY provider`,
    [workspaceId]
  );
  const countRows = Array.isArray(counts) ? counts : counts.rows;
  console.log("workspace:", workspaceId);
  for (const row of countRows) console.log(`pedidos ${row.provider}: ${row.total}`);
  console.log("gerados -> ML:", mlOrders.length, "| Amazon:", amzOrders.length, "| Shopee:", shpOrders.length, "| TikTok:", ttsOrders.length);
  console.log("extrato TikTok liquidado (transacoes):", ttsLedger);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error("seed falhou:", error);
  process.exit(1);
});
