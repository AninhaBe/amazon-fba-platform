import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { withAccountContext } from "@/lib/withAccount";
import { runDetection } from "@/lib/insights/run";
import { listOpen, setStatus } from "@/lib/insights/store";
import type { InsightStatus } from "@/lib/insights/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: só LÊ os insights abertos — a detecção roda no cron diário (estágio 3).
export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const insights = await listOpen();
      return NextResponse.json({ insights });
    } catch (err) {
      return errorResponse(err);
    }
  });
}

// POST: roda a detecção agora (botão "Analisar agora") e devolve o resultado.
export async function POST(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      await runDetection();
      const insights = await listOpen();
      return NextResponse.json({ insights });
    } catch (err) {
      return errorResponse(err);
    }
  });
}

const ACTIONS: Record<string, InsightStatus> = {
  dispensar: "dispensado",
  adiar: "adiado",
  resolver: "resolvido",
};

// PATCH { id, action, snoozeDays? } → aplica o ciclo (dispensar/adiar/resolver).
export async function PATCH(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const body = (await req.json().catch(() => ({}))) as { id?: string; action?: string; snoozeDays?: number };
      const id = String(body.id || "");
      const status = ACTIONS[String(body.action || "")];
      if (!id || !status) return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
      await setStatus(id, status, Number(body.snoozeDays) || 3);
      const insights = await listOpen();
      return NextResponse.json({ insights });
    } catch (err) {
      return errorResponse(err);
    }
  });
}
