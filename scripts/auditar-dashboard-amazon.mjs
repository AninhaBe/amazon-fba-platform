/**
 * AUDITORIA DO DASHBOARD DA AMAZON — todos os números visíveis, de uma vez.
 *
 * ⚠️ POR QUE ISTO EXISTE (02/09/2026): a vendedora achou cinco defeitos de
 * coerência em dois dias, um por vez, cada um num print. Consertar de um em um
 * fez dela a auditora do produto. Este script enumera TODO número da tela, diz
 * de que FONTE e de que UNIVERSO ele vem, e confere as equações que precisam
 * fechar — para que a próxima divergência apareça aqui, não no print dela.
 *
 * Os três universos da tela, e é a mistura entre eles que produz a família
 * inteira de defeitos:
 *   TOTAL      — todo pedido não cancelado do período, pendentes inclusos.
 *                É a base que ela definiu para o lucro. Vem do `orderMetrics`.
 *   CONCILIADO — só o pedido cujo repasse a Amazon já postou. É o universo que o
 *                painel "Repasses, taxas e lucro" declara no próprio subtítulo.
 *   PERÍODO    — custos que não têm atribuição por pedido (anúncio), e por isso
 *                não pertencem a nenhum dos dois acima.
 *
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/ts-resolver.mjs \
 *        scripts/auditar-dashboard-amazon.mjs [--de 2026-09-01] [--ate 2026-09-01]
 */
process.env.DB_POOL_MAX = "8";
import { runWithWorkspace } from "../src/lib/workspaceScope.ts";
import { runWithAccount } from "../src/lib/accountContext.ts";
import { periodFromRange } from "../src/lib/period.ts";
import { amazonFinancialCards } from "../src/app/(app)/amazon/amazonFinancialCards.ts";

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(nome);
  return i === -1 ? padrao : process.argv[i + 1];
};
const DE = arg("--de", "2026-09-01");
const ATE = arg("--ate", "2026-09-01");
const WS = arg("--workspace", "22ae3d9d-6f28-4ec2-96dd-a106b2b3e40d");
const SELLER = arg("--seller", "A15NQMF7A6J1Y0");

const n = (v) => (v == null ? "—" : Number(v).toFixed(2));
const cent = (a, b) => Math.abs(Number(a ?? 0) - Number(b ?? 0)) < 0.02;
const marca = (ok) => (ok ? "FECHA" : "🔴 NAO FECHA");

await runWithWorkspace(WS, () => runWithAccount({ workspaceId: WS, sellerId: SELLER }, async () => {
  const { getAmazonOverviewFromCanonical } = await import("../src/lib/integrations/amazonOverviewCanonical.ts");
  const periodo = periodFromRange(DE, ATE);
  // O faturamento injetado é o `orderMetrics`; sem credencial de leitura aqui,
  // usa-se o piso do banco e o relatório DIZ isso, para ninguém confundir a
  // ausência da injeção com um defeito da tela.
  const ov = await getAmazonOverviewFromCanonical(periodo);
  const p = ov.profit;
  const c = p.composicaoDoConciliado;
  const cards = amazonFinancialCards({
    finance: ov.finance ?? p.finance ?? null,
    cogs: p.cogs, estimatedProfit: p.estimatedProfit, unitsWithoutCost: p.unitsWithoutCost,
    taxRate: p.taxRate, taxes: p.taxes, refunds: p.refunds, refundCount: p.refundCount,
    faturamentoTotal: p.revenueDoLucro, baseDoLucro: p.revenueDoLucro,
    feesDoLucro: p.fees, feesEstimadas: p.feesEstimadas,
    pedidosComTarifaEstimada: p.pedidosComTarifaEstimada,
    pedidosSemValor: p.pedidosSemValor, pedidosDoPeriodo: p.pedidosDoPeriodo,
  });
  const carta = (k) => cards.find((x) => x.key === k);

  console.log(`\n=== AUDITORIA DO DASHBOARD DA AMAZON — ${DE} a ${ATE} ===`);
  console.log(`conexao amazon:${SELLER} | workspace ${WS.slice(0, 8)}`);
  console.log(`⚠️ sem faturamento injetado nesta execucao: a base cai no piso do banco.`);
  console.log(`   Na tela real o card de Faturamento vem do orderMetrics e e MAIOR.\n`);

  const linha = (numero, fonte, universo, valor) =>
    console.log(`  ${numero.padEnd(26)} ${fonte.padEnd(34)} ${universo.padEnd(11)} ${n(valor).padStart(11)}`);

  console.log("NUMERO                     FONTE                              UNIVERSO         VALOR");
  console.log("-".repeat(92));
  linha("Faturamento (card)", "profit.revenueDoLucro", "TOTAL", carta("revenue")?.raw);
  linha("Taxas (card)", "profit.fees", "TOTAL", carta("fees")?.raw);
  linha("  └ oficial", "fees - feesEstimadas", "TOTAL", (p.fees ?? 0) - (p.feesEstimadas ?? 0));
  linha("  └ estimada", "profit.feesEstimadas", "TOTAL", p.feesEstimadas);
  linha("Custo (card)", "profit.cogs", "TOTAL", carta("cogs")?.raw);
  linha("Impostos (card)", "profit.taxes", "TOTAL", carta("tax")?.raw);
  linha("Estornos (card)", "profit.refunds", "TOTAL", carta("refunds")?.raw);
  linha("Ads (card)", "profit.ads", "PERIODO", p.ads);
  linha("Lucro (card)", "profit.estimatedProfit", "TOTAL", carta("profit")?.raw);
  linha("Margem (card)", "lucro / base", "TOTAL", carta("marginPct")?.raw);
  linha("Painel: centro", "composicaoDoConciliado.receita", "CONCILIADO", c?.receita);
  linha("Painel: taxas", "composicaoDoConciliado.tarifa", "CONCILIADO", c?.tarifa);
  linha("Painel: custo", "composicaoDoConciliado.custo", "CONCILIADO", c?.custo);
  linha("Painel: resultado", "composicaoDoConciliado.lucro", "CONCILIADO", c?.lucro);
  linha("Painel: margem", "lucro / centro", "CONCILIADO", c?.margemPct);
  linha("Pedidos do periodo", "profit.pedidosDoPeriodo", "TOTAL", p.pedidosDoPeriodo);
  linha("Pedidos com valor", "profit.pedidosComValor", "TOTAL", p.pedidosComValor);
  linha("Pedidos sem valor", "profit.pedidosSemValor", "TOTAL", p.pedidosSemValor);
  linha("Pedidos com estimativa", "profit.pedidosComTarifaEstimada", "TOTAL", p.pedidosComTarifaEstimada);
  linha("Pedidos do painel", "composicaoDoConciliado.pedidos", "CONCILIADO", c?.pedidos);
  linha("Linhas de rentabilidade", "profitabilityLines.length", "TOTAL", ov.profitabilityLines.length);
  linha("Unidades sem custo", "profit.unitsWithoutCost", "TOTAL", p.unitsWithoutCost);

  console.log("\nEQUACOES QUE PRECISAM FECHAR");
  console.log("-".repeat(92));
  const eq = [];
  const somaCards = (carta("revenue")?.raw ?? 0) - (carta("cogs")?.raw ?? 0)
    - (carta("fees")?.raw ?? 0) - (carta("tax")?.raw ?? 0) - (carta("refunds")?.raw ?? 0) - (p.ads ?? 0);
  eq.push(["cards: faturamento - custo - taxas - imposto - estorno - ads = lucro",
    cent(somaCards, carta("profit")?.raw), `${n(somaCards)} vs ${n(carta("profit")?.raw)}`]);
  const somaPainel = (c?.tarifa ?? 0) + (c?.custo ?? 0) + (c?.lucro ?? 0);
  eq.push(["painel: taxas + custo + resultado = centro",
    cent(somaPainel, c?.receita), `${n(somaPainel)} vs ${n(c?.receita)}`]);
  eq.push(["card Taxas = oficial + estimada",
    cent(carta("fees")?.raw, ((p.fees ?? 0) - (p.feesEstimadas ?? 0)) + (p.feesEstimadas ?? 0)),
    `${n(carta("fees")?.raw)} vs ${n(p.fees)}`]);
  eq.push(["pedidos: com valor + sem valor = do periodo",
    (p.pedidosComValor ?? 0) + (p.pedidosSemValor ?? 0) === (p.pedidosDoPeriodo ?? 0),
    `${p.pedidosComValor} + ${p.pedidosSemValor} vs ${p.pedidosDoPeriodo}`]);
  eq.push(["painel: pedidos do painel <= pedidos com valor",
    (c?.pedidos ?? 0) <= (p.pedidosComValor ?? 0),
    `${c?.pedidos} vs ${p.pedidosComValor}`]);
  eq.push(["margem do card = lucro / base",
    carta("marginPct")?.raw == null || cent(carta("marginPct").raw,
      ((carta("profit")?.raw ?? 0) / (carta("revenue")?.raw || 1)) * 100),
    `${n(carta("marginPct")?.raw)}`]);
  eq.push(["margem do painel = resultado / centro",
    c?.margemPct == null || cent(c.margemPct, ((c.lucro ?? 0) / (c.receita || 1)) * 100),
    `${n(c?.margemPct)}`]);
  for (const [nome, ok, detalhe] of eq) {
    console.log(`  ${marca(ok).padEnd(14)} ${nome}`);
    console.log(`                 ${detalhe}`);
  }
  const quebradas = eq.filter(([, ok]) => !ok).length;
  console.log(`\n${eq.length - quebradas} de ${eq.length} equacoes fecham. ${quebradas ? `🔴 ${quebradas} NAO FECHAM.` : "Todas fecham."}`);
}));
process.exit(0);
