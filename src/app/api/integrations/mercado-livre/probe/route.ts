import { NextRequest, NextResponse } from "next/server";
import { dbQuery, hasDb } from "@/lib/db";
import { runWithWorkspace } from "@/lib/workspaceScope";
import { getIntegration } from "@/lib/integrations/integrationStore";
import { mercadoLivreFetch } from "@/lib/integrations/mercadoLivre";

// DIAGNÓSTICO TEMPORÁRIO: verifica quais endpoints usados pela calculadora do
// ML ainda respondem, para saber o impacto real do bloqueio de /sites/search.
// REMOVER após a correção.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  if (!hasDb()) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });

  const rows = await dbQuery<{ workspace_id: string; connection_id: string }>(
    `SELECT workspace_id, connection_id FROM workspace_marketplace_syncs
      WHERE provider = 'mercado_livre' ORDER BY updated_at DESC LIMIT 1`
  );
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "Nenhuma conexão do Mercado Livre." }, { status: 404 });

  return runWithWorkspace(row.workspace_id, async () => {
    const connection = await getIntegration(row.connection_id);
    if (!connection) return NextResponse.json({ error: "Conexão não encontrada." }, { status: 404 });
    const me = connection.externalAccountId;

    // Pega um item real da conta para testar /items/{id}.
    let myItem = "";
    try {
      const mine = await mercadoLivreFetch<{ results?: string[] }>(connection, `/users/${me}/items/search?limit=1`);
      myItem = mine.results?.[0] ?? "";
    } catch {
      // segue sem
    }

    const probes: Array<{ label: string; resource: string }> = [
      { label: "meus itens", resource: `/users/${me}/items/search?limit=1` },
      { label: "itens de TERCEIRO (fallback primario do catalogo)", resource: `/users/241081700/items/search?limit=1` },
      { label: "tarifas da calculadora (listing_prices)", resource: `/sites/MLB/listing_prices?price=100&category_id=MLB1051&listing_type_id=gold_special` },
      { label: "item por id", resource: myItem ? `/items/${myItem}` : `/items/MLB0` },
      { label: "categorias por dominio", resource: `/catalog_domains/MLB-POWER_STRIPS/categories` },
      { label: "sites/search?seller_id (o quebrado)", resource: `/sites/MLB/search?seller_id=${me}&limit=1` },
      { label: "produtos de catalogo (q=)", resource: `/products/search?site_id=MLB&status=active&q=regua` },
    ];

    const results = await Promise.all(
      probes.map(async (probe) => {
        try {
          const data = await mercadoLivreFetch<Record<string, unknown>>(connection, probe.resource);
          const arr = Array.isArray(data) ? data.length : null;
          const resultsLen = Array.isArray((data as { results?: unknown[] })?.results)
            ? (data as { results: unknown[] }).results.length
            : null;
          return { label: probe.label, ok: true, arrayLen: arr, results: resultsLen, keys: Object.keys(data ?? {}).slice(0, 6) };
        } catch (error) {
          return { label: probe.label, ok: false, error: error instanceof Error ? error.message : "erro" };
        }
      })
    );

    return NextResponse.json({ sellerId: me, myItem, results }, { headers: { "Cache-Control": "no-store" } });
  });
}
