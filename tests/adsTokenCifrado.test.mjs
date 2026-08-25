import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// O REFRESH TOKEN DA AMAZON ADS NÃO PODE FICAR EM CLARO NO BANCO.
//
// Ele não lê dado: ele GASTA DINHEIRO. Com esse token dá para criar campanha,
// subir lance e esvaziar o orçamento de anúncio da vendedora — é a credencial
// mais perigosa do produto.
//
// Em 25/08/2026, no dia em que o primeiro token foi emitido, ele era o único
// guardado como JSON legível em `workspace_settings`, enquanto Amazon, ML,
// Shopee e TikTok já passavam por AES-256-GCM.

const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

test("o token e cifrado antes de ir para o banco", () => {
  const s = fonte("src/lib/integrations/amazonAdsAuth.ts");
  assert.match(s, /protectSecret\(credentials\.refreshToken\)/, "saveAdsCredentials tem que cifrar");
  assert.doesNotMatch(
    s,
    /JSON\.stringify\(credentials\)/,
    "voltou a gravar o objeto cru — o refreshToken sairia em claro"
  );
});

test("a leitura decifra", () => {
  const s = fonte("src/lib/integrations/amazonAdsAuth.ts");
  assert.match(s, /revealSecret\(stored\.refreshToken\)/);
});

test("token gravado ANTES da cifragem continua funcionando", () => {
  // `revealSecret` devolve o texto puro quando não há prefixo `enc:v1:`. Sem
  // isso, ligar a cifragem quebraria a conexão que já existia e exigiria
  // reautorizar — que na Amazon Ads custou 12 dias para conseguir.
  const s = fonte("src/lib/integrations/secrets.ts");
  assert.match(s, /enc:v1:/, "o prefixo é o que distingue cifrado de legado");
});

test("nenhum canal guarda credencial em claro", () => {
  // Varredura: quem grava token tem que passar por protectSecret.
  for (const caminho of [
    "src/lib/integrations/amazonAdsAuth.ts",
    "src/lib/integrations/integrationStore.ts",
  ]) {
    const s = fonte(caminho);
    assert.match(s, /protectSecret/, `${caminho} grava credencial sem cifrar`);
  }
});
