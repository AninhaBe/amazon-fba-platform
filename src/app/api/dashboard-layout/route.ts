import { NextRequest, NextResponse } from "next/server";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { getDashboardLayout, setDashboardLayout } from "@/lib/dashboardLayoutStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// IDs de view e de widget são controlados pelo front (kebab-case curto). Validar
// aqui evita gravar lixo/entrada não-confiável no settings do workspace.
const TOKEN_RE = /^[a-z0-9-]{1,40}$/;

function sanitizeIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of input) {
    if (typeof value === "string" && TOKEN_RE.test(value) && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
    if (out.length >= 40) break;
  }
  return out;
}

export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    const view = new URL(req.url).searchParams.get("view") ?? "";
    if (!TOKEN_RE.test(view)) return NextResponse.json({ error: "view inválida" }, { status: 400 });
    const layout = await getDashboardLayout(view);
    return NextResponse.json({ layout });
  });
}

export async function PUT(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    const view = new URL(req.url).searchParams.get("view") ?? "";
    if (!TOKEN_RE.test(view)) return NextResponse.json({ error: "view inválida" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { order?: unknown; hidden?: unknown } | null;
    const layout = { order: sanitizeIds(body?.order), hidden: sanitizeIds(body?.hidden) };
    await setDashboardLayout(view, layout);
    return NextResponse.json({ ok: true, layout });
  });
}
