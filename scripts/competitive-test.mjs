// Testa getCompetitivePricing (lote): preço competitivo + nº de ofertas/vendedores.
const HOST = "https://sellingpartnerapi-na.amazon.com";
const MP = process.env.DEFAULT_MARKETPLACE_ID;
const ASINS = process.argv.slice(2).length ? process.argv.slice(2) : ["B0CJV2WKQF", "B0D78RX8Y1", "B0GYQBPDG6"];

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
  const u = new URL(HOST + "/products/pricing/v0/competitivePrice");
  u.searchParams.set("MarketplaceId", MP);
  u.searchParams.set("ItemType", "Asin");
  u.searchParams.set("Asins", ASINS.join(","));
  const r = await fetch(u, { headers: { "x-amz-access-token": t } });
  const d = await r.json();
  console.log("status:", r.status);
  for (const p of d.payload || []) {
    const cp = p.Product?.CompetitivePricing;
    const price = cp?.CompetitivePrices?.find((c) => c.CompetitivePriceId === "1")?.Price?.ListingPrice;
    const sellers = cp?.NumberOfOfferListings || [];
    console.log(
      `  ${p.ASIN} | status:${p.status} | preço: ${price ? price.Amount + " " + price.CurrencyCode : "—"} | ofertas: ${JSON.stringify(sellers)}`
    );
  }
  if (!d.payload) console.log(JSON.stringify(d).slice(0, 400));
}

main().catch((e) => console.error("ERRO:", e.message));
