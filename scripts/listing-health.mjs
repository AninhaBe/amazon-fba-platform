// Saúde dos anúncios da Amazon: status de venda, problemas abertos e imagem principal.
//
// Serve para acompanhar sozinha se a Amazon aceitou ou suprimiu alguma coisa — em
// especial a imagem de capa composta, cuja checagem de política roda DEPOIS do envio
// (o `ACCEPTED` do PATCH só diz que a imagem foi ingerida, não que passou).
//
//   npm run listing:health              todos os SKUs em estoque/cadastrados
//   npm run listing:health kit-clips-320   um SKU específico
//
// Seller: usa AMAZON_SELLER_ID do .env.local; sem ela, cai no default abaixo.

const HOST = "https://sellingpartnerapi-na.amazon.com";
const MP = process.env.DEFAULT_MARKETPLACE_ID;
const SELLER = process.env.AMAZON_SELLER_ID || "AO62LVXJMX3AA";
const ONLY = process.argv.slice(2);

const RESET = "\x1b[0m", RED = "\x1b[31m", YEL = "\x1b[33m", GRN = "\x1b[32m", DIM = "\x1b[2m";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (!r.ok) throw new Error(`falha ao autenticar (${r.status}) — confira as chaves LWA no .env.local`);
  return (await r.json()).access_token;
}

async function listSkus(t) {
  const u = new URL(`${HOST}/fba/inventory/v1/summaries`);
  u.searchParams.set("granularityType", "Marketplace");
  u.searchParams.set("granularityId", MP);
  u.searchParams.set("marketplaceIds", MP);
  const r = await fetch(u, { headers: { "x-amz-access-token": t } });
  const d = await r.json();
  const skus = (d.payload?.inventorySummaries ?? []).map((i) => i.sellerSku).filter(Boolean);
  return [...new Set(skus)];
}

async function checkOne(t, sku) {
  const u = new URL(`${HOST}/listings/2021-08-01/items/${SELLER}/${encodeURIComponent(sku)}`);
  u.searchParams.set("marketplaceIds", MP);
  u.searchParams.set("includedData", "issues,summaries,attributes");
  const r = await fetch(u, { headers: { "x-amz-access-token": t } });
  // 404 = SKU existe no inventário mas não tem anúncio. É resíduo de catálogo, não
  // problema do anúncio — separar, senão vira alarme falso e o relatório perde valor.
  if (r.status === 404) return { sku, semAnuncio: true };
  if (!r.ok) return { sku, erro: `HTTP ${r.status}` };
  const d = await r.json();
  const s = d.summaries?.[0] ?? {};
  const main = d.attributes?.main_product_image_locator?.[0]?.media_location ?? null;
  const outras = Object.keys(d.attributes ?? {}).filter((k) => k.startsWith("other_product_image_locator_")).length;
  return {
    sku,
    titulo: s.itemName ?? "—",
    status: s.status ?? [],           // ex.: ["BUYABLE","DISCOVERABLE"]
    issues: d.issues ?? [],
    imagemPrincipal: main,
    totalImagens: main ? outras + 1 : outras,
  };
}

function pinta(sev) {
  return sev === "ERROR" ? RED : sev === "WARNING" ? YEL : DIM;
}

async function main() {
  if (!MP) throw new Error("DEFAULT_MARKETPLACE_ID ausente no .env.local");
  const t = await token();
  const skus = ONLY.length ? ONLY : await listSkus(t);
  if (!skus.length) {
    console.log("Nenhum SKU encontrado no inventário. Passe um SKU: npm run listing:health <sku>");
    return;
  }

  console.log(`Conta ${SELLER} · ${skus.length} anúncio(s)\n`);
  let erros = 0, avisos = 0, suprimidos = 0;
  const semAnuncio = [];

  for (const sku of skus) {
    const r = await checkOne(t, sku);
    await sleep(250); // respeita o rate limit do Listings Items

    if (r.semAnuncio) {
      semAnuncio.push(sku);
      continue;
    }
    if (r.erro) {
      console.log(`${RED}✗${RESET} ${sku} — ${r.erro}`);
      erros++;
      continue;
    }

    const vendavel = r.status.includes("BUYABLE");
    const achavel = r.status.includes("DISCOVERABLE");
    // Sem BUYABLE costuma ser só falta de estoque; sem DISCOVERABLE é sinal de supressão.
    const marca = !achavel ? `${RED}⛔${RESET}` : r.issues.some((i) => i.severity === "ERROR") ? `${RED}✗${RESET}` : r.issues.length ? `${YEL}!${RESET}` : `${GRN}✓${RESET}`;
    if (!achavel) suprimidos++;

    console.log(`${marca} ${sku} ${DIM}${r.titulo.slice(0, 52)}${RESET}`);
    console.log(`   status: ${r.status.join(", ") || "—"}${vendavel ? "" : `  ${DIM}(sem oferta compráve — normalmente estoque zerado)${RESET}`}`);
    console.log(`   imagens: ${r.totalImagens}  ${DIM}principal: ${r.imagemPrincipal?.split("/").pop() ?? "nenhuma"}${RESET}`);

    for (const i of r.issues) {
      const img = /image|imagem/i.test(`${i.code} ${i.message}`);
      console.log(`   ${pinta(i.severity)}[${i.severity}]${RESET} ${i.code}${img ? " (IMAGEM)" : ""} — ${i.message}`);
      if (i.severity === "ERROR") erros++; else avisos++;
    }
    console.log("");
  }

  console.log("─".repeat(60));
  console.log(`${erros ? RED : GRN}${erros} erro(s)${RESET} · ${avisos} aviso(s) · ${suprimidos ? RED : GRN}${suprimidos} não encontrável(is)${RESET}`);
  if (semAnuncio.length) {
    console.log(`\n${DIM}${semAnuncio.length} SKU(s) no inventário sem anúncio (resíduo de catálogo, não é problema):${RESET}`);
    console.log(`${DIM}  ${semAnuncio.join(", ")}${RESET}`);
  }
  if (suprimidos) {
    console.log(`\n${RED}Atenção:${RESET} anúncio sem DISCOVERABLE não aparece na busca — é o sintoma de supressão.`);
    console.log("Se for por causa da imagem de capa, dá pra reverter para a anterior.");
  }
  process.exitCode = erros || suprimidos ? 1 : 0;
}

main().catch((e) => {
  console.error(`${RED}ERRO:${RESET}`, e.message);
  process.exitCode = 1;
});
