import { hasDb } from "../../db";
import { getTiktokShops } from "../../tiktokStore";
import { tiktokConnectionId } from "../../integrations/tiktokContract";
import type { Detector, InsightCandidate } from "../types";
import { unidadesPorSku } from "./velocidadeCanonica";

// Detector de queda de velocidade (TikTok Shop). Unidades por SKU nos últimos
// 7 dias contra os 7 anteriores, direto do canônico. No TikTok a venda que
// conta é paid/shipped/delivered (os status confirmados do canal). Mesmos
// limiares dos outros canais.

const TYPE = "velocidade";
const PROVIDER = "tiktok_shop";
const STATUSES = ["paid", "shipped", "delivered"];
const DROP_THRESHOLD = 0.25;
const MIN_PREVIOUS_UNITS = 5;
const DAY = 86_400_000;

export const tiktokVelocidadeDetector: Detector = {
  type: TYPE,
  provider: PROVIDER,
  async run(): Promise<InsightCandidate[]> {
    if (!hasDb()) return [];
    const now = Date.now();
    const candidates: InsightCandidate[] = [];
    for (const shop of await getTiktokShops()) {
      const connectionId = tiktokConnectionId(shop.shopId);
      const [current, previous] = await Promise.all([
        unidadesPorSku({ provider: PROVIDER, connectionId, statuses: STATUSES, from: new Date(now - 7 * DAY), to: new Date(now) }),
        unidadesPorSku({ provider: PROVIDER, connectionId, statuses: STATUSES, from: new Date(now - 14 * DAY), to: new Date(now - 7 * DAY) }),
      ]);
      for (const [sku, prev] of previous) {
        if (prev.units < MIN_PREVIOUS_UNITS) continue;
        const curUnits = current.get(sku)?.units ?? 0;
        const drop = (prev.units - curUnits) / prev.units;
        if (drop <= DROP_THRESHOLD) continue;
        const name = prev.title || sku;
        const dropPct = Math.round(drop * 100);

        candidates.push({
          id: `${TYPE}:${PROVIDER}:${shop.shopId}:${sku}`,
          type: TYPE,
          provider: PROVIDER,
          entityRef: sku,
          severity: Math.min(95, 50 + Math.round(drop * 50)),
          title: name,
          evidence: {
            ultimos7d: curUnits,
            "7dAnteriores": prev.units,
            quedaPct: dropPct,
          },
          impact: {
            unidadesAMenosPorSemana: prev.units - curUnits,
            premissa: "comparação 7d vs 7d anteriores; vendas confirmadas por SKU",
          },
          recommendation: `Vendas de ${name} caíram ${dropPct}% na semana (${prev.units} → ${curUnits} un) na TikTok Shop. Revise preço, posição do anúncio e estoque — algo mudou.`,
          actionHref: "/tiktok/monitor",
        });
      }
    }
    return candidates;
  },
};
