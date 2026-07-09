// Testa a Finances API v0 (listFinancialEvents) na conta real.
const HOST = "https://sellingpartnerapi-na.amazon.com";
const DAYS = Number(process.argv[2] || 180);

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
  const postedAfter = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const u = new URL(HOST + "/finances/v0/financialEvents");
  u.searchParams.set("PostedAfter", postedAfter);
  u.searchParams.set("MaxResultsPerPage", "100");

  const r = await fetch(u, { headers: { "x-amz-access-token": t } });
  const d = await r.json();
  console.log("status:", r.status);
  const ev = d.payload?.FinancialEvents;
  if (!ev) {
    console.log("resp:", JSON.stringify(d).slice(0, 400));
    return;
  }
  console.log("Chaves de eventos com dados:");
  for (const [k, v] of Object.entries(ev)) {
    if (Array.isArray(v) && v.length) console.log(`  ${k}: ${v.length}`);
  }
  const ships = ev.ShipmentEventList || [];
  console.log("ShipmentEvents:", ships.length);
  if (ships[0]) {
    console.log("Exemplo (1º shipment item):");
    const item = ships[0].ShipmentItemList?.[0];
    console.log("  charges:", JSON.stringify(item?.ItemChargeList));
    console.log("  fees:", JSON.stringify(item?.ItemFeeList));
  }
}

main().catch((e) => console.error("ERRO:", e.message));
