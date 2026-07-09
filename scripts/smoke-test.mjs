// Smoke test: usa as credenciais reais para (1) buscar um ASIN válido no catálogo BR
// e (2) estimar as taxas dele — provando o pipeline fees de ponta a ponta.
const HOST = "https://sellingpartnerapi-na.amazon.com";
const MP = process.env.DEFAULT_MARKETPLACE_ID;

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
  const d = await r.json();
  if (!r.ok) throw new Error("LWA: " + JSON.stringify(d));
  return d.access_token;
}

async function main() {
  const t = await token();
  const h = { "x-amz-access-token": t, "Content-Type": "application/json" };

  // 1) Buscar catálogo por uma palavra comum
  const url = new URL(HOST + "/catalog/2022-04-01/items");
  url.searchParams.set("marketplaceIds", MP);
  url.searchParams.set("keywords", "cadeira");
  url.searchParams.set("pageSize", "3");
  const cat = await fetch(url, { headers: h });
  const catData = await cat.json();
  console.log("CATALOG status:", cat.status);
  const items = catData.items || [];
  const asin = items[0]?.asin;
  console.log("ASINs encontrados:", items.map((i) => i.asin).join(", ") || "(nenhum)");
  if (!asin) {
    console.log("Resposta catálogo:", JSON.stringify(catData).slice(0, 400));
    return;
  }

  // 2) Estimar taxas desse ASIN
  const feeBody = {
    FeesEstimateRequest: {
      MarketplaceId: MP,
      IsAmazonFulfilled: true,
      PriceToEstimateFees: {
        ListingPrice: { CurrencyCode: "BRL", Amount: 199.9 },
        Shipping: { CurrencyCode: "BRL", Amount: 0 },
      },
      Identifier: "smoke-" + asin,
    },
  };
  const fee = await fetch(HOST + `/products/fees/v0/items/${asin}/feesEstimate`, {
    method: "POST",
    headers: h,
    body: JSON.stringify(feeBody),
  });
  const feeData = await fee.json();
  console.log("FEES status:", fee.status);
  const est = feeData.payload?.FeesEstimateResult;
  console.log("Fee status:", est?.Status);
  if (est?.FeesEstimate) {
    console.log("Total fees:", est.FeesEstimate.TotalFeesEstimate);
    console.log(
      "Breakdown:",
      est.FeesEstimate.FeeDetailList.map((f) => `${f.FeeType}=${f.FinalFee.Amount}`).join(", ")
    );
  } else {
    console.log("Fee resp:", JSON.stringify(feeData).slice(0, 500));
  }
}

main().catch((e) => console.error("ERRO:", e.message));
