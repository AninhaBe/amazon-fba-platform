// Testa endpoints de preço da Product Pricing API para achar o melhor p/ puxar o preço atual.
const HOST = "https://sellingpartnerapi-na.amazon.com";
const MP = process.env.DEFAULT_MARKETPLACE_ID;
const ASIN = process.argv[2] || "B0CG8LWT97";

async function token() {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: process.env.LWA_REFRESH_TOKEN,
    client_id: process.env.LWA_CLIENT_ID,
    client_secret: process.env.LWA_CLIENT_SECRET,
  });
  const r = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return (await r.json()).access_token;
}

async function main() {
  const t = await token();
  const h = { "x-amz-access-token": t };

  // A) getItemOffers -> buy box / menores preços
  const u1 = new URL(HOST + `/products/pricing/v0/items/${ASIN}/offers`);
  u1.searchParams.set("MarketplaceId", MP);
  u1.searchParams.set("ItemCondition", "New");
  const r1 = await fetch(u1, { headers: h });
  const d1 = await r1.json();
  console.log("== getItemOffers status:", r1.status);
  const summary = d1.payload?.Summary;
  if (summary) {
    console.log("  BuyBox:", JSON.stringify(summary.BuyBoxPrices));
    console.log("  LowestPrices:", JSON.stringify(summary.LowestPrices?.slice(0, 2)));
    console.log("  ListPrice:", JSON.stringify(summary.ListPrice));
  } else {
    console.log("  resp:", JSON.stringify(d1).slice(0, 300));
  }

  // B) getPricing -> preço (inclui seu próprio offer se houver)
  const u2 = new URL(HOST + "/products/pricing/v0/price");
  u2.searchParams.set("MarketplaceId", MP);
  u2.searchParams.set("Asins", ASIN);
  u2.searchParams.set("ItemType", "Asin");
  const r2 = await fetch(u2, { headers: h });
  const d2 = await r2.json();
  console.log("== getPricing status:", r2.status);
  console.log("  resp:", JSON.stringify(d2).slice(0, 400));
}

main().catch((e) => console.error("ERRO:", e.message));
