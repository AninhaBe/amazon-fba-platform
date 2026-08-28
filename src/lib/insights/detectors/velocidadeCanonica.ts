import { dbQuery } from "../../db";
import { currentWorkspaceId } from "../../workspaceScope";

// Contagem de unidades vendidas por SKU numa janela, direto do canônico — a
// base do detector de velocidade de Shopee e TikTok. Não é "copiar da Amazon":
// é a NOSSA tabela canônica, a mesma para todo canal; o que muda por canal é o
// conjunto de status que conta como venda, e isso entra por parâmetro.

export interface UnidadesPorSku { sku: string; title: string; units: number }

export async function unidadesPorSku(input: {
  provider: string;
  connectionId: string;
  statuses: string[];
  from: Date;
  to: Date;
}): Promise<Map<string, UnidadesPorSku>> {
  const rows = await dbQuery<UnidadesPorSku>(
    `SELECT COALESCE(i.sku, i.external_product_id) AS sku, MAX(i.title) AS title, SUM(i.qty)::int AS units
       FROM workspace_channel_order_items i
       JOIN workspace_channel_orders o
         ON o.workspace_id = i.workspace_id AND o.provider = i.provider
        AND o.connection_id = i.connection_id AND o.external_order_id = i.external_order_id
      WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
        AND o.status = ANY($4::text[]) AND o.occurred_at >= $5 AND o.occurred_at < $6
      GROUP BY 1`,
    [currentWorkspaceId(), input.provider, input.connectionId, input.statuses, input.from, input.to]
  );
  return new Map(rows.map((row) => [row.sku, row]));
}
