import { getShopeeOverviewFromCanonical } from "../../integrations/shopeeOverviewCanonical";
import type { Detector, InsightCandidate } from "../types";
import { periodo30d, shopeeConnections } from "./shopeeRuptura";

// Detector de margem comprometida (Shopee). O contrato canônico da Shopee
// declara que lucro POR SKU não é derivável com segurança (curva ABC:
// profitAvailable=false — as tarifas reais chegam por pedido, via escrow).
// Então a margem honesta aqui é a da LOJA: o overview canônico só produz
// estimatedProfit/marginPct quando o período está coberto E todos os
// componentes (tarifa do escrow, frete, ads, retenção, estorno, custo) são
// conhecidos — null em qualquer um deixa o lucro null, e null nunca vira 0.
// Alíquota ausente = margem NÃO avaliada, com pendência apontando o cadastro
// (a alíquota da Shopee é por loja).

const TYPE = "margem";
const PROVIDER = "shopee";
const MARGIN_FLOOR_PCT = 8;
const MIN_REVENUE = 50; // ignora loja com receita irrisória no período (ruído)

export const shopeeMargemDetector: Detector = {
  type: TYPE,
  provider: PROVIDER,
  async run(): Promise<InsightCandidate[]> {
    const candidates: InsightCandidate[] = [];
    for (const connection of await shopeeConnections()) {
      const overview = await getShopeeOverviewFromCanonical(connection, periodo30d()).catch(() => null);
      if (!overview) continue;
      const loja = overview.account?.name ?? `Loja ${connection.externalAccountId}`;
      const revenue = overview.metrics.revenue30d;

      if (overview.profit.taxRate == null) {
        // Sem alíquota não existe margem honesta — calcular sem o imposto
        // superestimaria a loja inteira. Pendência por loja, apontando o cadastro.
        if (revenue > 0) {
          candidates.push({
            id: `${TYPE}:${PROVIDER}:${connection.externalAccountId}:aliquota`,
            type: TYPE,
            provider: PROVIDER,
            entityRef: "aliquota",
            severity: 60,
            title: `Margem da ${loja} não avaliada`,
            evidence: { aliquotaConfigurada: "não" },
            impact: { premissa: "sem a alíquota de imposto, avaliar a margem superestimaria a loja inteira" },
            recommendation: `Cadastre a alíquota de imposto da ${loja} para a margem ser avaliada.`,
            actionHref: "/shopee/produtos",
          });
        }
        continue;
      }

      // estimatedProfit não-nulo JÁ é a autoridade do canônico: período coberto,
      // escrow processado e todos os componentes conhecidos. Nulo = não avaliar.
      if (overview.profit.estimatedProfit == null || overview.profit.marginPct == null) continue;
      if (revenue < MIN_REVENUE) continue;
      if (overview.profit.marginPct >= MARGIN_FLOOR_PCT) continue;
      const negative = overview.profit.estimatedProfit < 0;

      candidates.push({
        id: `${TYPE}:${PROVIDER}:${connection.externalAccountId}:loja`,
        type: TYPE,
        provider: PROVIDER,
        entityRef: connection.externalAccountId,
        severity: negative ? 88 : 65,
        title: loja,
        evidence: {
          receita30d: +revenue.toFixed(2),
          contribuicao30d: +overview.profit.estimatedProfit.toFixed(2),
          margemPct: +overview.profit.marginPct.toFixed(1),
        },
        impact: negative
          ? { prejuizoNoPeriodo: +(-overview.profit.estimatedProfit).toFixed(2), premissa: "escrow real + custo cadastrado + alíquota, no nível da loja (30 dias) — a Shopee não permite lucro por SKU com segurança" }
          : { margemAbaixoDoPiso: `${overview.profit.marginPct.toFixed(1)}% < ${MARGIN_FLOOR_PCT}%`, premissa: "escrow real + custo cadastrado + alíquota, no nível da loja (30 dias) — a Shopee não permite lucro por SKU com segurança" },
        recommendation: negative
          ? `A ${loja} deu prejuízo de R$ ${(-overview.profit.estimatedProfit).toFixed(2)} em 30 dias. Revise preços e custos do catálogo.`
          : `Margem da ${loja} está em ${overview.profit.marginPct.toFixed(1)}% (abaixo de ${MARGIN_FLOOR_PCT}%). Revise preços, custos e tarifas.`,
        actionHref: "/shopee",
      });
    }
    return candidates;
  },
};
