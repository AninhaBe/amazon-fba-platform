import { NextRequest, NextResponse } from "next/server";
import { getCurrentPrice } from "@/lib/pricing";
import { getItemInfo } from "@/lib/catalog";
import { withAccountContext } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const asin = (new URL(req.url).searchParams.get("asin") || "").trim();
      if (!asin) {
        return NextResponse.json({ error: "Informe o ASIN." }, { status: 400 });
      }

      // Preço e info em paralelo; se a info do catálogo falhar, não quebra o preço.
      const [price, info] = await Promise.all([
        getCurrentPrice(asin),
        getItemInfo(asin).catch(() => null),
      ]);

      if (!price) {
        return NextResponse.json(
          { error: "Nenhuma oferta ativa encontrada para esse ASIN." },
          { status: 404 }
        );
      }

      return NextResponse.json({ price, info });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
