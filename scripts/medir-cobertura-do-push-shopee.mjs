/**
 * COBERTURA DO PUSH DA SHOPEE — o gate de merito da varredura adaptativa.
 *
 * ⚠️ POR QUE ELE PODE RODAR SEM MIGRATION NENHUMA: a pergunta ("o pedido chegou
 * pelo push ANTES de a varredura achar?") parece exigir uma coluna de
 * procedencia em cada pedido. Nao exige — `workspace_marketplace_events` ja
 * guarda o instante em que CADA push chegou (`received_at`) e qual pedido ele
 * anunciava (`resource`). Cruzando com `synced_at` do pedido, a resposta sai.
 *
 * 📌 E a distincao que o numero precisa respeitar: pedido que a varredura ja
 * tinha escrito ANTES do push nao conta como coberto — o push chegou depois e
 * nao adiantou nada. So conta quando o push chegou primeiro.
 *
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/ts-resolver.mjs \
 *        scripts/medir-cobertura-do-push-shopee.mjs [--dias 7]
 */
process.env.DB_POOL_MAX = "3";
import { dbQuery } from "../src/lib/db.ts";

const i = process.argv.indexOf("--dias");
const DIAS = i === -1 ? 7 : Number(process.argv[i + 1]);

const linhas = await dbQuery(
  `WITH pedidos AS (
     SELECT workspace_id, connection_id, external_order_id, occurred_at, synced_at
       FROM workspace_channel_orders
      WHERE provider = 'shopee' AND connection_id <> 'shopee:demo'
        AND occurred_at >= now() - ($1 || ' days')::interval),
   push AS (
     SELECT workspace_id, connection_id, resource AS external_order_id,
            MIN(received_at) AS primeiro_push
       FROM workspace_marketplace_events
      WHERE provider = 'shopee' AND topic = 'order_status'
      GROUP BY 1, 2, 3)
   SELECT COUNT(*) AS pedidos,
          COUNT(push.primeiro_push) AS com_push,
          COUNT(*) FILTER (WHERE push.primeiro_push IS NOT NULL
                             AND push.primeiro_push <= pedidos.synced_at) AS push_chegou_antes,
          ROUND(percentile_cont(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (push.primeiro_push - pedidos.occurred_at)))::numeric, 1)
            AS latencia_mediana_s
     FROM pedidos LEFT JOIN push USING (workspace_id, connection_id, external_order_id)`,
  [String(DIAS)],
);

const r = linhas[0];
const pedidos = Number(r.pedidos);
const cobertos = Number(r.push_chegou_antes);
const pct = pedidos ? (cobertos / pedidos) * 100 : 0;

console.log(`\n=== COBERTURA DO PUSH DA SHOPEE — ultimos ${DIAS} dia(s) ===\n`);
console.log(`  pedidos no periodo ................ ${pedidos}`);
console.log(`  com push registrado ............... ${r.com_push}`);
console.log(`  push chegou ANTES da escrita ...... ${cobertos}`);
console.log(`  cobertura ......................... ${pct.toFixed(2)}%`);
console.log(`  latencia mediana pedido -> push ... ${r.latencia_mediana_s ?? "—"} s`);
console.log(`\n  gate: >= 99% libera a varredura relaxada. ${pct >= 99 ? "🟢 ATINGIDO" : "🔴 AINDA NAO"}`);
// ⚠️ O gate NAO se auto-aplica: quem decide e a dona do produto. Este script
// mede e reporta — ativar o modo relaxado com base num numero que ninguem leu
// seria trocar a garantia da varredura por uma conta automatica.
if (pedidos < 50) {
  console.log(`\n  ⚠️ AMOSTRA PEQUENA (${pedidos} pedidos): o percentual ainda nao significa muito.`);
}
process.exit(0);
