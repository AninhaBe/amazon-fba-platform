import { NextRequest, NextResponse } from "next/server";
import {
  getTiktokOrderList,
  getTiktokOrderDetail,
  getTiktokOrderStatement,
  getTiktokProducts,
} from "@/lib/tiktok";
import { getTiktokShops, refreshTiktokShopIfNeeded } from "@/lib/tiktokStore";
import {
  agruparItens,
  normalizeTiktokOrder,
  normalizeTiktokProduct,
  sanitizeTiktokOrder,
  tiktokStatementSettled,
  tiktokStatusIfMapped,
  tiktokUnmappedOrderStatuses,
  type TiktokOrder,
  type TiktokProduct,
  type TiktokStatement,
} from "@/lib/integrations/tiktokCanonical";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Amostra de leitura do TikTok Shop para CONFERIR o parser contra dado real.
// Devolve, lado a lado, o que a API respondeu (sem PII) e o que o
// `tiktokCanonical` produziu — é assim que se descobre que o mapa de status ou
// o agrupamento de itens está errado antes de escrever o sync em cima.
//
// Só lê. Não grava nada no modelo canônico.
export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    const { searchParams } = new URL(req.url);
    const dias = Math.min(Math.max(Number(searchParams.get("dias") ?? 30), 1), 90);
    const limite = Math.min(Math.max(Number(searchParams.get("limite") ?? 5), 1), 20);

    const lojas = await getTiktokShops();
    const selecionada = lojas[0];
    if (!selecionada) {
      return NextResponse.json({ error: "Nenhuma loja TikTok conectada." }, { status: 404 });
    }
    const loja = await refreshTiktokShopIfNeeded(selecionada);
    const shop = { accessToken: loja.accessToken, shopCipher: loja.shopCipher };

    const agora = Math.floor(Date.now() / 1000);
    const resultado: Record<string, unknown> = {
      loja: { shopId: loja.shopId, shopName: loja.shopName, region: loja.region },
      janela: { dias, de: new Date((agora - dias * 86400) * 1000).toISOString() },
      erros: {} as Record<string, string>,
    };
    const erro = (etapa: string, e: unknown) => {
      (resultado.erros as Record<string, string>)[etapa] =
        e instanceof Error ? e.message : String(e);
    };

    // --- Pedidos ---------------------------------------------------------
    let ids: string[] = [];
    try {
      const lista = await getTiktokOrderList(shop, {
        createTimeGe: agora - dias * 86400,
        createTimeLt: agora,
      });
      ids = lista.items.map((o) => o.id).slice(0, limite);
      resultado.pedidos = { total: lista.total ?? lista.items.length, amostrados: ids.length };
    } catch (e) {
      erro("order/search", e);
    }

    if (ids.length) {
      try {
        const detalhes = (await getTiktokOrderDetail(shop, ids)) as TiktokOrder[];
        // Status crus: é o que confirma (ou desmente) o MAPA_STATUS.
        const statusVistos = new Map<string, number>();
        for (const o of detalhes) {
          const s = String((o as { status?: string }).status ?? "?");
          statusVistos.set(s, (statusVistos.get(s) ?? 0) + 1);
        }
        // Este bloco existe justamente para revelar status novo — usar
        // `canonicalTiktokStatus` aqui derrubava a amostra inteira no primeiro
        // status desconhecido e a resposta virava uma linha em `erros`, sem
        // dizer QUAL status apareceu. É o contrário do objetivo da rota.
        resultado.statusObservados = [...statusVistos].map(([status, vezes]) => ({
          status,
          vezes,
          canonicoAtual: tiktokStatusIfMapped(status),
          mapeado: tiktokStatusIfMapped(status) != null,
        }));
        resultado.statusNaoMapeados = tiktokUnmappedOrderStatuses(detalhes);

        // Um pedido inteiro, cru (sem PII) + o que o parser fez com ele.
        const primeiro = detalhes[0];
        if (primeiro) {
          let statement: TiktokStatement | null = null;
          try {
            const bruto = await getTiktokOrderStatement(shop, primeiro.id);
            statement = (bruto as { statement_transactions?: TiktokStatement[] })
              ?.statement_transactions?.[0] ?? (bruto as TiktokStatement);
            resultado.extratoCru = statement;
            resultado.extratoFechado = tiktokStatementSettled(statement);
          } catch (e) {
            erro("finance/statement", e);
          }
          resultado.pedidoCru = sanitizeTiktokOrder(primeiro);
          resultado.itensAgrupados = agruparItens(primeiro.line_items ?? []);
          resultado.linhasOriginais = (primeiro.line_items ?? []).length;
          resultado.pedidoCanonico = normalizeTiktokOrder(primeiro, {
            statement: tiktokStatementSettled(statement) ? statement : null,
          });
        }
      } catch (e) {
        erro("order/detail", e);
      }
    }

    // --- Produtos --------------------------------------------------------
    try {
      const produtos = await getTiktokProducts(shop);
      const amostra = (produtos.items as TiktokProduct[]).slice(0, 3);
      resultado.produtos = {
        total: produtos.total ?? produtos.items.length,
        cru: amostra[0] ?? null,
        canonico: amostra.map((p) => normalizeTiktokProduct(p)),
      };
    } catch (e) {
      erro("product/search", e);
    }

    return NextResponse.json(resultado);
  });
}
