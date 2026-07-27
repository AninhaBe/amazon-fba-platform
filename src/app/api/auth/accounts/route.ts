import { NextRequest, NextResponse } from "next/server";
import { getAccounts, removeAccount, setAccountName } from "@/lib/accountStore";
import { ACTIVE_COOKIE } from "@/lib/withAccount";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lista as contas conectadas + qual está ativa. Não expõe os refresh tokens.
export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
  const accounts = await getAccounts();
  const cookie = req.cookies.get(ACTIVE_COOKIE)?.value ?? null;
  // Espelha o withAccountContext: se o cookie aponta para uma conta válida, ela é a
  // ativa; sem cookie (ou cookie obsoleto) mas com uma única conta conectada, essa
  // conta é a ativa efetiva — que é a que já serve os dados. Assim o chip não mostra
  // "Nenhuma conta" enquanto os números vêm de uma conta real.
  const active = cookie && accounts.some((a) => a.sellerId === cookie)
    ? cookie
    : accounts.length === 1
      ? accounts[0].sellerId
      : null;
  return NextResponse.json({
    active,
    hasOwnerToken: false,
    accounts: accounts.map((a) => ({
      sellerId: a.sellerId,
      name: a.name,
      marketplace: a.marketplace,
      connectedAt: a.connectedAt,
    })),
  });
  });
}

// Renomeia (apelido) uma conta conectada — PATCH { sellerId, name }.
export async function PATCH(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
  try {
    const { sellerId, name } = await req.json();
    if (!sellerId) return NextResponse.json({ error: "Informe sellerId." }, { status: 400 });
    await setAccountName(sellerId, String(name ?? ""));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro ao renomear conta." }, { status: 500 });
  }
  });
}

// Troca a conta ativa (POST { sellerId } — "" volta para a conta dona/.env).
export async function POST(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
  const { sellerId } = await req.json();
  if (sellerId) {
    const accounts = await getAccounts();
    if (!accounts.some((account) => account.sellerId === sellerId)) {
      return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
    }
  }
  const res = NextResponse.json({ ok: true, active: sellerId || null });
  if (sellerId) {
    res.cookies.set(ACTIVE_COOKIE, sellerId, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  } else {
    res.cookies.set(ACTIVE_COOKIE, "", { maxAge: 0, path: "/" });
  }
  return res;
  });
}

// Desconecta uma conta.
export async function DELETE(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
  try {
    const sellerId = new URL(req.url).searchParams.get("sellerId");
    if (!sellerId) return NextResponse.json({ error: "Informe sellerId." }, { status: 400 });
    await removeAccount(sellerId);
    const res = NextResponse.json({ ok: true });
    if (req.cookies.get(ACTIVE_COOKIE)?.value === sellerId) {
      res.cookies.set(ACTIVE_COOKIE, "", { maxAge: 0, path: "/" });
    }
    return res;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro ao desconectar conta." }, { status: 500 });
  }
  });
}
