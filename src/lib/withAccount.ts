import { NextRequest } from "next/server";
import { runWithAccount } from "./accountContext";
import { getAccount } from "./accountStore";

export const ACTIVE_COOKIE = "active_seller";

/**
 * Executa o handler no contexto da conta ativa (do cookie). Se não houver conta
 * conectada, roda sem contexto → spapi usa o token do .env (conta dona).
 */
export async function withAccountContext<T>(req: NextRequest, fn: () => Promise<T>): Promise<T> {
  const sellerId = req.cookies.get(ACTIVE_COOKIE)?.value;
  if (sellerId) {
    const acct = await getAccount(sellerId);
    if (acct) {
      return runWithAccount({ sellerId: acct.sellerId, refreshToken: acct.refreshToken }, fn);
    }
  }
  return fn();
}
