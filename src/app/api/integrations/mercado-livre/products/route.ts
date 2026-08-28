import { NextRequest, NextResponse } from "next/server";
import { getIntegration, getIntegrations } from "@/lib/integrations/integrationStore";
import { getMercadoLivreProducts } from "@/lib/integrations/mercadoLivre";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { filtroDeAtividadeRequest, ocultadosPeloFiltro, STATUS_ATIVO } from "@/lib/integrations/filtroDeAtividade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
  try {
    const requested = new URL(req.url).searchParams.get("connectionId");
    const connection = requested
      ? await getIntegration(requested)
      : (await getIntegrations("mercado_livre"))[0];
    if (!connection || connection.provider !== "mercado_livre") {
      return NextResponse.json({ error: "Nenhuma conta do Mercado Livre conectada." }, { status: 404 });
    }
    // Não lista anúncios ENCERRADOS (closed) — são listings mortos (análogo aos SKUs
    // fantasma da Amazon) e não fazem sentido na tela de cadastro de custo. Filtro só
    // aqui (não na função compartilhada, que o overview também usa).
    //
    // 28/08/2026: o mesmo raciocínio passa a valer para o PAUSADO, que é a massa
    // real do problema — medido nesta conta: 365 pausados para 26 ativos, 14 para
    // 1. O encerrado já saía; o pausado é que enterrava a tela. Continua
    // acessível pelo seletor (`atividade=todos`), e a resposta diz quantos
    // ficaram de fora para a tela poder avisar. Ver `filtroDeAtividade.ts`.
    const atividade = filtroDeAtividadeRequest(new URL(req.url).searchParams);
    const data = await getMercadoLivreProducts(connection);
    const vivos = data.products.filter((p) => p.status !== "closed");
    const products = atividade === "todos"
      ? vivos
      : vivos.filter((p) => (atividade === "ativos" ? p.status === STATUS_ATIVO : p.status !== STATUS_ATIVO));
    return NextResponse.json({
      ...data,
      products,
      atividade,
      totalNoCanal: vivos.length,
      ocultados: ocultadosPeloFiltro(vivos.length, products.length),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao carregar os produtos." },
      { status: 502 }
    );
  }
  });
}
