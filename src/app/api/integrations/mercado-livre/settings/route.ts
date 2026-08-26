import { NextRequest, NextResponse } from "next/server";
import { getIntegration, getIntegrations, saveIntegration } from "@/lib/integrations/integrationStore";
import { mercadoLivreTaxRate } from "@/lib/integrations/mercadoLivre";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function selectedConnection(req: NextRequest) {
  const requested = new URL(req.url).searchParams.get("connectionId");
  return requested ? getIntegration(requested) : (await getIntegrations("mercado_livre"))[0];
}

export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
  const connection = await selectedConnection(req);
  if (!connection || connection.provider !== "mercado_livre") {
    return NextResponse.json({ error: "Nenhuma conta do Mercado Livre conectada." }, { status: 404 });
  }
  return NextResponse.json({ taxRate: mercadoLivreTaxRate(connection) });
  });
}

export async function POST(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
  try {
    const connection = await selectedConnection(req);
    if (!connection || connection.provider !== "mercado_livre") {
      return NextResponse.json({ error: "Nenhuma conta do Mercado Livre conectada." }, { status: 404 });
    }
    const body = await req.json();
    // `null` limpa a configuração e volta para "não sei" — distinto de 0%, que é
    // isenção declarada. Mesmo contrato da Amazon e da Shopee.
    const bruto = (body as { taxRate?: unknown }).taxRate;
    if (bruto === null) {
      // ⚠️ GRAVA `null`, NÃO APAGA A CHAVE.
      //
      // `saveIntegration` funde metadata no banco com `metadata || EXCLUDED`,
      // que só ADICIONA e sobrescreve chave — jsonb `||` nunca REMOVE. O código
      // antigo fazia `delete semAliquota.taxRate` e mandava o objeto sem a
      // chave; a fusão simplesmente mantinha o valor velho. Quem cadastrasse 8%
      // e tentasse limpar continuava com 8%, e a tela dizia que tinha limpado.
      //
      // `mercadoLivreTaxRate` já lê `null` como "não configurada" — é o mesmo
      // significado, agora persistido de um jeito que a fusão respeita.
      await saveIntegration({ ...connection, metadata: { ...connection.metadata, taxRate: null } });
      return NextResponse.json({ taxRate: null });
    }
    const taxRate = Number(bruto);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      return NextResponse.json({ error: "Informe uma alíquota entre 0% e 100%, ou null para limpar." }, { status: 400 });
    }
    await saveIntegration({ ...connection, metadata: { ...connection.metadata, taxRate } });
    return NextResponse.json({ taxRate });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível salvar a alíquota." },
      { status: 500 }
    );
  }
  });
}
