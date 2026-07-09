import { NextRequest, NextResponse } from "next/server";
import { getTopProducts } from "@/lib/topProducts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const days = Math.max(7, Math.min(90, Number(new URL(req.url).searchParams.get("days") || 30)));
    const products = await getTopProducts(days, 10);
    return NextResponse.json({ products });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
