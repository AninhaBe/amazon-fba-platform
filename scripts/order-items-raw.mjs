// Dump cru de getOrderItems: mostra TODOS os campos de preço que a Amazon manda
// por item, sem nenhuma normalização nossa no meio.
//
// Existe porque em 21/08/2026 sete pedidos apareciam com valores diferentes entre
// o Seller Central e o nosso banco, e nós descartamos o `PromotionDiscount` na
// ingestão — não havia como saber se a diferença era cupom resgatado ou mudança
// de preço. Esta sonda responde com dado da fonte, não com dedução.
//
// Uso: node --env-file-if-exists=.env.local scripts/order-items-raw.mjs <orderId> [orderId...]
const HOST = "https://sellingpartnerapi-na.amazon.com";

async function token() {
  const r = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.LWA_REFRESH_TOKEN,
      client_id: process.env.LWA_CLIENT_ID,
      client_secret: process.env.LWA_CLIENT_SECRET,
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`LWA recusou: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

const money = (m) => (m?.Amount === undefined ? "—" : `${m.Amount} ${m.CurrencyCode ?? ""}`.trim());

const ids = process.argv.slice(2);
if (!ids.length) throw new Error("informe ao menos um orderId");

const t = await token();
for (const id of ids) {
  const r = await fetch(`${HOST}/orders/v0/orders/${id}/orderItems`, {
    headers: { "x-amz-access-token": t, accept: "application/json" },
  });
  if (!r.ok) {
    console.log(`\n${id}: HTTP ${r.status} — ${(await r.text()).slice(0, 160)}`);
    continue;
  }
  const items = (await r.json())?.payload?.OrderItems ?? [];
  console.log(`\n=== ${id} · ${items.length} item(ns)`);
  for (const it of items) {
    console.log(`  SKU ${it.SellerSKU} · qtd ${it.QuantityOrdered}`);
    console.log(`    ItemPrice ......... ${money(it.ItemPrice)}`);
    console.log(`    PromotionDiscount . ${money(it.PromotionDiscount)}`);
    console.log(`    ShippingPrice ..... ${money(it.ShippingPrice)}`);
    console.log(`    ShippingDiscount .. ${money(it.ShippingDiscount)}`);
    console.log(`    ItemTax ........... ${money(it.ItemTax)}`);
    if (it.PromotionIds?.length) console.log(`    PromotionIds ...... ${it.PromotionIds.join(", ")}`);
    const liq = Number(it.ItemPrice?.Amount ?? 0) - Number(it.PromotionDiscount?.Amount ?? 0);
    console.log(`    => liquido do produto: ${liq.toFixed(2)}`);
  }
  // getOrderItems é limitada a ~0,5 req/s; espaçar evita 429 em lote.
  await new Promise((r) => setTimeout(r, 2200));
}
