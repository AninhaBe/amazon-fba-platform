import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { getListings } from "@/lib/listings";
import { withAccountContext } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Anúncios publicados da conta Amazon (relatório GET_MERCHANT_LISTINGS_ALL_DATA,
// com stale-while-revalidate — devolve o cache na hora e atualiza em segundo plano).
export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const listings = await getListings(true);
      return NextResponse.json({ listings, total: listings.length });
    } catch (error) {
      return errorResponse(error);
    }
  });
}
