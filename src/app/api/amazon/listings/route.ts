import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import {
  inspectAsin,
  inspectProductType,
  searchProductTypes,
  submitListing,
  type ListingBuilderInput,
} from "@/lib/amazonListingBuilder";
import { withAccountContext } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const params = new URL(req.url).searchParams;
      const asin = params.get("asin")?.trim();
      const productType = params.get("productType")?.trim();
      const keywords = params.get("keywords")?.trim();
      if (asin) return NextResponse.json(await inspectAsin(asin));
      if (productType) return NextResponse.json(await inspectProductType(productType));
      if (keywords) return NextResponse.json({ productTypes: await searchProductTypes(keywords) });
      return NextResponse.json({ error: "Informe um ASIN ou tipo de produto." }, { status: 400 });
    } catch (error) {
      return errorResponse(error);
    }
  });
}

export async function POST(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const body = await req.json() as { action?: string; listing?: ListingBuilderInput };
      if (!body.listing || (body.action !== "validate" && body.action !== "publish")) {
        return NextResponse.json({ error: "Solicitação de anúncio inválida." }, { status: 400 });
      }
      return NextResponse.json(await submitListing(body.listing, body.action === "validate"));
    } catch (error) {
      return errorResponse(error);
    }
  });
}
