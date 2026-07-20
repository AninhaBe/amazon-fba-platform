import { NextRequest, NextResponse } from "next/server";
import { getIntegration, getIntegrations } from "@/lib/integrations/integrationStore";
import { getMercadoLivrePublicListing, getMercadoLivreSaleFee, getMercadoLivreSaleFeeForContext } from "@/lib/integrations/mercadoLivre";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const requested = new URL(req.url).searchParams.get("connectionId");
    const connection = requested ? await getIntegration(requested) : (await getIntegrations("mercado_livre"))[0];
    if (!connection || connection.provider !== "mercado_livre") {
      return NextResponse.json({ error: "Nenhuma conta do Mercado Livre conectada." }, { status: 404 });
    }
    const itemId = String(body.itemId || "").trim();
    const price = Number(body.price);
    const reference = String(body.reference || "").trim();
    if (reference) {
      return NextResponse.json({ listing: await getMercadoLivrePublicListing(connection, reference) });
    }
    if (!itemId || !Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ error: "Selecione um anúncio e informe um preço maior que zero." }, { status: 400 });
    }
    const categoryId = String(body.categoryId || "").trim();
    const listingTypeId = String(body.listingTypeId || "").trim();
    const fee = body.useContext && listingTypeId
      ? await getMercadoLivreSaleFeeForContext(connection, {
        itemId,
        price,
        categoryId,
        listingTypeId,
        currency: String(body.currency || "BRL"),
        shippingMode: body.shippingMode ? String(body.shippingMode) : null,
        logisticType: body.logisticType ? String(body.logisticType) : null,
      })
      : await getMercadoLivreSaleFee(connection, itemId, price);
    return NextResponse.json({ price, fee });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível calcular a tarifa de venda." },
      { status: 502 }
    );
  }
}
