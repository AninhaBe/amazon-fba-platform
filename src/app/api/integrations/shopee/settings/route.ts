import { NextResponse } from "next/server";
import { dbQuery, dbTransaction } from "@/lib/db";
import { currentWorkspaceId } from "@/lib/workspaceScope";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { requireShopeeConnection } from "@/lib/integrations/shopeeModules";
import { ShopeeModuleError } from "@/lib/integrations/shopeeModuleContract";
import {
  getShopeeTaxRateSetting,
  parseShopeeTaxRateSetting,
  setShopeeTaxRateSetting,
} from "@/lib/integrations/shopeeSettings";
import { withShopeeIntegrationWriteFence } from "@/lib/integrations/shopeeWriteFence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function exactParams(request: Request): URLSearchParams {
  const params = new URL(request.url).searchParams;
  if (!params.get("connection_id")) {
    throw new ShopeeModuleError(400, "CONNECTION_ID_REQUIRED", "Informe connection_id.");
  }
  return params;
}

function errorResponse(error: unknown) {
  if (error instanceof ShopeeModuleError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return NextResponse.json(
    { error: "Não foi possível processar a configuração da Shopee.", code: "SHOPEE_SETTINGS_FAILED" },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  return withAuthenticatedWorkspace(async () => {
    try {
      const connection = await requireShopeeConnection(exactParams(request));
      const taxRate = await getShopeeTaxRateSetting(dbQuery, currentWorkspaceId(), connection.id);
      return NextResponse.json({ taxRate });
    } catch (error) {
      return errorResponse(error);
    }
  });
}

export async function POST(request: Request) {
  return withAuthenticatedWorkspace(async () => {
    try {
      const connection = await requireShopeeConnection(exactParams(request));
      const body = await request.json().catch(() => undefined);
      const setting = parseShopeeTaxRateSetting(body);
      if (!setting.valid) {
        throw new ShopeeModuleError(
          400,
          "INVALID_TAX_RATE",
          "Envie uma alíquota numérica entre 0% e 100%, ou null para limpar.",
        );
      }
      const fenced = await withShopeeIntegrationWriteFence(
        dbTransaction,
        currentWorkspaceId(),
        connection.id,
        (query) => setShopeeTaxRateSetting(query, currentWorkspaceId(), connection.id, setting.value),
      );
      if (!fenced.owned) {
        throw new ShopeeModuleError(404, "CONNECTION_NOT_FOUND", "Nenhuma loja Shopee conectada.");
      }
      return NextResponse.json({ taxRate: setting.value });
    } catch (error) {
      return errorResponse(error);
    }
  });
}
