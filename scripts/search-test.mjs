// Testa searchCatalogItems (busca por palavra-chave) e se traz data de lançamento + BSR.
const HOST = "https://sellingpartnerapi-na.amazon.com";
const MP = process.env.DEFAULT_MARKETPLACE_ID;
const KW = process.argv.slice(2).join(" ") || "cadeira gamer";

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
  const u = new URL(HOST + "/catalog/2022-04-01/items");
  u.searchParams.set("marketplaceIds", MP);
  u.searchParams.set("keywords", KW);
  u.searchParams.set("includedData", "summaries,images,salesRanks,attributes");
  u.searchParams.set("pageSize", "10");
  const r = await fetch(u, { headers: { "x-amz-access-token": t } });
  const d = await r.json();
  console.log("status:", r.status, "| busca:", KW);
  const items = d.items || [];
  console.log("resultados:", items.length, "| total aprox:", d.numberOfResults);
  for (const it of items) {
    const s = it.summaries?.[0] || {};
    const launch = it.attributes?.product_site_launch_date?.[0]?.value;
    const rank = it.salesRanks?.[0]?.displayGroupRanks?.[0]?.rank
      || it.salesRanks?.[0]?.classificationRanks?.[0]?.rank;
    console.log(
      `  ${it.asin} | lançado: ${launch ? launch.slice(0, 10) : "—"} | BSR: ${rank ?? "—"} | ${(s.itemName || "").slice(0, 55)}`
    );
  }
  if (!items.length) console.log("resp:", JSON.stringify(d).slice(0, 300));
}

main().catch((e) => console.error("ERRO:", e.message));
