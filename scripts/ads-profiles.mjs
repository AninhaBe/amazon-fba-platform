// PASSO 3: lista os profiles da Ads API (cada profile = uma conta/marketplace).
// Você precisa do profileId do Brasil para fazer chamadas.
// Uso:  node --env-file=.env.local scripts/ads-profiles.mjs

const CLIENT_ID = process.env.ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.ADS_CLIENT_SECRET;
const REFRESH = process.env.ADS_REFRESH_TOKEN;
const HOST = process.env.ADS_API_HOST || "https://advertising-api.amazon.com";

async function accessToken() {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: REFRESH,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const r = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const d = await r.json();
  if (!r.ok) throw new Error("token: " + JSON.stringify(d));
  return d.access_token;
}

const token = await accessToken();
const r = await fetch(HOST + "/v2/profiles", {
  headers: {
    Authorization: "Bearer " + token,
    "Amazon-Advertising-API-ClientId": CLIENT_ID,
  },
});
const profiles = await r.json();
console.log("status:", r.status);
if (!Array.isArray(profiles)) {
  console.log(JSON.stringify(profiles, null, 2));
} else {
  for (const p of profiles) {
    console.log(
      `profileId=${p.profileId}  país=${p.countryCode}  moeda=${p.currencyCode}  tipo=${p.accountInfo?.type}  nome=${p.accountInfo?.name}`
    );
  }
  const br = profiles.find((p) => p.countryCode === "BR");
  if (br) console.log("\n➡ Brasil: ADS_PROFILE_ID=" + br.profileId);
}
