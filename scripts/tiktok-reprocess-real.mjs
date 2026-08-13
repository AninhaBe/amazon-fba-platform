// Reprocessa conexoes TikTok existentes pelo pipeline atual, sem apagar o
// snapshot antes de uma substituicao valida e sem fazer chamadas mutantes ao
// marketplace. Nao imprime workspace, shop, pedido, token ou payload.
// Uso: CONFIRM_TIKTOK_REPROCESS=SIM node --experimental-strip-types \
//   --import ./scripts/ts-resolver.mjs --env-file=.env.local scripts/tiktok-reprocess-real.mjs

import { dbQuery, hasDb } from "../src/lib/db.ts";
import { runWithWorkspace } from "../src/lib/workspaceScope.ts";
import {
  requestTiktokFullReprocess,
  runTiktokSyncBatch,
} from "../src/lib/integrations/tiktokSync.ts";

if (!hasDb()) throw new Error("Variavel ausente: DATABASE_URL");
if (!process.env.TIKTOK_APP_KEY) throw new Error("Variavel ausente: TIKTOK_APP_KEY");
if (!process.env.TIKTOK_APP_SECRET) throw new Error("Variavel ausente: TIKTOK_APP_SECRET");
if (process.env.CONFIRM_TIKTOK_REPROCESS !== "SIM") {
  throw new Error("Defina CONFIRM_TIKTOK_REPROCESS=SIM para confirmar.");
}

const connections = await dbQuery(
  `SELECT DISTINCT s.workspace_id, sync.connection_id
     FROM workspace_marketplace_syncs sync
     JOIN workspace_tiktok_shops s
       ON s.workspace_id=sync.workspace_id
      AND sync.connection_id='tiktok_shop:' || s.shop_id
    WHERE sync.provider='tiktok_shop'
    ORDER BY s.workspace_id, sync.connection_id`
);

console.log(JSON.stringify({ event: "start", connections: connections.length }));
for (let index = 0; index < connections.length; index++) {
  const connection = connections[index];
  await runWithWorkspace(connection.workspace_id, async () => {
    await requestTiktokFullReprocess(connection.connection_id);
    let status;
    for (let pass = 1; pass <= 20; pass++) {
      status = await runTiktokSyncBatch(connection.connection_id, 240_000);
      console.log(JSON.stringify({
        event: "pass", connection: index + 1, pass,
        status: status.status, processedOrders: status.processedOrders,
      }));
      if (status.status === "complete") return;
      if (status.status === "error") throw new Error(`Reprocessamento falhou na conexao ${index + 1}.`);
    }
    throw new Error(`Reprocessamento excedeu o limite na conexao ${index + 1}.`);
  });
}
console.log(JSON.stringify({ event: "complete", connections: connections.length }));
