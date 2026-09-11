import { getMercadoLivreAbc } from "../../integrations/mercadoLivreAbc";
import type { Detector, InsightCandidate } from "../types";
import { mercadoLivreConnections } from "./mercadoLivreRuptura";

// Detector de margem comprometida (Mercado Livre). Reimplementação do princípio
// da Amazon com o canônico do ML, via curva ABC — que já aplica as regras caras
// do canal: contribution é NULL quando falta custo (null ≠ 0, o produto fica de
// fora em vez de fingir margem), e taxRate NULL significa alíquota não
// configurada — aí NENHUMA margem é avaliada (calcular margem sem o imposto
// superestimaria todo mundo); o que sai é uma pendência apontando o cadastro.

const TYPE = "margem";
const PROVIDER = "mercado_livre";
const MARGIN_FLOOR_PCT = 8;
const MIN_REVENUE = 50; // ignora SKUs com receita irrisória no período (ruído)

function periodo30d() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  return { from, to, label: "Últimos 30 dias" };
}

export const mercadoLivreMargemDetector: Detector = {
  type: TYPE,
  provider: PROVIDER,
  async run(): Promise<InsightCandidate[]> {
    const candidates: InsightCandidate[] = [];
    for (const connection of await mercadoLivreConnections()) {
      const abc = await getMercadoLivreAbc(connection, periodo30d()).catch(() => null);
      if (!abc) continue;

      if (abc.taxRate == null) {
        // Sem alíquota não existe margem honesta. Uma pendência por conta,
        // severidade "Monitorar" — é configuração da vendedora, não incêndio.
        const temVenda = abc.products.some((p) => p.revenue > 0);
        if (temVenda) {
          candidates.push({
            id: `${TYPE}:${PROVIDER}:${connection.externalAccountId}:aliquota`,
            type: TYPE,
            provider: PROVIDER,
            entityRef: "aliquota",
            severity: 60,
            title: "Margem do Mercado Livre não avaliada",
            evidence: { aliquotaConfigurada: "não" },
            impact: { premissa: "sem a alíquota de imposto, calcular margem superestimaria todos os produtos" },
            recommendation: "Cadastre a alíquota de imposto do Mercado Livre para a margem por produto ser avaliada.",
            actionHref: "/mercado-livre/anuncios",
          });
        }
        continue;
      }

      for (const product of abc.products) {
        // Sem custo cadastrado não há contribuição — o produto fica de fora
        // (a pendência de custo já aparece no dashboard do canal).
        if (!product.complete || product.contribution == null || product.marginPct == null) continue;
        if (product.revenue < MIN_REVENUE) continue;
        if (product.marginPct >= MARGIN_FLOOR_PCT) continue;
        const negative = product.contribution < 0;
        const name = product.title || product.sku || product.productId;

        candidates.push({
          id: `${TYPE}:${PROVIDER}:${connection.externalAccountId}:${product.productId}`,
          type: TYPE,
          provider: PROVIDER,
          entityRef: product.sku ?? product.productId,
          severity: negative ? 88 : 65,
          title: name,
          evidence: {
            receita30d: +product.revenue.toFixed(2),
            contribuicao30d: +product.contribution.toFixed(2),
            margemPct: +product.marginPct.toFixed(1),
            unidades: product.units,
          },
          impact: negative
            ? { prejuizoNoPeriodo: +(-product.contribution).toFixed(2), premissa: "vendas com tarifa real e custo cadastrado (30 dias)" }
            : { margemAbaixoDoPiso: `${product.marginPct.toFixed(1)}% < ${MARGIN_FLOOR_PCT}%`, premissa: "vendas com tarifa real e custo cadastrado (30 dias)" },
          recommendation: negative
            ? `${name} deu prejuízo de R$ ${(-product.contribution).toFixed(2)} em 30 dias no Mercado Livre. Revise preço e custo — ou considere pausar.`
            : `Margem de ${name} está em ${product.marginPct.toFixed(1)}% (abaixo de ${MARGIN_FLOOR_PCT}%). Revise preço, custo ou tarifa.`,
          actionHref: "/mercado-livre/abc",
        });
      }
    }
    return candidates;
  },
};
