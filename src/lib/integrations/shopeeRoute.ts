import { NextResponse } from "next/server";
import { withAuthenticatedWorkspace } from "../workspaceContext";
import { requireShopeeConnection } from "./shopeeModules";
import { ShopeeModuleError } from "./shopeeModuleContract";

export function shopeeGet(request: Request, reader: (connection: Awaited<ReturnType<typeof requireShopeeConnection>>, params: URLSearchParams) => Promise<unknown>) {
  return withAuthenticatedWorkspace(async () => { try { const params = new URL(request.url).searchParams; return NextResponse.json(await reader(await requireShopeeConnection(params), params)); } catch (error) { if (error instanceof ShopeeModuleError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status }); return NextResponse.json({ error: "Não foi possível carregar os dados da Shopee.", code: "SHOPEE_READER_FAILED" }, { status: 500 }); } });
}
