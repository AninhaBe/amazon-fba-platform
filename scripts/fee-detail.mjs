// Dump completo da estimativa de taxas de um ASIN: preço, TotalFeesEstimate e cada FeeDetail
// (incluindo sub-fees e impostos), para comparar com a Revenue Calculator da Amazon.
const HOST = "https://sellingpartnerapi-na.amazon.com";
const MP = process.env.DEFAULT_MARKETPLACE_ID;
const ASIN = process.argv[2] || "B0F7GQ3SDK";
const PRICE = process.argv[3] ? Number(process.argv[3]) : null;

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

function walk(list, indent = "  ") {
  for (const f of list || []) {
    console.log(
      `${indent}${f.FeeType}: FeeAmount=${f.FeeAmount?.Amount} ` +
        `Promo=${f.FeePromotion?.Amount ?? 0} Tax=${f.TaxAmount?.Amount ?? 0} ` +
        `=> FinalFee=${f.FinalFee?.Amount}`
    );
    if (f.IncludedFeeDetailList?.length) walk(f.IncludedFeeDetailList, indent + "    ");
  }
}

async function main() {
  const t = await token();
  const h = { "x-amz-access-token": t };

  // Descobrir o preço do Buy Box se não veio por argumento
  let price = PRICE;
  if (price == null) {
    const u = new URL(HOST + `/products/pricing/v0/items/${ASIN}/offers`);
    u.searchParams.set("MarketplaceId", MP);
    u.searchParams.set("ItemCondition", "New");
    const r = await fetch(u, { headers: h });
    const d = await r.json();
    price = d.payload?.Summary?.BuyBoxPrices?.[0]?.ListingPrice?.Amount;
  }
  console.log("ASIN:", ASIN, "| Preço usado:", price);

  const body = {
    FeesEstimateRequest: {
      MarketplaceId: MP,
      IsAmazonFulfilled: true,
      PriceToEstimateFees: {
        ListingPrice: { CurrencyCode: "BRL", Amount: price },
        Shipping: { CurrencyCode: "BRL", Amount: 0 },
      },
      Identifier: "detail-" + ASIN,
    },
  };
  const r = await fetch(HOST + `/products/fees/v0/items/${ASIN}/feesEstimate`, {
    method: "POST",
    headers: { ...h, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  const est = d.payload?.FeesEstimateResult?.FeesEstimate;
  if (!est) {
    console.log("Sem estimativa:", JSON.stringify(d).slice(0, 400));
    return;
  }
  console.log("TotalFeesEstimate:", est.TotalFeesEstimate.Amount, est.TotalFeesEstimate.CurrencyCode);
  console.log("FeeDetailList:");
  walk(est.FeeDetailList);
  const sum = (est.FeeDetailList || []).reduce((s, f) => s + (f.FinalFee?.Amount || 0), 0);
  console.log("Soma FinalFee (topo):", sum.toFixed(2));
}

main().catch((e) => console.error("ERRO:", e.message));
