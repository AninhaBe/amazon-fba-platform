import { NextResponse } from "next/server";
import { comAdmin } from "@/lib/admin";
import { coletarMetricasAdmin } from "@/lib/adminMetricas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Retrato agregado do produto inteiro. Fora da allowlist, responde 404 — ver
// docs/adr/ADR-024-tela-de-administracao.md.
export async function GET() {
  return comAdmin(async () => {
    const metricas = await coletarMetricasAdmin();
    if (!metricas) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
    return NextResponse.json(metricas);
  });
}
