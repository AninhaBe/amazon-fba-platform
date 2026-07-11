import { NextRequest, NextResponse } from "next/server";
import { searchProducts } from "@/lib/search";
import { withAccountContext } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const { searchParams } = new URL(req.url);
      const q = (searchParams.get("q") || "").trim();
      const pageToken = searchParams.get("pageToken") || undefined;
      if (!q && !pageToken) {
        return NextResponse.json({ error: "Digite o que quer pesquisar." }, { status: 400 });
      }
      const results = await searchProducts(q, pageToken);
      return NextResponse.json(results);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
