import { NextResponse } from "next/server";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { readShopeeCosts, requireShopeeConnection, writeShopeeCost } from "@/lib/integrations/shopeeModules";
import { ShopeeModuleError } from "@/lib/integrations/shopeeModuleContract";
import { shopeeGet } from "@/lib/integrations/shopeeRoute";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(request: Request) { return shopeeGet(request, readShopeeCosts); }
export async function POST(request: Request) { return withAuthenticatedWorkspace(async () => { try { const params = new URL(request.url).searchParams; const entry = await writeShopeeCost(await requireShopeeConnection(params), await request.json()); return NextResponse.json({ entry }); } catch (error) { if (error instanceof ShopeeModuleError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status }); return NextResponse.json({ error: "Não foi possível salvar o custo.", code: "SHOPEE_COST_FAILED" }, { status: 500 }); } }); }
