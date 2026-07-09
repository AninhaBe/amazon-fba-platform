// PASSO 1 do OAuth do Amazon Ads: gera a URL de consentimento para você abrir no navegador.
// Uso:  node --env-file=.env.local scripts/ads-auth-url.mjs
//
// Depois de aprovar no navegador, você será redirecionado para a ADS_REDIRECT_URI
// com um "?code=XXXX" na URL. Copie esse code e use no scripts/ads-token.mjs.

const CLIENT_ID = process.env.ADS_CLIENT_ID;
const REDIRECT = process.env.ADS_REDIRECT_URI;

if (!CLIENT_ID || !REDIRECT) {
  console.error("Defina ADS_CLIENT_ID e ADS_REDIRECT_URI no .env.local");
  process.exit(1);
}

// Endpoint de consentimento — Brasil/Américas usam amazon.com.
const url = new URL("https://www.amazon.com/ap/oa");
url.searchParams.set("client_id", CLIENT_ID);
url.searchParams.set("scope", "advertising::campaign_management");
url.searchParams.set("response_type", "code");
url.searchParams.set("redirect_uri", REDIRECT);

console.log("\nAbra esta URL no navegador (logado na sua conta Amazon de anúncios):\n");
console.log(url.toString());
console.log(
  "\nApós aprovar, copie o valor de 'code=' da URL de retorno e rode:\n" +
    "  node --env-file=.env.local scripts/ads-token.mjs \"<code>\"\n"
);
