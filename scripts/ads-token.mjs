// PASSO 2 do OAuth do Amazon Ads: troca o "code" pelo refresh_token.
// Uso:  node --env-file=.env.local scripts/ads-token.mjs "<code copiado da URL>"

const code = process.argv[2];
const CLIENT_ID = process.env.ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.ADS_CLIENT_SECRET;
const REDIRECT = process.env.ADS_REDIRECT_URI;

if (!code) {
  console.error('Passe o code: node --env-file=.env.local scripts/ads-token.mjs "<code>"');
  process.exit(1);
}

const body = new URLSearchParams({
  grant_type: "authorization_code",
  code,
  redirect_uri: REDIRECT,
  client_id: CLIENT_ID,
  client_secret: CLIENT_SECRET,
});

const r = await fetch("https://api.amazon.com/auth/o2/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body,
});
const d = await r.json();

if (!r.ok) {
  console.error("Falha:", JSON.stringify(d));
  process.exit(1);
}

console.log("\n✅ Refresh token gerado. Cole no .env.local em ADS_REFRESH_TOKEN:\n");
console.log("ADS_REFRESH_TOKEN=" + d.refresh_token);
console.log(
  "\nDepois rode  node --env-file=.env.local scripts/ads-profiles.mjs  para achar o ADS_PROFILE_ID.\n"
);
