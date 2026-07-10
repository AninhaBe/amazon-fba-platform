import { NextRequest, NextResponse } from "next/server";
import { getAccounts, removeAccount } from "@/lib/accountStore";
import { ACTIVE_COOKIE } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lista as contas conectadas + qual está ativa. Não expõe os refresh tokens.
export async function GET(req: NextRequest) {
  const accounts = await getAccounts();
  const active = req.cookies.get(ACTIVE_COOKIE)?.value ?? null;
  return NextResponse.json({
    active,
    hasOwnerToken: !!process.env.LWA_REFRESH_TOKEN,
    accounts: accounts.map((a) => ({
      sellerId: a.sellerId,
      name: a.name,
      connectedAt: a.connectedAt,
    })),
  });
}

// Troca a conta ativa (POST { sellerId } — "" volta para a conta dona/.env).
export async function POST(req: NextRequest) {
  const { sellerId } = await req.json();
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
}

// Desconecta uma conta.
export async function DELETE(req: NextRequest) {
  const sellerId = new URL(req.url).searchParams.get("sellerId");
  if (!sellerId) return NextResponse.json({ error: "Informe sellerId." }, { status: 400 });
  await removeAccount(sellerId);
  const res = NextResponse.json({ ok: true });
  if (req.cookies.get(ACTIVE_COOKIE)?.value === sellerId) {
    res.cookies.set(ACTIVE_COOKIE, "", { maxAge: 0, path: "/" });
  }
  return res;
}
