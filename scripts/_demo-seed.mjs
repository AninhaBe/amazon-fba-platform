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
  // Exigido so aqui: com `--workspace <id>` o seed reaproveita um workspace demo
  // que ja existe e nao toca no Supabase Auth, entao pedir a senha seria barrar
  // um caminho que nao a usa.
  if (!DEMO_PASSWORD) throw new Error("Defina DEMO_PASSWORD no ambiente (ou use --workspace <id>).");
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

/** Meia-noite de Brasilia do dia de `ms`. Brasil nao tem horario de verao desde 2019. */
const inicioDoDiaBr = (ms) =>
  new Date(`${new Date(ms - 3 * 60 * 60_000).toISOString().slice(0, 10)}T00:00:00-03:00`).getTime();

/**
 * ⚠️ PEDIDO NENHUM PODE NASCER NO FUTURO.
 *
 * A versao anterior ancorava o dia em `now - day*24h` e somava ate 22 HORAS
 * dentro dele: o dia 0 saia inteiro adiante do relogio e os outros ficavam
 * deslocados. Medido em 27/08/2026 na demo: 1 a 7 pedidos por canal com
 * `occurred_at` amanha, e HOJE quase vazio — dai o NEXO narrar "faturamento dos
 * quatro canais desconhecido hoje" com a tela cheia de venda.
 *
 * Aqui cada dia comeca a meia-noite de Brasilia e o dia corrente so ocupa as
 * horas que ja passaram, com o volume proporcional a elas: hoje aparece, com
 * numero modesto, porque o dia ainda nao acabou.
 */
function buildOrders(provider, items, days, perDayAvg, seed) {
  const rand = mulberry32(seed);
  const orders = [];
  const now = Date.now();
  const hojeBr = inicioDoDiaBr(now);
  const weights = items.flatMap((item, index) => Array(item.weight).fill(index));
  let sequence = 1000;

  for (let day = days; day >= 0; day--) {
    const dayStart = hojeBr - day * 24 * 60 * 60 * 1000;
    // Janela util do dia: 22h nos dias fechados, o que ja correu no dia de hoje.
    const janela = day === 0 ? Math.max(0, Math.min(22 * 60 * 60_000, now - dayStart)) : 22 * 60 * 60_000;
    const fracao = janela / (22 * 60 * 60_000);
    // Piso de 2 no dia corrente: com 1 so pedido, um cancelamento ou uma venda
    // ainda nao paga zerava a receita de HOJE naquele canal — que e justamente o
    // buraco que o narrador reportava.
    const count = Math.max(
      day === 0 && fracao > 0 ? 3 : 0,
      Math.round((perDayAvg + (rand() - 0.5) * perDayAvg * 1.4) * fracao)
    );
    for (let i = 0; i < count; i++) {
      const item = items[weights[Math.floor(rand() * weights.length)]];
      const qty = rand() < 0.85 ? 1 : 2;
      const gross = Number((item.price * qty).toFixed(2));
      const occurred = new Date(Math.min(now, dayStart + Math.floor(rand() * janela)));
      // As duas primeiras vendas do dia corrente sao sempre receita: o dia de
      // hoje precisa existir na base de TODO canal, e sorteio nao garante isso.
      const primeirasDeHoje = day === 0 && i < 2;
      const cancelled = !primeirasDeHoje && rand() < 0.06;
      const delivered = day > 7 || rand() < 0.5;
      // Venda de hoje que o comprador ainda nao pagou existe de verdade, e e ela
      // que da ao painel "Quando o dinheiro cai" o que esta RETIDO sem extrato.
      // A terceira de hoje fica sempre AGUARDANDO. Ela e a venda que o TikTok
      // ainda nao liquidou, e sem pelo menos uma o card "Retido pelo TikTok"
      // volta ao travessao — a loja real sempre tem alguma nesse estado.
      const aguardando = day === 0 && !cancelled && (i === 2 || (!primeirasDeHoje && rand() < 0.5));
      const status = cancelled ? "cancelled" : aguardando ? "pending" : delivered ? "delivered" : day > 2 ? "shipped" : "paid";
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
        // ⚠️ `_sellercore` NAO passa por aqui. `saveCanonicalOrders` chama
        // `stripReservedCanonicalMetadata`, que apaga o bloco reservado do raw
        // que chega de fora — so a plataforma escreve nele. O seed antigo
        // mandava `statementSettled` aqui e ele nunca chegava ao banco: medido
        // em 27/08/2026, os 234 pedidos da demo estavam com a marca AUSENTE, o
        // `financial_backlog` do sync marcava 225 e a fase do dashboard caia
        // para "partial" — a faixa "BR · Sincronizando" sobre totais oficiais.
        // A marca correta e gravada depois, em `marcarExtratoDaDemo`.
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

/**
 * RETIDO SEM EXTRATO — a metade do painel "Quando o dinheiro cai" que o extrato
 * liquidado nao responde.
 *
 * `/api/integrations/tiktok/saldo` NAO le a mesma fatia do Financeiro: ele pega
 * so transacao `unsettled` e as dos extratos com repasse ainda a pagar. Com o
 * seed antigo — 50 transacoes, todas `settled`, e zero repasse — as duas
 * consultas voltavam vazias e o painel dizia "Nenhuma movimentacao financeira
 * sincronizada" ao lado de um Financeiro cheio.
 *
 * Aqui entram os pedidos AGUARDANDO (status `pending`, que ficam de fora de
 * `REVENUE_STATUSES` e por isso nao contam no `financial_backlog` do sync): o
 * TikTok estima o repasse e ainda nao diz a data — exatamente o que o endpoint
 * `/finance/202507/orders/unsettled` devolve.
 *
 * As CHECKs da 0005 mandam na forma: `unsettled` exige `is_estimated`,
 * `source_rank < 100` e, com `source_resource='unsettled'`, `statement_id` nulo.
 * `aggregateLedger` soma apenas `NOT is_estimated`, entao nada disto mexe em
 * faturamento, tarifa ou lucro do periodo.
 */
async function seedTiktokRetido(workspaceId, connectionId, orders) {
  const aguardando = orders.filter((order) => order.status === "pending");
  let gravadas = 0;
  for (const order of aguardando) {
    const commission = order.fees.find((fee) => fee.feeType === "commission")?.amount ?? 0;
    const frete = order.fees.find((fee) => fee.feeType === "shipping_seller")?.amount ?? 0;
    const estimado = Number((order.gross - commission - frete).toFixed(2));
    const transactionId = `demo-tx-unsettled-${order.externalOrderId}`;
    const hash = crypto.createHash("sha256").update(transactionId).digest();
    await dbQuery(
      `INSERT INTO workspace_financial_transactions
         (workspace_id, provider, connection_id, transaction_id, statement_id, order_id,
          transaction_type, occurred_at, currency, settlement_amount, settlement_state,
          is_estimated, source_resource, source_record_id, source_observed_at, source_rank,
          raw_allowlisted, raw_sha256)
       VALUES ($1,'tiktok_shop',$2,$3,NULL,$4,'ORDER',$5,'BRL',$6,'unsettled',
               TRUE,'unsettled',$3, now(), 50, '{"demo": true}'::jsonb, $7)
       ON CONFLICT (workspace_id, provider, connection_id, transaction_id) DO UPDATE SET
         settlement_amount = EXCLUDED.settlement_amount, occurred_at = EXCLUDED.occurred_at,
         updated_at = now()`,
      [workspaceId, connectionId, transactionId, order.externalOrderId, order.occurredAt, estimado, hash]
    );
    gravadas += 1;
  }
  return gravadas;
}

/**
 * REPASSES — a outra metade do painel do dinheiro, e a unica fonte de DATA.
 *
 * `workspace_financial_payments` nunca foi semeada, entao "A liberar com data" e
 * "Ja liberado" nao tinham de onde sair. Um repasse por extrato (um por dia):
 * os extratos mais antigos ja foram pagos (`paid_at`), os dos ultimos dias estao
 * agendados (`expected_at` no futuro, `paid_at` nulo) — que e o que faz o painel
 * dizer "Primeira liberacao em DD/MM" com a contagem de vendas do extrato.
 *
 * Valor = soma dos `settlement_amount` do proprio extrato. Nada inventado: o
 * numero do repasse bate com as transacoes que ele paga.
 */
async function seedTiktokRepasses(workspaceId, connectionId, agora = new Date()) {
  const extratos = await dbQuery(
    `SELECT statement_id, SUM(settlement_amount)::text AS valor, MIN(currency) AS currency,
            MAX(occurred_at) AS fim
       FROM workspace_financial_transactions
      WHERE workspace_id=$1 AND provider='tiktok_shop' AND connection_id=$2
        AND settlement_state='settled' AND statement_id IS NOT NULL
      GROUP BY statement_id ORDER BY statement_id`,
    [workspaceId, connectionId]
  );
  // D+7 e o prazo que a demo conta na tela; extrato fechado ha mais que isso ja
  // caiu na conta, o resto esta agendado.
  const PRAZO_MS = 7 * 24 * 60 * 60_000;
  let gravados = 0;
  for (const extrato of extratos) {
    const previsto = new Date(new Date(extrato.fim).getTime() + PRAZO_MS);
    const pago = previsto.getTime() <= agora.getTime() ? previsto : null;
    const paymentId = `demo-pay-${extrato.statement_id}`;
    const hash = crypto.createHash("sha256").update(paymentId).digest();
    await dbQuery(
      `INSERT INTO workspace_financial_payments
         (workspace_id, provider, connection_id, payment_id, statement_id, status,
          amount, currency, paid_at, expected_at, is_estimated, source_observed_at, raw_sha256)
       VALUES ($1,'tiktok_shop',$2,$3,$4,$5,$6,$7,$8,$9,FALSE, now(), $10)
       ON CONFLICT (workspace_id, provider, connection_id, payment_id) DO UPDATE SET
         statement_id = EXCLUDED.statement_id, status = EXCLUDED.status, amount = EXCLUDED.amount,
         paid_at = EXCLUDED.paid_at, expected_at = EXCLUDED.expected_at, updated_at = now()`,
      [workspaceId, connectionId, paymentId, extrato.statement_id, pago ? "PAID" : "PROCESSING",
       Number(extrato.valor).toFixed(2), extrato.currency ?? "BRL", pago, previsto, hash]
    );
    gravados += 1;
  }
  return gravados;
}

/**
 * MARCA DE EXTRATO NO PEDIDO — o que `saveCanonicalOrders` recusa a gravar.
 *
 * `stripReservedCanonicalMetadata` apaga `_sellercore` de qualquer raw que chega
 * de fora: o bloco reservado so e escrito pela plataforma. Por isso a marca vai
 * num UPDATE proprio, com o MESMO merge jsonb que o sync real usa
 * (`TIKTOK_STATEMENT_MARK_SQL` em tiktokSyncControl.ts) — sem apagar nada que ja
 * esteja no bloco.
 *
 * Sem ela, `financial_backlog` conta TODO pedido de receita da conexao e
 * `deriveTiktokSyncPhase` derruba a fase para "partial": o dashboard mostra
 * "BR · Sincronizando" e "Sincronizacao em andamento" em cima de total oficial.
 * Pedido `pending` fica de fora de proposito — ele e o retido, e nao esta em
 * extrato nenhum.
 */
async function marcarExtratoDaDemo(workspaceId, connectionId, orders) {
  const REVENUE = new Set(["paid", "shipped", "delivered"]);
  const ids = orders.filter((order) => REVENUE.has(order.status)).map((order) => order.externalOrderId);
  if (!ids.length) return 0;
  const marcados = await dbQuery(
    `UPDATE workspace_channel_orders
        SET raw = COALESCE(raw,'{}'::jsonb) || jsonb_build_object('_sellercore',
              COALESCE(raw->'_sellercore','{}'::jsonb) || jsonb_build_object(
                'statementSettled', true,
                'financialEvidence', jsonb_build_object(
                  'fees', true, 'sellerShipping', true, 'ads', true,
                  'taxesWithheld', true, 'refunds', true)))
      WHERE workspace_id=$1 AND provider='tiktok_shop' AND connection_id=$2
        AND external_order_id = ANY($3::text[])
      RETURNING 1`,
    [workspaceId, connectionId, ids]
  );
  return marcados.length;
}

/**
 * Workspace alvo.
 *
 * Sem argumento: cria/atualiza o usuario demo no Supabase Auth e usa o
 * workspace dele — o caminho de sempre.
 *
 * Com `--workspace <id>`: reaproveita um workspace demo que JA existe, sem
 * tocar em Auth. Serve para os dois workspaces de demonstracao que existem hoje
 * (um deles nao tem TikTok).
 *
 * ⚠️ ISOLAMENTO: so aceita workspace cujas conexoes sao TODAS de demonstracao.
 * Um id de conta real e recusado aqui, antes de qualquer escrita.
 */
async function alvo() {
  const i = process.argv.indexOf("--workspace");
  if (i === -1) return { workspaceId: await ensureDemoUser(), novo: true };
  const workspaceId = process.argv[i + 1];
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId ?? "")) throw new Error("--workspace exige um UUID.");
  const conexoes = await dbQuery(
    `SELECT DISTINCT provider, connection_id FROM workspace_channel_orders WHERE workspace_id=$1`,
    [workspaceId]
  );
  if (!conexoes.length) throw new Error(`Workspace ${workspaceId} nao tem dado semeado; recusado.`);
  const reais = conexoes.filter((c) => !/(^|:)demo(-|$|:)/.test(c.connection_id));
  if (reais.length) {
    throw new Error(`Workspace ${workspaceId} tem conexao REAL (${reais.map((c) => c.provider).join(", ")}); recusado.`);
  }
  // `--canais a,b`: reafirma quais canais o workspace demo deve ter. Serve para
  // RESTAURAR um canal cujo dado foi limpo (a deteccao so enxerga o que sobrou),
  // nunca para inventar um canal que a demo nao tinha.
  const j = process.argv.indexOf("--canais");
  const pedidos = j === -1 ? null : String(process.argv[j + 1] ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  const CANAIS_VALIDOS = new Set(["amazon", "mercado_livre", "shopee", "tiktok_shop"]);
  if (pedidos?.some((c) => !CANAIS_VALIDOS.has(c))) throw new Error("--canais aceita apenas os quatro canais conhecidos.");
  return { workspaceId, novo: false, canais: new Set(pedidos ?? conexoes.map((c) => c.provider)) };
}

/**
 * Limpa o dado sintetico ANTES de regravar.
 *
 * O seed nao e idempotente por si: o id do pedido sai de um contador que anda
 * com o gerador aleatorio, entao mudar a quantidade por dia produz ids NOVOS e
 * o upsert deixaria os antigos para tras. Foi assim que sobraram pedidos com
 * `occurred_at` no futuro. Como `financial_backlog` e o painel do dinheiro
 * varrem a conexao inteira (sem periodo), sobra vira contradicao na tela.
 *
 * ⚠️ So aceita `connection_id` de demonstracao — o `alvo()` ja recusou workspace
 * com conexao real, e este segundo portao existe para o caso de alguem chamar a
 * funcao direto.
 */
async function limparCanalDaDemo(workspaceId, provider, connectionId) {
  if (!/(^|:)demo(-|$|:)/.test(connectionId)) {
    throw new Error(`limparCanalDaDemo recusou conexao nao-demo: ${connectionId}`);
  }
  const escopo = [workspaceId, provider, connectionId];
  // Ordem obrigatoria: `financial_transactions_order_fk` aponta para o pedido,
  // entao o ledger sai primeiro. Repasse nao referencia pedido, mas vai junto
  // para o extrato nao sobrar sem as transacoes que ele paga.
  if (provider === "tiktok_shop") {
    await dbQuery(`DELETE FROM workspace_financial_transactions WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3`, escopo);
    await dbQuery(`DELETE FROM workspace_financial_payments WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3`, escopo);
  }
  await dbQuery(`DELETE FROM workspace_channel_order_items WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3`, escopo);
  await dbQuery(`DELETE FROM workspace_channel_order_fees WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3`, escopo);
  await dbQuery(`DELETE FROM workspace_channel_orders WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3`, escopo);
}

async function main() {
  const { workspaceId, novo, canais } = await alvo();
  // No workspace existente, mexe so nos canais que ele ja tem: acrescentar um
  // canal que nao estava la nao e completar o seed, e redesenhar a demo.
  const temCanal = (provider) => novo || canais.has(provider);
  console.log("workspace alvo:", workspaceId, novo ? "(usuario demo)" : `(existente: ${[...canais].join(", ")})`);

  const ML_CONN = "mercado_livre:demo";
  const AMZ_CONN = "amazon:demo";

  const SHP_CONN = "shopee:demo";
  if (temCanal("mercado_livre")) await seedConnection(workspaceId, "mercado_livre", ML_CONN, "Loja Demo ML");
  if (temCanal("amazon")) await seedConnection(workspaceId, "amazon", AMZ_CONN, "Loja Demo Amazon");
  if (temCanal("shopee")) await seedConnection(workspaceId, "shopee", SHP_CONN, "Loja Demo Shopee");
  const TTS_SHOP = "demo-tiktok-shop";
  const TTS_CONN = tiktokConnectionId(TTS_SHOP);
  if (temCanal("tiktok_shop")) await seedTiktokShop(workspaceId, TTS_SHOP, "Loja Demo TikTok");
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
  for (const item of temCanal("tiktok_shop") ? TIKTOK_ITEMS : []) {
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

  for (const [provider, conexao] of [["mercado_livre", ML_CONN], ["amazon", AMZ_CONN], ["shopee", SHP_CONN], ["tiktok_shop", TTS_CONN]]) {
    if (temCanal(provider)) await limparCanalDaDemo(workspaceId, provider, conexao);
  }

  await runWithWorkspace(workspaceId, async () => {
    if (temCanal("mercado_livre")) {
      await saveCanonicalProducts({ provider: "mercado_livre", connectionId: ML_CONN }, buildProducts(ML_ITEMS, "mercado_livre"));
      await saveCanonicalOrders({ provider: "mercado_livre", connectionId: ML_CONN }, mlOrders);
    }
    if (temCanal("amazon")) {
      await saveCanonicalProducts({ provider: "amazon", connectionId: AMZ_CONN }, buildProducts(AMZ_ITEMS, "amazon"));
      await saveCanonicalOrders({ provider: "amazon", connectionId: AMZ_CONN }, amzOrders);
    }
    if (temCanal("shopee")) {
      await saveCanonicalProducts({ provider: "shopee", connectionId: SHP_CONN }, buildProducts(SHOPEE_ITEMS, "shopee"));
      await saveCanonicalOrders({ provider: "shopee", connectionId: SHP_CONN }, shpOrders);
    }
    if (temCanal("tiktok_shop")) {
      await saveCanonicalProducts({ provider: "tiktok_shop", connectionId: TTS_CONN }, buildProducts(TIKTOK_ITEMS, "tiktok_shop"));
      await saveCanonicalOrders({ provider: "tiktok_shop", connectionId: TTS_CONN }, ttsOrders);
    }
  });

  // Ordem obrigatoria: o extrato precisa existir antes de o repasse somar por
  // extrato, e a marca do pedido depende de nada mais.
  let ttsLedger = 0, ttsRetido = 0, ttsRepasses = 0, ttsMarcados = 0;
  if (temCanal("tiktok_shop")) {
    ttsLedger = await seedTiktokLedger(workspaceId, TTS_CONN, ttsOrders);
    ttsRetido = await seedTiktokRetido(workspaceId, TTS_CONN, ttsOrders);
    ttsRepasses = await seedTiktokRepasses(workspaceId, TTS_CONN);
    ttsMarcados = await marcarExtratoDaDemo(workspaceId, TTS_CONN, ttsOrders);
  }

  const counts = await dbQuery(
    `SELECT provider, COUNT(*)::text AS total FROM workspace_channel_orders WHERE workspace_id = $1 GROUP BY provider`,
    [workspaceId]
  );
  const countRows = Array.isArray(counts) ? counts : counts.rows;
  console.log("workspace:", workspaceId);
  for (const row of countRows) console.log(`pedidos ${row.provider}: ${row.total}`);
  console.log("gerados -> ML:", mlOrders.length, "| Amazon:", amzOrders.length, "| Shopee:", shpOrders.length, "| TikTok:", ttsOrders.length);
  console.log("extrato TikTok liquidado (transacoes):", ttsLedger);
  console.log("retido sem extrato (unsettled):", ttsRetido, "| repasses:", ttsRepasses, "| pedidos marcados com extrato:", ttsMarcados);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error("seed falhou:", error);
  process.exit(1);
});
