import { NextRequest, NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspaceScope";
import { dbQuery, hasDb } from "@/lib/db";
import { getCosts, costAt } from "@/lib/costStore";
import { getIntegration, getIntegrations } from "@/lib/integrations/integrationStore";
import { mercadoLivreCostEntry } from "@/lib/integrations/mercadoLivre";
import { custoDoEstoqueNoFull, type OfertaFull } from "@/lib/integrations/mercadoLivreFullStock";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Capital parado no Full do Mercado Livre.
//
// Lê SÓ o canônico — nenhuma chamada nova à API do ML e nenhuma ingestão nova no
// cron. `workspace_channel_products` já grava `fulfillment` ('platform' = Full),
// `available_qty` e o `raw` do anúncio, que é de onde sai o `userProductId`.
//
// ⚠️ NÃO filtra por status do anúncio. Na conta medida em 27/08/2026 o único
// item com estoque no Full estava num anúncio `closed` — 32 unidades. Anúncio
// fechado não devolve mercadoria: o capital continua parado lá, e escondê-lo
// seria a tela mentir por omissão.

interface LinhaFull {
  external_product_id: string;
  sku: string | null;
  title: string;
  available_qty: number;
  user_product_id: string | null;
  currency: string | null;
}

export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    try {
      const requested = new URL(req.url).searchParams.get("connectionId");
      const connection = requested
        ? await getIntegration(requested)
        : (await getIntegrations("mercado_livre"))[0];
      if (!connection || connection.provider !== "mercado_livre") {
        return NextResponse.json(
          { error: "Nenhuma conta do Mercado Livre conectada.", estado: "sem_conexao" },
          { status: 404 }
        );
      }
      if (!hasDb()) {
        return NextResponse.json(
          { error: "Dados indisponíveis neste ambiente.", estado: "sem_banco" },
          { status: 503 }
        );
      }

      const workspaceId = currentWorkspaceId();
      const [linhas, sincronizacao] = await Promise.all([
        dbQuery<LinhaFull>(
          `SELECT external_product_id, sku, title, available_qty, currency,
                  raw ->> 'userProductId' AS user_product_id
             FROM workspace_channel_products
            WHERE workspace_id = $1 AND provider = 'mercado_livre' AND connection_id = $2
              AND fulfillment = 'platform'`,
          [workspaceId, connection.id]
        ),
        dbQuery<{ products_synced_at: Date | null }>(
          `SELECT products_synced_at FROM workspace_marketplace_syncs
            WHERE workspace_id = $1 AND provider = 'mercado_livre' AND connection_id = $2`,
          [workspaceId, connection.id]
        ),
      ]);

      const sincronizadoEm = sincronizacao[0]?.products_synced_at ?? null;
      if (!sincronizadoEm) {
        // Sem catálogo sincronizado, lista vazia significaria "nada no Full" —
        // e o fato é "ainda não olhei". São coisas diferentes.
        return NextResponse.json({
          estado: "sync_pendente",
          sincronizadoEm: null,
          itens: [], total: null, moeda: "BRL",
          unidades: 0, unidadesComCusto: 0, unidadesSemCusto: 0, itensSemCusto: 0,
        });
      }

      const ofertas: OfertaFull[] = linhas.map((linha) => ({
        externalProductId: linha.external_product_id,
        sku: linha.sku,
        title: linha.title,
        availableQty: linha.available_qty,
        userProductId: linha.user_product_id,
      }));

      // Foto do estoque de HOJE: a vigência do custo é a de hoje (ADR-004),
      // não a da data de uma venda passada.
      const hoje = new Date().toISOString();
      const custos = await getCosts();
      const custoDe = (oferta: OfertaFull) => {
        const entrada = mercadoLivreCostEntry(custos, connection.id, oferta.externalProductId, oferta.sku);
        if (!entrada) return null;
        const custo = costAt(entrada, hoje);
        // Custo cadastrado como zero é ausência de cadastro, não item de graça —
        // mesmo critério do lucro.
        return custo > 0 ? custo : null;
      };

      const resultado = custoDoEstoqueNoFull(ofertas, custoDe, linhas[0]?.currency ?? "BRL");
      return NextResponse.json({
        estado: resultado.itens.length ? "ok" : "sem_itens_no_full",
        sincronizadoEm: sincronizadoEm.toISOString(),
        ...resultado,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Não foi possível calcular o custo do Full." },
        { status: 502 }
      );
    }
  });
}
