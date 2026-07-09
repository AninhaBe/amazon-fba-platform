// Testa a FBA Inventory API (getInventorySummaries) na conta real.
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
  return (await r.json()).access_token;
}

async function main() {
  const t = await token();
  const u = new URL(HOST + "/fba/inventory/v1/summaries");
  u.searchParams.set("granularityType", "Marketplace");
  u.searchParams.set("granularityId", MP);
  u.searchParams.set("marketplaceIds", MP);
  u.searchParams.set("details", "true");

  const r = await fetch(u, { headers: { "x-amz-access-token": t } });
  const d = await r.json();
  console.log("status:", r.status);
  const list = d.payload?.inventorySummaries;
  if (!list) {
    console.log("resp:", JSON.stringify(d).slice(0, 500));
    return;
  }
  console.log("SKUs:", list.length);
  if (list[0]) console.log("Exemplo:", JSON.stringify(list[0], null, 2));
}

main().catch((e) => console.error("ERRO:", e.message));
