import { NextRequest, NextResponse } from "next/server";
import { getTopProducts } from "@/lib/topProducts";
import { resolvePeriod } from "@/lib/period";
import { withAccountContext } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const products = await getTopProducts(resolvePeriod(new URL(req.url).searchParams), 10);
      return NextResponse.json({ products });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
