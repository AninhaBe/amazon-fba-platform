// Roda o relatório GET_MERCHANT_LISTINGS_ALL_DATA e mostra o conteúdo bruto.
import zlib from "zlib";
const HOST = "https://sellingpartnerapi-na.amazon.com";
const MP = process.env.DEFAULT_MARKETPLACE_ID;
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
  return (await r.json()).access_token;
}

async function api(path, opts = {}) {
  const t = await token();
  const url = new URL(HOST + path);
  for (const [k, v] of Object.entries(opts.query || {})) url.searchParams.set(k, v);
  const r = await fetch(url, {
    method: opts.method || "GET",
    headers: { "x-amz-access-token": t, "Content-Type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}

async function tryReport(reportType) {
  console.log(`\n===== ${reportType} =====`);
  const c = await api("/reports/2021-06-30/reports", {
    method: "POST",
    body: { reportType, marketplaceIds: [MP] },
  });
  if (!c.data.reportId) {
    console.log("falha ao criar:", JSON.stringify(c.data).slice(0, 300));
    return;
  }
  let docId, status;
  for (let i = 0; i < 20; i++) {
    const rep = await api(`/reports/2021-06-30/reports/${c.data.reportId}`);
    status = rep.data.processingStatus;
    if (status === "DONE") { docId = rep.data.reportDocumentId; break; }
    if (["FATAL", "CANCELLED"].includes(status)) { console.log("status:", status); return; }
    await sleep(3000);
  }
  if (!docId) { console.log("timeout, último status:", status); return; }
  const doc = await api(`/reports/2021-06-30/documents/${docId}`);
  const res = await fetch(doc.data.url);
  const buf = Buffer.from(await res.arrayBuffer());
  const raw = doc.data.compressionAlgorithm === "GZIP" ? zlib.gunzipSync(buf) : buf;
  const text = raw.toString("latin1");
  const lines = text.split(/\r?\n/).filter((l) => l);
  console.log("linhas (com cabeçalho):", lines.length);
  console.log("CABEÇALHO:", lines[0]);
  for (const l of lines.slice(1, 6)) console.log("  linha:", l.slice(0, 200));
  const hit = lines.find((l) => l.includes("B0H8BFKFD5"));
  console.log(hit ? "\n>>> ACHOU B0H8BFKFD5: " + hit : "\n>>> ASIN B0H8BFKFD5 NÃO está no relatório");
}

await tryReport("GET_MERCHANT_LISTINGS_ALL_DATA");
