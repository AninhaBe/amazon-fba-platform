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
    const taxRate = Number(body.taxRate);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      return NextResponse.json({ error: "Informe uma alíquota entre 0% e 100%." }, { status: 400 });
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
