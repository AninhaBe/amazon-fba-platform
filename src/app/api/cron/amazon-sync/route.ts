import { NextRequest, NextResponse } from "next/server";
import { runScheduledAmazonSync } from "@/lib/integrations/amazonScheduler";
import { runScheduledAmazonWarm } from "@/lib/integrations/amazonWarm";
import { runScheduledRankSnapshot } from "@/lib/integrations/amazonRankSnapshot";
import { runScheduledAmazonOfferSnapshot } from "@/lib/integrations/amazonOfferSnapshot";
import { runScheduledInsights } from "@/lib/integrations/amazonInsights";
import { runScheduledAdsSync } from "@/lib/integrations/amazonAdsSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const startedAt = performance.now();
  const falhas: Record<string, string> = {};

  /**
   * Passo best-effort: um erro não derruba o cron, mas **nunca** é engolido em silêncio.
   * Antes cada passo usava `.catch(() => 0)`, e um passo que quebrava sempre reportava
   * zero — indistinguível de "não havia nada a fazer". Foi assim que a foto de ranking
   * e a de oferta ficaram uma semana sem gravar nada sem ninguém perceber.
   */
  async function passo<T>(nome: string, fn: () => Promise<T>, vazio: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      falhas[nome] = msg;
      console.error(`[cron/amazon-sync] passo "${nome}" falhou:`, err);
      return vazio;
    }
  }

  const results = await runScheduledAmazonSync();
  // Aquece os caches dos períodos comuns após sincronizar.
  const warmed = await passo("warm", runScheduledAmazonWarm, 0);
  // Foto diária de ranking: produtos da conta + watchlist (ADR-009/011).
  const rankSnapshots = await passo("rankSnapshot", runScheduledRankSnapshot, 0);
  // Foto diária da oferta (ADR-010): reusa o inventário já aquecido acima, então não
  // gera chamada nova. É o "antes e depois" que explica por que um anúncio parou.
  const offerSnapshots = await passo("offerSnapshot", runScheduledAmazonOfferSnapshot, 0);
  // Anúncio: colhe o relatório pronto e pede o próximo. O relatório da Ads API
  // é ASSÍNCRONO (11 min medidos em 25/08/2026), então um ciclo pede e outro
  // colhe — nunca espera aqui dentro.
  const adsRows = await passo("adsSync", runScheduledAdsSync, 0);
  // Detecção de insights do briefing (ruptura, velocidade, margem).
  const insights = await passo("insights", runScheduledInsights, 0);

  const temFalha = Object.keys(falhas).length > 0;
  return NextResponse.json({
    ok: !temFalha,
    processed: results.length,
    warmed,
    rankSnapshots,
    offerSnapshots,
    insights,
    adsRows,
    // Presente só quando algum passo quebrou — é o que torna a falha visível.
    ...(temFalha ? { falhas } : {}),
    durationMs: Math.round(performance.now() - startedAt),
    results,
  });
}
