import { NextRequest, NextResponse } from "next/server";
import { getCosts, setCost, removeCost } from "@/lib/costStore";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withAuthenticatedWorkspace(async () => NextResponse.json({ costs: await getCosts() }));
}

export async function POST(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
  try {
    const body = await req.json();
    const id = String(body.id || body.sku || body.asin || "").trim();
    if (!id) return NextResponse.json({ error: "Informe o SKU ou ASIN." }, { status: 400 });

    const rawCost = body.cost;
    const cost = typeof rawCost === "number" ? rawCost : Number(rawCost);
    if (!Number.isFinite(cost) || cost < 0) {
      return NextResponse.json({ error: "Informe um custo válido, igual ou maior que zero." }, { status: 400 });
    }

    const entry = await setCost({
      id,
      sku: body.sku,
      asin: body.asin,
      title: body.title,
      imageUrl: body.imageUrl,
      cost,
    });
    return NextResponse.json({ entry });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
  });
}

export async function DELETE(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Informe o id." }, { status: 400 });
    await removeCost(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
  });
}
