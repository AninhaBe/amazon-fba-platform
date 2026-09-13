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
import { OrderProfitabilityTableV3 } from "../../components/OrderProfitabilityTableV3";
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
      media: 100.22,
      dias: diasDoRitmoAmazon(
        [{ date: HOJE, revenue: 976.74, orders: 15, units: 18, profit: 100.22 }],
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
      <OrderProfitabilityTableV3 canal={CANAL_AMAZON} lines={VENDAS} scopeNote="1 de 47 vendas com cálculo completo" />
    </main>
  );
}
