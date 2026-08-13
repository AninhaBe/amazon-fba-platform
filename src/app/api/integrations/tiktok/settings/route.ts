import { NextRequest, NextResponse } from "next/server";
import { parseTiktokConnectionId, parseTiktokTaxRateSetting } from "@/lib/integrations/tiktokContract";
import { getTiktokShops, setTiktokShopTaxRate } from "@/lib/tiktokStore";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function selected(req: NextRequest) {
  const requested = new URL(req.url).searchParams.get("connection_id");
  const parsed = requested ? parseTiktokConnectionId(requested) : null;
  const shops = await getTiktokShops();
  if (requested && !parsed) return null;
  return parsed ? shops.find((shop) => shop.shopId === parsed.shopId) : shops.length === 1 ? shops[0] : null;
}

export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    const shop = await selected(req);
    if (!shop) return NextResponse.json({ error: "Loja TikTok Shop nao encontrada." }, { status: 404 });
    return NextResponse.json({ taxRate: shop.taxRate ?? null });
  });
}

export async function POST(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    const shop = await selected(req);
    if (!shop) return NextResponse.json({ error: "Loja TikTok Shop nao encontrada." }, { status: 404 });
    const body = await req.json().catch(() => undefined);
    const setting = parseTiktokTaxRateSetting(body);
    if (!setting.valid) return NextResponse.json({ error: "Envie uma aliquota numerica entre 0% e 100%, ou null para limpar." }, { status: 400 });
    await setTiktokShopTaxRate(shop.shopId, setting.value);
    return NextResponse.json({ taxRate: setting.value });
  });
}
