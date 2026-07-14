import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { getProducts } from "@/lib/products";
import { withAccountContext } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const products = await getProducts();
      return NextResponse.json({ products });
    } catch (err) {
      return errorResponse(err);
    }
  });
}
