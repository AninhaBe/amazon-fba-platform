// Verifica se a Catalog Items API traz alguma data de criação/disponibilização do anúncio.
const HOST = "https://sellingpartnerapi-na.amazon.com";
const MP = process.env.DEFAULT_MARKETPLACE_ID;
const ASINS = process.argv.slice(2).length ? process.argv.slice(2) : ["B0CG8LWT97", "B0H8BFKFD5", "B08N5WRWNW"];

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

function findDates(obj, path = "") {
  const hits = [];
  const walk = (o, p) => {
    if (o == null) return;
    if (Array.isArray(o)) return o.forEach((v, i) => walk(v, `${p}[${i}]`));
    if (typeof o === "object") {
      for (const [k, v] of Object.entries(o)) {
        const np = p ? `${p}.${k}` : k;
        if (/date|release|available|since|launch|created/i.test(k)) hits.push(`${np} = ${JSON.stringify(v)}`);
        walk(v, np);
      }
    }
  };
  walk(obj, path);
  return hits;
}

async function main() {
  const t = await token();
  for (const asin of ASINS) {
    const u = new URL(HOST + `/catalog/2022-04-01/items/${asin}`);
    u.searchParams.set("marketplaceIds", MP);
    u.searchParams.set("includedData", "summaries,attributes");
    const r = await fetch(u, { headers: { "x-amz-access-token": t } });
    const d = await r.json();
    console.log(`\n===== ${asin} (status ${r.status}) =====`);
    if (r.status !== 200) { console.log(JSON.stringify(d).slice(0, 300)); continue; }
    const dates = findDates(d);
    console.log("campos com cara de data:", dates.length ? "" : "(nenhum)");
    dates.forEach((h) => console.log("  " + h));
    // Mostra também as chaves de attributes disponíveis
    const attrKeys = d.attributes ? Object.keys(d.attributes) : [];
    console.log("chaves de attributes:", attrKeys.join(", ").slice(0, 400) || "(sem attributes)");
  }
}

main().catch((e) => console.error("ERRO:", e.message));
