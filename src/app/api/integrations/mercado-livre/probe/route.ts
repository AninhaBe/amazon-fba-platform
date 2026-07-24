import { NextRequest, NextResponse } from "next/server";
import { dbQuery, hasDb } from "@/lib/db";
import { runWithWorkspace } from "@/lib/workspaceScope";
import { getIntegration } from "@/lib/integrations/integrationStore";
import { mercadoLivreFetch } from "@/lib/integrations/mercadoLivre";

// DIAGNÓSTICO TEMPORÁRIO: descobre quais variantes da busca do ML ainda
// respondem com o token da conexão. Autenticado por CRON_SECRET (como as
// rotas de cron) para poder ser chamado fora de uma sessão de navegador.
// REMOVER depois de decidir o caminho do ranqueamento.

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
    `SELECT workspace_id, connection_id
       FROM workspace_marketplace_syncs
      WHERE provider = 'mercado_livre'
      ORDER BY updated_at DESC
      LIMIT 1`
  );
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "Nenhuma conexão do Mercado Livre." }, { status: 404 });

  return runWithWorkspace(row.workspace_id, async () => {
    const connection = await getIntegration(row.connection_id);
    if (!connection) return NextResponse.json({ error: "Conexão não encontrada." }, { status: 404 });

    const me = connection.externalAccountId;
    const site = String(connection.metadata?.siteId ?? "MLB");

    const probes: Array<{ label: string; resource: string }> = [
      { label: "busca livre (q=)", resource: `/sites/${site}/search?q=regua%20eletrica&limit=1` },
      { label: "busca por categoria", resource: `/sites/${site}/search?category=MLB1051&limit=1` },
      { label: "busca por vendedor (o seu)", resource: `/sites/${site}/search?seller_id=${me}&limit=1` },
      { label: "busca vendedor + categoria", resource: `/sites/${site}/search?seller_id=${me}&category=MLB1051&limit=1` },
      { label: "seus itens", resource: `/users/${me}/items/search?limit=1` },
      { label: "seu usuário", resource: `/users/${me}` },
      { label: "usuário de terceiro", resource: `/users/241081700` },
      { label: "mais vendidos da categoria", resource: `/highlights/${site}/category/MLB1051` },
      { label: "tendências de busca", resource: `/trends/${site}` },
      { label: "busca de produtos de catálogo", resource: `/products/search?site_id=${site}&status=active&q=regua%20eletrica` },
    ];

    const results = await Promise.all(
      probes.map(async (probe) => {
        try {
          const data = await mercadoLivreFetch<Record<string, unknown>>(connection, probe.resource);
          const total = (data as { paging?: { total?: number } })?.paging?.total;
          const resultsLen = Array.isArray((data as { results?: unknown[] })?.results)
            ? (data as { results: unknown[] }).results.length
            : null;
          return { label: probe.label, ok: true, total: total ?? null, results: resultsLen, keys: Object.keys(data ?? {}).slice(0, 8) };
        } catch (error) {
          return { label: probe.label, ok: false, error: error instanceof Error ? error.message : "erro" };
        }
      })
    );

    return NextResponse.json({ site, sellerId: me, results }, { headers: { "Cache-Control": "no-store" } });
  });
}
