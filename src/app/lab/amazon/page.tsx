"use client";

/**
 * BANCADA DA AMAZON — `/lab/amazon`. O par de `/lab/mercado-livre`.
 *
 * ⚠️ EXISTE PARA QUE "REPLIQUEI" SEJA VERIFICAVEL (12/09/2026,
 * cobranca dela: *"voce ta validando mercado livre x amazon hoje? … quando vou
 * ver, nao ta igual ainda"*). Ate aqui o trabalho da Amazon era declarado
 * pronto por compilador e teste, porque NENHUM dos dois canais traz dado nesta
 * maquina: a Amazon renderiza a faixa vazia e o Mercado Livre diz "nenhuma
 * conta conectada". Provar rotulo por tipo e comportamento por teste esta
 * certo — e nao responde "as duas telas estao iguais?", que e uma pergunta de
 * olho, lado a lado.
 *
 * ⚠️ MESMOS PRODUTORES DA TELA REAL, NUNCA UMA COPIA. Os numeros
 * entram em `entradaDaFaixaDosCards` e saem por `colunasDoPeriodoAmazon`,
 * `margemDoPeriodoAmazon`, `produtosDoTopAmazon` e `diasDoRitmoAmazon` — as
 * MESMAS funcoes que `/amazon` chama. Uma copia divergiria no primeiro ajuste e
 * passaria a aprovar um desenho que o produto nao tem; e o criterio que a
 * bancada do Mercado Livre ja cumpre.
 *
 * ⚠️ NAO E SERVIDA EM PRODUCAO: `isLab` em
 * `src/lib/supabase/proxy.ts` tira `/lab` do caminho autenticado, e por isso
 * este arquivo pode ter dado fixo sem virar amostra vazando para a tela dela.
 *
 * Os numeros sao os do print de producao de 12/09/2026 — conta real, periodo
 * "hoje". Fixture inventada esconde justamente o que este arquivo existe para
 * mostrar: a tarifa que a Amazon ainda nao publicou.
 */
import { useState } from "react";
import { PainelV3, type DadosV3 } from "../../components/PainelV3";
import { PainelV3Baixo, type DadosV3Baixo } from "../../components/PainelV3Baixo";
import { CANAL_AMAZON } from "@/lib/canalV3";
import type { ProfitabilityLine } from "@/lib/profitability";
import {
  colunasDoPeriodoAmazon,
  diasDoRitmoAmazon,
  margemDoPeriodoAmazon,
  produtosDoTopAmazon,
  type EntradaDaFaixaAmazon,
} from "../../(app)/amazon/amazonPainelV3";

const MOEDA = "BRL";

/**
 * A ENTRADA, com os numeros do print. Repare no que ela exercita de proposito:
 * `logisticaFba` e `anuncio` sao `null` (a Amazon nao publicou), e a tarifa vem
 * INTEIRA de estimativa — os tres casos em que a faixa tem de mostrar ausencia
 * em vez de zero.
 */
const ENTRADA: EntradaDaFaixaAmazon = {
  moeda: MOEDA,
  faturamento: 976.74,
  pedidosPagos: 15,
  tarifas: 365.21,
  tarifasEstimadas: 365.21,
  pedidosComTarifaEstimada: 44,
  logisticaFba: null,
  custoDosProdutos: 345.86,
  anuncio: null,
  aliquota: 5,
  imposto: 41.27,
  lucro: 100.22,
  margemPct: 12.14,
  baseDoResultado: "R$ 825,34 em 44 pedidos",
};

const HOJE = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

const diaRelativo = (recuo: number) => {
  const d = new Date(`${HOJE}T12:00:00`);
  d.setDate(d.getDate() - recuo);
  return d.toLocaleDateString("en-CA");
};

/**
 * SETE DIAS, porque o bloco se chama "Ritmo dos ultimos 7 dias".
 *
 * ⚠️ A PRIMEIRA VERSAO DESTA BANCADA TINHA UM DIA SO (13/09/2026),
 * e ela viu na tela uma barra unica ocupando o cartao inteiro. Amostra que nao
 * exercita a regra nao testa a regra: com um ponto, nenhuma das decisoes deste
 * bloco aparece — nao ha media para a linha tracejada cruzar, nao ha dia no
 * vermelho para descer abaixo dela, e nao ha como ver se o dia corrente fica
 * com o contorno em vez de preenchido.
 *
 * Por isso a serie abaixo tem, de proposito: dias normais, um dia SEM lucro
 * apurado (`profit: null` — a Amazon ainda nao fechou), um dia no PREJUIZO, um
 * dia sem venda nenhuma, e o dia corrente. Os cinco casos que o desenho precisa
 * aguentar.
 */
const SERIE = [
  { date: diaRelativo(6), revenue: 1430.5, orders: 22, units: 27, profit: 181.4 },
  { date: diaRelativo(5), revenue: 1105.2, orders: 18, units: 20, profit: 96.3 },
  // Dia sem apuracao fechada: `null`, nunca zero. Fica so com o contorno e NAO
  // entra na media — e a regra que a nota do rodape promete.
  { date: diaRelativo(4), revenue: 1288.9, orders: 20, units: 24, profit: null },
  { date: diaRelativo(3), revenue: 640.1, orders: 11, units: 12, profit: -58.7 },
  // Dia sem venda: zero aqui e FATO (a loja nao vendeu), diferente do `null`.
  { date: diaRelativo(2), revenue: 0, orders: 0, units: 0, profit: 0 },
  { date: diaRelativo(1), revenue: 902.4, orders: 14, units: 16, profit: 74.8 },
  { date: HOJE, revenue: 976.74, orders: 15, units: 18, profit: 100.22 },
];

const TOP = [
  { sku: "MPAD-27x22-AZUL", title: "Mouse Pad Gamer 27x22cm - Base Antiderrapante, Bordas Costuradas", units: 1, revenue: 14.9, marginPct: 71.5 },
  // Faturamento zero com margem desconhecida: o produto vendeu e a Amazon ainda
  // nao valorizou. E o par do "R$ 0,00" que a tela exibia.
  { sku: "OA-Q8V0-2BQI", title: "Cadarço Preto Achatado 1,20m Resistente 100% Poliéster", units: 1, revenue: 0, marginPct: null },
  { sku: "KIT2-TELA-MOSQUIT-JANELA", title: "Kit 2 Telas Mosquiteiro 150x130cm Anti-Insetos para Janelas", units: 2, revenue: 0, marginPct: null },
];

/** Uma venda com tarifa conhecida e outra `Pending` — o caso que exibia
 *  "Venda —" ao lado de "Tarifa 0,00" ate 12/09/2026. */
const VENDAS: ProfitabilityLine[] = [
  {
    id: "702-5341313-6443419:1", product: "Kit com 6 Pincéis Artísticos de Ponta Fina Para Aquarela",
    sku: "KIT6-PINCEIS-FINO-AZUL", orderId: "702-5341313-6443419", date: `${HOJE}T12:04:00Z`, status: "Pending", fulfillment: "FBA",
    quantity: 1, currency: MOEDA, revenue: null, marketplaceFees: null, sellerShipping: null, buyerShipping: null,
    productCost: 3.22, tax: null, contribution: null, marginPct: null,
    unitPrice: null, complete: false,
  },
  {
    id: "702-9114360-3215452:1", product: "Faca de Pão com Lâmina Serrilhada em Aço Inox",
    sku: "CK6581", orderId: "702-9114360-3215452", date: `${HOJE}T11:40:00Z`, status: "Shipped", fulfillment: "FBA",
    quantity: 1, currency: MOEDA, revenue: 39.9, marketplaceFees: 5.99, sellerShipping: null, buyerShipping: null,
    productCost: 9.08, tax: 2.0, contribution: 22.83, marginPct: 57.2,
    unitPrice: 39.9, complete: true,
  },
];

const BAIXO: DadosV3Baixo = {
  catalogo: null,
  promocoes: null,
  revisar: {
    linhas: VENDAS.slice(0, 5).map((l) => ({
      id: l.id,
      produto: l.product,
      detalhe: [l.sku, `${l.quantity} un`].filter(Boolean).join(" · "),
      pedido: "#…" + String(l.orderId).slice(-6),
      logistica: l.fulfillment ?? "—",
      venda: l.revenue == null ? "—" : l.revenue.toFixed(2).replace(".", ","),
      tarifa: l.marketplaceFees == null ? "—" : l.marketplaceFees.toFixed(2).replace(".", ","),
      frete: "—",
      custo: l.productCost == null ? "—" : l.productCost.toFixed(2).replace(".", ","),
      custoVazio: l.productCost == null,
      imposto: l.tax == null ? "—" : l.tax.toFixed(2).replace(".", ","),
      impostoVazio: l.tax == null,
      margemPct: l.marginPct,
    })),
    href: "/amazon/monitor",
    vazio: "Nenhum pedido no período.",
    escopo: "1 de 47 vendas com cálculo completo",
  },
  /** ANUNCIOS PAGOS — faltava na bancada, e foi assim que ela viu a ausencia. */
  anuncios: {
    linhas: [
      { id: "a1", produto: "Mouse Pad Gamer 27x22cm - Base Antiderrapante", trafego: "1.204 impressões · 38 cliques", gasto: "24,60", vendas: "89,40", compras: "6", acos: "27,5%", roas: "3,63", margemPct: 31.2 },
      // Gasto sem venda: ACOS e ROAS ficam "—", nunca 0% — zero afirmaria
      // eficiencia perfeita onde nao houve venda nenhuma.
      { id: "a2", produto: "Kit 2 Telas Mosquiteiro 150x130cm", trafego: "842 impressões · 11 cliques", gasto: "9,80", vendas: "0,00", compras: "0", acos: "—", roas: "—", semVenda: true, margemPct: null },
    ],
    resumo: "gasto R$ 34,40",
    href: "/amazon/anuncios",
  },
  radar: {
    itens: [
      { id: "1", titulo: "Conjunto Esguicho para Mangueira 3 Bicos de Jato", unidades: "—", cobertura: "esgotado", tom: "critico" },
      { id: "2", titulo: "Caneca de Cerâmica 330ml com Textura Canelada", unidades: "3 un", cobertura: "4 dias", tom: "atencao" },
    ],
    href: "/amazon/estoque",
    vazio: "Nenhum SKU em ruptura iminente.",
  },
  /** REPASSES — o que a Amazon ja liberou e o que ela ainda retem. Na tela real
   *  e o `SaldoNaAmazon`; aqui entra a mesma forma com numeros do print. */
  saldo: (
    <section className="v3-card">
      <div className="v3-card-cab"><h2>Repasses</h2></div>
      <div className="v3-colunas" style={{ "--colunas": 2 } as React.CSSProperties}>
        <div className="v3-coluna">
          <p className="v3-coluna-rotulo">Disponível agora</p>
          <strong className="v3-coluna-valor">R$ 1.242,21</strong>
          <p className="v3-coluna-share">liberado para transferência</p>
        </div>
        <div className="v3-coluna">
          <p className="v3-coluna-rotulo">Retido pela Amazon</p>
          <strong className="v3-coluna-valor">R$ 7.637,31</strong>
          <p className="v3-coluna-share">primeira liberação em 11/09/2026</p>
        </div>
      </div>
    </section>
  ),
};

export default function BancadaDaAmazon() {
  const [metrica, setMetrica] = useState("Faturamento");
  const dados: DadosV3 = {
    periodoLabel: "hoje",
    resumoApuracao: <>15 pedidos apurados</>,
    colunas: colunasDoPeriodoAmazon(ENTRADA),
    margem: margemDoPeriodoAmazon(ENTRADA),
    notaDoImposto: null,
    produtos: produtosDoTopAmazon(TOP, MOEDA),
    ritmo: {
      metricas: ["Faturamento", "Pedidos", "Unidades"],
      metricaAtiva: metrica,
      aoTrocarMetrica: setMetrica,
      legendaTotal: "faturamento",
      legendaMedia: "média de lucro do período",
      mostraLucro: true,
      media: SERIE.filter((d) => d.profit != null).reduce((a, d) => a + (d.profit ?? 0), 0) / SERIE.filter((d) => d.profit != null).length,
      dias: diasDoRitmoAmazon(
        SERIE,
        { metrica, moeda: MOEDA, hoje: HOJE, diaDaSemana: (data) => new Date(`${data}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short" }) },
      ),
      nota: "A parte cheia é o que sobrou do que foi vendido naquele dia.",
    },
    pendencias: [
      { id: "tarifa", titulo: "44 pedidos com tarifa estimada", efeito: "o lucro muda quando a Amazon publicar o extrato", acao: "Ver pedidos", href: "/amazon/monitor", tom: "atencao" },
    ],
    hrefs: { resultado: "/amazon/monitor", produtos: "/amazon/produtos", historico: "/amazon/desempenho", pendencias: "/amazon/monitor" },
  };

  return (
    <main style={{ padding: 24, background: "var(--suave, #f6f6f4)", minHeight: "100vh" }}>
      <PainelV3 dados={dados} />
      <div style={{ height: 20 }} />
      {/* O MESMO componente que o Mercado Livre renderiza no fundo da tela — e
          e comparando estes dois que se responde "esta igual?". */}
      <PainelV3Baixo canal={CANAL_AMAZON} dados={BAIXO} />

    </main>
  );
}
