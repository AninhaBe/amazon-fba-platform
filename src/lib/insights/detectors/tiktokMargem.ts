import { getTiktokShops } from "../../tiktokStore";
import { getTiktokOverviewFromCanonical } from "../../integrations/tiktokOverviewCanonical";
import type { Detector, InsightCandidate } from "../types";
import { tiktokShopConnection } from "./tiktokRuptura";

// Detector de margem comprometida (TikTok Shop). O contrato do canal declara
// que lucro POR SKU não é derivável com segurança (curva ABC:
// profitAvailable=false — só há lucro por pedido completo). A margem honesta é
// a da LOJA, e a autoridade é o ledger: o overview canônico só produz
// profit/marginPct quando o extrato LIQUIDADO cobre o período e todos os
// componentes são conhecidos (applyTiktokLedgerAuthority) — null em qualquer um
// deixa o lucro null, e null nunca vira 0. Alíquota ausente = margem NÃO
// avaliada, com pendência apontando o cadastro (a alíquota do TikTok é por
// loja). A fila financeira não é tocada: aqui só se LÊ o que o ledger já
// escreveu.

const TYPE = "margem";
const PROVIDER = "tiktok_shop";
const MARGIN_FLOOR_PCT = 8;
const MIN_REVENUE = 50; // ignora loja com receita irrisória no período (ruído)

function periodo30d() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  return { from, to, label: "Últimos 30 dias" };
}

export const tiktokMargemDetector: Detector = {
  type: TYPE,
  provider: PROVIDER,
  async run(): Promise<InsightCandidate[]> {
    const candidates: InsightCandidate[] = [];
    for (const shop of await getTiktokShops()) {
      const connection = tiktokShopConnection(shop);
      const data = await getTiktokOverviewFromCanonical(connection, periodo30d()).catch(() => null);
      if (!data) continue;
      const loja = shop.shopName ?? `Loja ${shop.shopId}`;
      const revenue = data.overview.revenue ?? 0;

      if (shop.taxRate == null) {
        // Sem alíquota não existe margem honesta — pendência por loja.
        if (revenue > 0) {
          candidates.push({
            id: `${TYPE}:${PROVIDER}:${shop.shopId}:aliquota`,
            type: TYPE,
            provider: PROVIDER,
            entityRef: "aliquota",
            severity: 60,
            title: `Margem da ${loja} não avaliada`,
            evidence: { aliquotaConfigurada: "não" },
            impact: { premissa: "sem a alíquota de imposto, avaliar a margem superestimaria a loja inteira" },
            recommendation: `Cadastre a alíquota de imposto da ${loja} para a margem ser avaliada.`,
            actionHref: "/tiktok/produtos",
          });
        }
        continue;
      }

      // profit/marginPct não-nulos JÁ carregam a autoridade do ledger: extrato
      // liquidado cobrindo o período e componentes conhecidos. Nulo = não avaliar.
      if (data.overview.profit == null || data.overview.marginPct == null) continue;
      if (revenue < MIN_REVENUE) continue;
      if (data.overview.marginPct >= MARGIN_FLOOR_PCT) continue;
      const negative = data.overview.profit < 0;

      candidates.push({
        id: `${TYPE}:${PROVIDER}:${shop.shopId}:loja`,
        type: TYPE,
        provider: PROVIDER,
        entityRef: shop.shopId,
        severity: negative ? 88 : 65,
        title: loja,
        evidence: {
          receita30d: +revenue.toFixed(2),
          contribuicao30d: +data.overview.profit.toFixed(2),
          margemPct: +data.overview.marginPct.toFixed(1),
        },
        impact: negative
          ? { prejuizoNoPeriodo: +(-data.overview.profit).toFixed(2), premissa: "extrato liquidado + custo cadastrado + alíquota, no nível da loja (30 dias) — o TikTok não permite lucro por SKU com segurança" }
          : { margemAbaixoDoPiso: `${data.overview.marginPct.toFixed(1)}% < ${MARGIN_FLOOR_PCT}%`, premissa: "extrato liquidado + custo cadastrado + alíquota, no nível da loja (30 dias) — o TikTok não permite lucro por SKU com segurança" },
        recommendation: negative
          ? `A ${loja} deu prejuízo de R$ ${(-data.overview.profit).toFixed(2)} em 30 dias. Revise preços e custos do catálogo.`
          : `Margem da ${loja} está em ${data.overview.marginPct.toFixed(1)}% (abaixo de ${MARGIN_FLOOR_PCT}%). Revise preços, custos e tarifas.`,
        actionHref: "/tiktok",
      });
    }
    return candidates;
  },
};
