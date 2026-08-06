// Monitor local do estoque FBA — acompanha quando as unidades saem de
// "transferência interna" e viram vendáveis.
//
// Rodar: node --experimental-transform-types --import ./scripts/ts-resolver.mjs --env-file=.env.local scripts/fba-monitor.mjs
// Abrir: http://localhost:4310
//
// Usa o LWA_REFRESH_TOKEN do ambiente (conta dona) — não depende da conexão
// OAuth do app, que hoje está revogada. Somente leitura.

import { createServer } from "node:http";
import { runWithWorkspace } from "../src/lib/workspaceScope.ts";
import { spapiFetch } from "../src/lib/spapi.ts";

const PORT = Number(process.env.PORT || 4310);
const MARKETPLACE = "A2Q3Y263D00KWC";
const WORKSPACE = process.env.WORKSPACE_ID || "monitor";
const REFRESH_MS = Number(process.env.REFRESH_MS || 5 * 60_000);

let snapshot = { at: null, items: [], shipments: [], error: null };
let previous = new Map();

async function load() {
  try {
    const data = await runWithWorkspace(WORKSPACE, async () => {
      const inv = await spapiFetch("/fba/inventory/v1/summaries", {
        query: {
          granularityType: "Marketplace",
          granularityId: MARKETPLACE,
          marketplaceIds: MARKETPLACE,
          details: "true",
        },
      });
      const summaries = inv?.payload?.inventorySummaries ?? inv?.inventorySummaries ?? [];

      let shipments = [];
      try {
        const res = await spapiFetch("/fba/inbound/v0/shipments", {
          query: {
            QueryType: "SHIPMENT",
            ShipmentStatusList: "WORKING,SHIPPED,IN_TRANSIT,DELIVERED,CHECKED_IN,RECEIVING,CLOSED",
            MarketplaceId: MARKETPLACE,
          },
        });
        shipments = res?.payload?.ShipmentData ?? res?.ShipmentData ?? [];
      } catch {
        // remessas são complemento; o estoque é o que importa
      }

      const items = summaries
        .map((item) => {
          const d = item.inventoryDetails ?? {};
          const reserved = d.reservedQuantity ?? {};
          return {
            sku: item.sellerSku,
            fnsku: item.fnSku,
            asin: item.asin,
            name: item.productName ?? "",
            available: d.fulfillableQuantity ?? 0,
            transshipment: reserved.pendingTransshipmentQuantity ?? 0,
            reserved: reserved.totalReservedQuantity ?? 0,
            receiving: d.inboundReceivingQuantity ?? 0,
            shipped: d.inboundShippedQuantity ?? 0,
            working: d.inboundWorkingQuantity ?? 0,
            total: item.totalQuantity ?? 0,
          };
        })
        .filter((item) => item.total > 0)
        .sort((a, b) => b.total - a.total);

      return { items, shipments };
    });

    // Marca o que mudou desde a última leitura — é o ponto do monitor.
    for (const item of data.items) {
      const before = previous.get(item.sku);
      item.delta = before == null ? 0 : item.available - before;
    }
    previous = new Map(data.items.map((item) => [item.sku, item.available]));

    snapshot = { at: new Date(), items: data.items, shipments: data.shipments, error: null };
    const vendaveis = data.items.reduce((sum, item) => sum + item.available, 0);
    console.log(`[${new Date().toLocaleTimeString("pt-BR")}] ok — ${data.items.length} SKUs, ${vendaveis} unidade(s) vendável(is)`);
  } catch (error) {
    snapshot = { ...snapshot, error: error?.message ?? String(error) };
    console.log(`[${new Date().toLocaleTimeString("pt-BR")}] falha: ${snapshot.error}`);
  }
}

function esc(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function page() {
  const totalAvailable = snapshot.items.reduce((sum, item) => sum + item.available, 0);
  const totalTransit = snapshot.items.reduce((sum, item) => sum + item.transshipment + item.receiving, 0);
  const rows = snapshot.items
    .map((item) => {
      const libre = item.available > 0;
      const delta = item.delta > 0 ? `<span class="delta">+${item.delta}</span>` : "";
      return `<tr class="${libre ? "is-live" : ""}">
        <td><strong>${esc(item.sku)}</strong><small>${esc(item.name.slice(0, 58))}</small></td>
        <td class="num big ${libre ? "ok" : "zero"}">${item.available}${delta}</td>
        <td class="num">${item.transshipment}</td>
        <td class="num">${item.receiving}</td>
        <td class="num">${item.total}</td>
      </tr>`;
    })
    .join("");

  const shipments = snapshot.shipments
    .map((s) => `<li><code>${esc(s.ShipmentId)}</code> <b>${esc(s.ShipmentStatus)}</b> ${esc(s.DestinationFulfillmentCenterId ?? "")}</li>`)
    .join("");

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Estoque FBA — ${totalAvailable} vendável(is)</title>
<meta http-equiv="refresh" content="60">
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --ink:#16181d; --muted:#6b7280; --line:#e5e7eb; --ok:#10786a; --zero:#9ca3af; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1114; --card:#181b20; --ink:#e8eaed; --muted:#9aa1ab; --line:#2a2f36; --ok:#34d3a6; --zero:#6b7280; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:28px 20px; background:var(--bg); color:var(--ink); font:15px/1.5 -apple-system,Segoe UI,system-ui,sans-serif; }
  .wrap { max-width:900px; margin:0 auto; }
  h1 { margin:0 0 4px; font-size:20px; letter-spacing:-.02em; }
  .sub { margin:0 0 20px; color:var(--muted); font-size:13px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin-bottom:22px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; }
  .card p { margin:0; color:var(--muted); font-size:11px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; }
  .card strong { display:block; margin-top:8px; font-size:30px; font-variant-numeric:tabular-nums; letter-spacing:-.03em; }
  .card.hi strong { color:var(--ok); }
  table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  th { padding:11px 14px; background:color-mix(in oklab, var(--card), var(--bg) 60%); color:var(--muted); font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; text-align:right; }
  th:first-child { text-align:left; }
  td { padding:12px 14px; border-top:1px solid var(--line); vertical-align:middle; }
  td small { display:block; color:var(--muted); font-size:12px; font-weight:400; }
  .num { text-align:right; font-variant-numeric:tabular-nums; }
  .big { font-size:19px; font-weight:700; }
  .ok { color:var(--ok); }
  .zero { color:var(--zero); }
  tr.is-live { background:color-mix(in oklab, var(--ok) 8%, transparent); }
  .delta { margin-left:6px; padding:1px 6px; border-radius:99px; background:var(--ok); color:#fff; font-size:11px; }
  ul { margin:10px 0 0; padding-left:18px; color:var(--muted); font-size:13px; }
  code { font-family:ui-monospace,Consolas,monospace; font-size:12px; }
  .foot { margin-top:20px; color:var(--muted); font-size:12px; }
  .err { border:1px solid #f3b0b0; background:#fdf2f2; color:#9b1c1c; padding:12px 14px; border-radius:10px; margin-bottom:16px; font-size:13px; }
  .head { display:flex; flex-wrap:wrap; align-items:flex-start; justify-content:space-between; gap:12px; }
  .refresh { display:inline-flex; align-items:center; gap:7px; min-height:38px; padding:0 15px; border:1px solid var(--line); border-radius:9px; background:var(--card); color:var(--ink); font:inherit; font-size:13px; font-weight:650; cursor:pointer; transition:border-color 140ms ease, transform 140ms ease; }
  .refresh:hover { border-color:var(--ok); }
  .refresh:active { transform:scale(.97); }
  .refresh[aria-busy="true"] { opacity:.6; pointer-events:none; }
  .refresh svg { width:15px; height:15px; }
  .refresh[aria-busy="true"] svg { animation:spin 900ms linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  @media (prefers-reduced-motion:reduce) { .refresh svg { animation:none !important; } }
</style></head><body><div class="wrap">
<div class="head">
  <div>
    <h1>Estoque FBA · Amazon</h1>
    <p class="sub">Atualiza sozinho a cada minuto. Leitura da SP-API a cada ${Math.round(REFRESH_MS / 60000)} min · última <b>${snapshot.at ? snapshot.at.toLocaleString("pt-BR") : "—"}</b></p>
  </div>
  <form method="POST" action="/refresh" onsubmit="this.querySelector('button').setAttribute('aria-busy','true')">
    <button class="refresh" type="submit">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>
      Consultar agora
    </button>
  </form>
</div>
${snapshot.error ? `<div class="err">${esc(snapshot.error)}</div>` : ""}
<div class="cards">
  <div class="card hi"><p>Vendável agora</p><strong>${totalAvailable}</strong></div>
  <div class="card"><p>Em trânsito interno</p><strong>${totalTransit}</strong></div>
  <div class="card"><p>Total no FBA</p><strong>${snapshot.items.reduce((s, i) => s + i.total, 0)}</strong></div>
</div>
<table>
  <thead><tr><th>SKU</th><th>Vendável</th><th>Transferência</th><th>Recebendo</th><th>Total</th></tr></thead>
  <tbody>${rows || `<tr><td colspan="5" style="color:var(--muted)">Sem dados ainda…</td></tr>`}</tbody>
</table>
${shipments ? `<div class="foot"><strong>Remessas</strong><ul>${shipments}</ul></div>` : ""}
<p class="foot">Unidades em <em>transferência</em> estão sendo redistribuídas entre centros da Amazon e não contam como vendáveis até concluir.</p>
</div></body></html>`;
}

const server = createServer(async (req, res) => {
  // Consulta sob demanda: quem está acompanhando não precisa esperar o ciclo.
  if (req.url === "/refresh") {
    await load();
    if (req.method === "POST") {
      res.writeHead(303, { Location: "/" });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(snapshot));
    return;
  }
  if (req.url === "/api") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(snapshot));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(page());
});

// Porta ocupada quase sempre significa "já tem um monitor rodando" — dizer isso
// é mais útil do que despejar um stack trace de EADDRINUSE.
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.log(`\n  Já existe um monitor rodando na porta ${PORT}.`);
    console.log(`  Abra http://localhost:${PORT} — ele continua funcionando.`);
    console.log(`  (Para subir outro em paralelo: PORT=4311 antes do comando.)\n`);
    process.exit(0);
  }
  console.error("\n  Falha ao subir o monitor:", error.message, "\n");
  process.exit(1);
});

server.listen(PORT, async () => {
  console.log(`\nMonitor de estoque FBA em http://localhost:${PORT}`);
  console.log(`Consultando a Amazon a cada ${Math.round(REFRESH_MS / 60000)} minuto(s). Ctrl+C para parar.\n`);
  // Primeira leitura só depois que a porta está garantida: se ela estiver
  // ocupada, não faz sentido gastar chamada na SP-API.
  await load();
  setInterval(load, REFRESH_MS);
});
