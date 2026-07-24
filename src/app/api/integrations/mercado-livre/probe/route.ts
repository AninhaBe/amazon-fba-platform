import { NextResponse } from "next/server";
import { getIntegrations } from "@/lib/integrations/integrationStore";
import { mercadoLivreFetch } from "@/lib/integrations/mercadoLivre";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

// DIAGNÓSTICO TEMPORÁRIO: descobre quais variantes da busca do ML ainda
// respondem com o token da conexão. Abrir logado e enviar o JSON.
// Remover depois de decidir o caminho do ranqueamento.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  return withAuthenticatedWorkspace(async () => {
    const connection = (await getIntegrations("mercado_livre"))[0];
    if (!connection) {
      return NextResponse.json({ error: "Nenhuma conta do Mercado Livre conectada." }, { status: 404 });
    }
    const me = connection.externalAccountId;
    const site = String(connection.metadata?.siteId ?? "MLB");

    const probes: Array<{ label: string; resource: string }> = [
      { label: "busca livre (q=)", resource: `/sites/${site}/search?q=regua%20eletrica&limit=1` },
      { label: "busca por categoria", resource: `/sites/${site}/search?category=MLB1051&limit=1` },
      { label: "busca por vendedor (o seu)", resource: `/sites/${site}/search?seller_id=${me}&limit=1` },
      { label: "seus itens", resource: `/users/${me}/items/search?limit=1` },
      { label: "seu usuário", resource: `/users/${me}` },
      { label: "usuário de terceiro", resource: `/users/241081700` },
      { label: "mais vendidos da categoria", resource: `/highlights/${site}/category/MLB1051` },
      { label: "busca de produtos de catálogo", resource: `/products/search?site_id=${site}&status=active&q=regua%20eletrica` },
    ];

    const results = await Promise.all(
      probes.map(async (probe) => {
        try {
          const data = await mercadoLivreFetch<Record<string, unknown>>(connection, probe.resource);
          const keys = Object.keys(data ?? {});
          const total = (data as { paging?: { total?: number } })?.paging?.total;
          return { ...probe, ok: true, total: total ?? null, keys: keys.slice(0, 6) };
        } catch (error) {
          return { ...probe, ok: false, error: error instanceof Error ? error.message : "erro" };
        }
      })
    );

    return NextResponse.json({ site, sellerId: me, results }, { headers: { "Cache-Control": "no-store" } });
  });
}
