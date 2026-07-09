import { NextRequest, NextResponse } from "next/server";
import { getDailySales } from "@/lib/sales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const days = Math.max(7, Math.min(90, Number(new URL(req.url).searchParams.get("days") || 30)));
    const series = await getDailySales(days);
    return NextResponse.json({ series });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
