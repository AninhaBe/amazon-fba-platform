import { NextRequest, NextResponse } from "next/server";
import { getFeesEstimateForAsin } from "@/lib/fees";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const asin = String(body.asin || "").trim();
    const price = Number(body.price);
    const shipping = Number(body.shipping ?? 0);

    if (!asin) {
      return NextResponse.json({ error: "Informe o ASIN." }, { status: 400 });
    }
    if (!Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ error: "Informe um preço de venda válido." }, { status: 400 });
    }

    // Estima os dois modos que a Amazon fornece, em paralelo:
    // FBA (logística da Amazon) e Próprio/FBM (só a comissão).
    const [fba, fbm] = await Promise.all([
      getFeesEstimateForAsin({ asin, price, shipping, isAmazonFulfilled: true }),
      getFeesEstimateForAsin({ asin, price, shipping, isAmazonFulfilled: false }),
    ]);

    const pack = (e: typeof fba) => ({
      totalFees: e.TotalFeesEstimate.Amount,
      feeDetails: e.FeeDetailList.map((f) => ({ type: f.FeeType, amount: f.FinalFee.Amount })),
    });

    return NextResponse.json({
      currency: fba.TotalFeesEstimate.CurrencyCode,
      fba: pack(fba),
      fbm: pack(fbm),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
