import { NextRequest, NextResponse } from "next/server";
import { dbQuery, dbTransaction } from "@/lib/db";
import { getAccounts } from "@/lib/accountStore";
import { currentWorkspaceId } from "@/lib/workspaceScope";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import {
  getAmazonTaxRateSetting,
  parseAmazonTaxRateSetting,
  setAmazonTaxRateSetting,
} from "@/lib/integrations/amazonSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Conta alvo da configuração. `sellerId` explícito quando informado; senão a
 * primeira conta conectada. Nunca aceita um `sellerId` que não pertença ao
 * workspace — é o que impede gravar alíquota na conta de outra pessoa.
 */
async function contaAlvo(req: NextRequest) {
  const pedido = new URL(req.url).searchParams.get("sellerId");
  const contas = await getAccounts();
  return pedido ? contas.find((c) => c.sellerId === pedido) : contas[0];
}

export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    const conta = await contaAlvo(req);
    if (!conta) {
      return NextResponse.json({ error: "Nenhuma conta da Amazon conectada." }, { status: 404 });
    }
    const taxRate = await getAmazonTaxRateSetting(dbQuery, currentWorkspaceId(), conta.sellerId);
    return NextResponse.json({ taxRate, sellerId: conta.sellerId });
  });
}

export async function POST(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    try {
      const conta = await contaAlvo(req);
      if (!conta) {
        return NextResponse.json({ error: "Nenhuma conta da Amazon conectada." }, { status: 404 });
      }
      const setting = parseAmazonTaxRateSetting(await req.json().catch(() => undefined));
      if (!setting.valid) {
        return NextResponse.json(
          { error: "Envie uma alíquota entre 0% e 100%, ou null para limpar." },
          { status: 400 }
        );
      }
      await dbTransaction((query) =>
        setAmazonTaxRateSetting(query, currentWorkspaceId(), conta.sellerId, setting.value)
      );
      return NextResponse.json({ taxRate: setting.value, sellerId: conta.sellerId });
    } catch {
      return NextResponse.json({ error: "Não foi possível salvar a alíquota." }, { status: 500 });
    }
  });
}
