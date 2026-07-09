// Testa se o Catalog Items API devolve as dimensões (para calcular a tarifa de armazenagem).
const HOST = "https://sellingpartnerapi-na.amazon.com";
const MP = process.env.DEFAULT_MARKETPLACE_ID;
const ASIN = process.argv[2] || "B0F7GQ3SDK";

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
  const u = new URL(HOST + `/catalog/2022-04-01/items/${ASIN}`);
  u.searchParams.set("marketplaceIds", MP);
  u.searchParams.set("includedData", "dimensions,summaries");
  const r = await fetch(u, { headers: { "x-amz-access-token": t } });
  const d = await r.json();
  console.log("status:", r.status);
  console.log("dimensions:", JSON.stringify(d.dimensions, null, 2));
}

main().catch((e) => console.error("ERRO:", e.message));
