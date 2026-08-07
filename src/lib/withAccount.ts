import { NextRequest } from "next/server";
import { runWithAccount } from "./accountContext";
import { getAccount, getAccounts } from "./accountStore";
import { withAuthenticatedWorkspace } from "./workspaceContext";
import { NextResponse } from "next/server";

export const ACTIVE_COOKIE = "active_seller";

interface AccountContextOptions<T> {
  /**
   * Chamado quando não há **nenhuma** conta SP-API no workspace, no lugar do 409.
   * Roda dentro do contexto de workspace (mas sem conta), então serve para ler o
   * modelo canônico, que não depende de credencial. Devolver `null` mantém o 409.
   *
   * Não cobre o caso de várias contas: ali a escolha é do usuário e continua 409.
   */
  onMissingAccount?: () => Promise<T | null>;
}

/**
 * Executa o handler no contexto da conta ativa (do cookie). Se não houver conta
 * conectada, roda sem contexto → spapi usa o token do .env (conta dona).
 */
export async function withAccountContext<T>(
  req: NextRequest,
  fn: () => Promise<T>,
  options?: AccountContextOptions<T>
): Promise<T> {
  return withAuthenticatedWorkspace(async () => {
    const sellerId = req.cookies.get(ACTIVE_COOKIE)?.value;
    if (sellerId) {
      const acct = await getAccount(sellerId);
      if (acct) {
        return runWithAccount({ sellerId: acct.sellerId, refreshToken: acct.refreshToken }, fn);
      }
    }

    const accounts = await getAccounts();
    if (accounts.length === 1) {
      const acct = accounts[0];
      return runWithAccount({ sellerId: acct.sellerId, refreshToken: acct.refreshToken }, fn);
    }

    if (accounts.length === 0 && options?.onMissingAccount) {
      const fallback = await options.onMissingAccount();
      if (fallback !== null) return fallback;
    }

    return NextResponse.json(
      { error: accounts.length > 1 ? "Selecione uma conta Amazon." : "Conecte uma conta Amazon para continuar." },
      { status: 409 }
    );
  }) as Promise<T>;
}
