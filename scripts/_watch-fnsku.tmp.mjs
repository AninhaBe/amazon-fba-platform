import { dbQuery } from "../src/lib/db.ts";
import { runWithWorkspace } from "../src/lib/workspaceScope.ts";
import { runWithAccount } from "../src/lib/accountContext.ts";
import { revealSecret } from "../src/lib/integrations/secrets.ts";
import { spapiFetch } from "../src/lib/spapi.ts";
const a = (await dbQuery(`SELECT workspace_id, seller_id, refresh_token FROM workspace_accounts WHERE seller_id='AO62LVXJMX3AA'`))[0];
const MK="A2Q3Y263D00KWC", skus=['kitprote-8','kitprote-16','kitprote-32'];
await runWithWorkspace(a.workspace_id, () => runWithAccount({ sellerId:a.seller_id, refreshToken: revealSecret(a.refresh_token) ?? "" }, async () => {
  for (let i=1; i<=9; i++) { // ate ~90min, checagem a cada 10min
    const inv = await spapiFetch(`/fba/inventory/v1/summaries`, { query:{ granularityType:"Marketplace", granularityId:MK, marketplaceIds:MK, sellerSkus:skus.join(","), details:"true" } });
    const rows = skus.map(sku => {
      const s = (inv.payload?.inventorySummaries||[]).find(x=>x.sellerSku===sku);
      return `${sku}=${s?.fnSku||"—"}`;
    });
    console.log(`[check ${i}] ${rows.join("  ")}`);
    const done = skus.every(sku => (inv.payload?.inventorySummaries||[]).find(x=>x.sellerSku===sku)?.fnSku);
    if (done) { console.log("TODOS OS FNSKUS ATRIBUIDOS!"); break; }
    if (i<9) await new Promise(res=>setTimeout(res,600000));
  }
}));
process.exit(0);
