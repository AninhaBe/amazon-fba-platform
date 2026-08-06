// Seed do workspace de demonstração para a análise da Shopee (Go Live / ISV).
// Cria o usuário trial no Supabase Auth (admin API), conexões demo e dados
// canônicos sintéticos (pedidos, itens, fees, produtos, custos) para Amazon e
// Mercado Livre — no workspace ISOLADO do usuário demo, nunca no da Ana.
// Rodar: node --experimental-transform-types --import ./scripts/ts-resolver.mjs --env-file=.env.local scripts/_demo-seed.mjs

import { dbQuery } from "../src/lib/db.ts";
import { runWithWorkspace } from "../src/lib/workspaceScope.ts";
import { saveCanonicalOrders, saveCanonicalProducts } from "../src/lib/integrations/canonicalStore.ts";

const DEMO_EMAIL = process.env.DEMO_EMAIL ?? "trial.sellercore@gmail.com";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "";
if (!DEMO_PASSWORD) {
  console.error("Defina DEMO_PASSWORD no ambiente ao rodar o script.");
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;

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

const AMZ_ITEMS = [
  { id: "B0DEMO0001", sku: "CAPA-CEL-PRETA", title: "Capa Anti-Impacto para Smartphone com Película", price: 34.9, cost: 12.4, qty: 410, thumbnail: null, weight: 5 },
  { id: "B0DEMO0002", sku: "FONE-BT-TWS", title: "Fone Bluetooth TWS com Estojo de Carregamento", price: 119.9, cost: 58.7, qty: 150, thumbnail: null, weight: 4 },
  { id: "B0DEMO0003", sku: "CABO-USBC-2M", title: "Cabo USB-C Reforçado 2m Carga Rápida", price: 27.9, cost: 9.8, qty: 500, thumbnail: null, weight: 4 },
  { id: "B0DEMO0004", sku: "MOUSE-ERGO-BT", title: "Mouse Ergonômico Vertical Sem Fio", price: 89.9, cost: 42.1, qty: 120, thumbnail: null, weight: 2 },
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
      const orderId = provider === "amazon" ? `701-${sequence}-${(2000000 + sequence * 3) % 9999999}` : `20000${sequence}`;

      const fees = cancelled ? [] : [
        {
          feeType: "commission",
          providerFeeCode: provider === "amazon" ? "ReferralFee" : "sale_fee",
          amount: Number((gross * (provider === "amazon" ? 0.15 : 0.14)).toFixed(2)),
          currency: "BRL",
        },
        {
          feeType: provider === "amazon" ? "fulfillment" : "shipping_seller",
          providerFeeCode: provider === "amazon" ? "FBAPerUnitFulfillmentFee" : "shipping_fee",
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
        raw: { demo: true },
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

async function seedConnection(workspaceId, provider, connectionId, displayName) {
  await dbQuery(
    `INSERT INTO workspace_integrations
       (workspace_id, id, provider, external_account_id, display_name, mode, status, metadata)
     VALUES ($1, $2, $3, $4, $5, 'local', 'connected', '{"demo": true}'::jsonb)
     ON CONFLICT (workspace_id, id) DO UPDATE SET status = 'connected', metadata = '{"demo": true}'::jsonb`,
    [workspaceId, connectionId, provider, `demo-${provider}`, displayName]
  );
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

async function main() {
  const workspaceId = await ensureDemoUser();

  const ML_CONN = "mercado_livre:demo";
  const AMZ_CONN = "amazon:demo";

  await seedConnection(workspaceId, "mercado_livre", ML_CONN, "Loja Demo ML");
  await seedConnection(workspaceId, "amazon", AMZ_CONN, "Loja Demo Amazon");
  await seedCosts(workspaceId, [...ML_ITEMS, ...AMZ_ITEMS]);

  const mlOrders = buildOrders("mercado_livre", ML_ITEMS, 45, 4, 42);
  const amzOrders = buildOrders("amazon", AMZ_ITEMS, 45, 3, 7);

  await runWithWorkspace(workspaceId, async () => {
    await saveCanonicalProducts({ provider: "mercado_livre", connectionId: ML_CONN }, buildProducts(ML_ITEMS, "mercado_livre"));
    await saveCanonicalProducts({ provider: "amazon", connectionId: AMZ_CONN }, buildProducts(AMZ_ITEMS, "amazon"));
    await saveCanonicalOrders({ provider: "mercado_livre", connectionId: ML_CONN }, mlOrders);
    await saveCanonicalOrders({ provider: "amazon", connectionId: AMZ_CONN }, amzOrders);
  });

  const counts = await dbQuery(
    `SELECT provider, COUNT(*)::text AS total FROM workspace_channel_orders WHERE workspace_id = $1 GROUP BY provider`,
    [workspaceId]
  );
  const countRows = Array.isArray(counts) ? counts : counts.rows;
  console.log("workspace:", workspaceId);
  for (const row of countRows) console.log(`pedidos ${row.provider}: ${row.total}`);
  console.log("ML gerados:", mlOrders.length, "| Amazon gerados:", amzOrders.length);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error("seed falhou:", error);
  process.exit(1);
});
