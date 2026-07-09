// Testa a Sales API (getOrderMetrics, granularidade diária) na conta real.
const HOST = "https://sellingpartnerapi-na.amazon.com";
const MP = process.env.DEFAULT_MARKETPLACE_ID;
const DAYS = Number(process.argv[2] || 30);

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

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const t = await token();
  const end = new Date();
  const start = new Date(Date.now() - DAYS * 86_400_000);
  // Intervalo com timezone de SP (-03:00), em fronteiras de dia.
  const interval = `${isoDate(start)}T00:00:00-03:00--${isoDate(end)}T00:00:00-03:00`;

  const u = new URL(HOST + "/sales/v1/orderMetrics");
  u.searchParams.set("marketplaceIds", MP);
  u.searchParams.set("interval", interval);
  u.searchParams.set("granularity", "Day");
  u.searchParams.set("granularityTimeZone", "America/Sao_Paulo");

  const r = await fetch(u, { headers: { "x-amz-access-token": t } });
  const d = await r.json();
  console.log("status:", r.status);
  const list = d.payload;
  if (!Array.isArray(list)) {
    console.log("resp:", JSON.stringify(d).slice(0, 500));
    return;
  }
  console.log("dias retornados:", list.length);
  console.log("exemplo:", JSON.stringify(list[0], null, 2));
}

main().catch((e) => console.error("ERRO:", e.message));
