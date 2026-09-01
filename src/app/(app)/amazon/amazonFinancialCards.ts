// Cards financeiros da Amazon — mesmo padrão do TikTok (`TikTokWorkspaceModel.ts`):
// componente sem dado NÃO vira zero. Cada card diz exatamente o que está faltando,
// porque "R$ 0,00" e "ainda não sei" são fatos diferentes e confundi-los corrompe
// qualquer decisão de preço ou de compra de estoque.
//
// Módulo puro: a única dependência é o rótulo compartilhado pelos quatro canais.

// Relativo, nao "@/": este modulo e carregado direto pelos testes, onde o
// alias do Next nao existe.
import { comSemImposto } from "../../../lib/semImposto";
import { nomeDaBase } from "../../components/baseDaMargem";

export interface AmazonFinanceInput {
  currency: string;
  revenue: number;
  /** `null` = a Amazon ainda não postou tarifa nenhuma no período — não é zero. */
  fees: number | null;
  refunds: number;
  promotions?: number;
  buyerShipping?: number;
  feeBreakdown?: { type: string; amount: number }[];
  /**
   * Pedidos com repasse POSTADO no período. Zero significa que a Amazon ainda
   * não postou nada — e aí todo valor derivado é desconhecido, não zero.
   * Opcional porque nem toda origem informa; ausente, o comportamento é o de
   * antes (não trava nada).
   */
  orderCount?: number;
}

/**
 * Métricas de anúncio do período, vindas da Ads API (`workspace_ad_metrics`).
 *
 * ⚠️ NÃO vem do extrato financeiro. A Amazon não posta gasto com anúncio como
 * tarifa de pedido — verificado em 25/08/2026: os únicos tipos gravados em
 * `workspace_channel_order_fees` são `commission`, `refund` e `fulfillment`.
 * Anúncio é cobrança de conta, e só existe pela Ads API.
 */
export interface AmazonAdsInput {
  /** Gasto com anúncio no período. */
  cost: number;
  /** Vendas ATRIBUÍDAS ao anúncio na janela de 30 dias — NÃO é o faturamento. */
  sales: number;
  purchases: number;
  /** Último dia COM métrica gravada (`YYYY-MM-DD`). */
  ateDia: string | null;
  /** Último dia que DEVERIA ter métrica. Se `ateDia` for menor, falta anúncio. */
  esperadoAte: string;
}

export interface AmazonCardsInput {
  finance: AmazonFinanceInput | null;
  cogs: number;
  /**
   * O LUCRO DO PERÍODO, **já com o anúncio dentro** — ver a fronteira em
   * `src/lib/financialMath.ts`. Vem pronto de `profit.ts`; esta tela LÊ.
   *
   * ⚠️ Era "lucro ANTES de anúncio" até 30/08/2026, e a subtração morava aqui.
   * `null` = gasto com anúncio desconhecido, e o produtor já decidiu isso.
   */
  estimatedProfit: number | null;
  /** Unidades vendidas sem custo cadastrado — invalida COGS, lucro, margem e ROI. */
  unitsWithoutCost: number;
  /** Alíquota declarada pela vendedora. `null` = não configurada. */
  taxRate?: number | null;
  /** Imposto do período, já descontado de `estimatedProfit`. `null` sem alíquota. */
  taxes?: number | null;
  /**
   * ⚠️ FATURAMENTO = TODOS OS PEDIDOS DO PERÍODO, por data do pedido, INCLUSIVE
   * os pendentes (decisão dela em 30/08/2026, abaixo). `null` = ainda não veio.
   *
   * É uma base DIFERENTE de `finance.revenue`, que é o subconjunto já apurado —
   * e é justamente essa diferença que precisa ficar declarada na tela.
   */
  faturamentoTotal?: number | null;
  /** Quantos pedidos do período ainda não têm valor/custo/tarifa apurados. */
  pedidosAguardando?: number;
  /**
   * A BASE DE LUCRO E MARGEM — o faturamento do período (`profit.revenueDoLucro`).
   *
   * ⚠️ É ESTE CAMPO, e não `finance.revenue`, que fecha o defeito de 31/08/2026.
   * O produtor passou a calcular o lucro sobre o faturamento inteiro e esta
   * camada continuou dividindo por `finance.revenue` (o apurado): numerador de um
   * universo, denominador de outro. Na conta A15NQMF7A6J1Y0 isso exibiu −90,5%
   * de margem — −108,82 / 120,19 — enquanto o lucro cobria R$ 456,86.
   *
   * `null` = o produtor não informou; a margem então volta ao comportamento
   * antigo em vez de inventar base.
   */
  baseDoLucro?: number | null;
  /**
   * Pedidos que a Amazon ainda não valorizou — ficam FORA da base. A tela os
   * aponta com número, nunca com a palavra "parcial".
   */
  pedidosSemValor?: number;
  /**
   * Total de pedidos do período na base. Serve para a tela dizer "30 de 31" em
   * vez de "30" — sem o denominador, o número não diz se é quase tudo ou quase
   * nada, e é dele que sai a decisão de afirmar ou não a margem.
   */
  pedidosNaBase?: number;
  /** Quanto do total de tarifas é estimativa da Amazon (ADR-027). */
  feesEstimadas?: number | null;
  /** Quantos pedidos entraram com tarifa estimada em vez de postada. */
  pedidosComTarifaEstimada?: number;
  /**
   * Estorno do período, já descontado do lucro (decisão dela em 31/08/2026:
   * "estorno reduz o resultado do período"). `0` = não houve devolução.
   */
  refunds?: number;
  /** Quantas devoluções compõem o valor acima. */
  refundCount?: number;
  /** Anúncio do período. `null` = não sincronizado (≠ não gastou). */
  ads?: AmazonAdsInput | null;
  /**
   * O gasto com anúncio JÁ DESCONTADO de `estimatedProfit` pelo produtor.
   * Serve para a tela ESCREVER o que foi descontado — nunca para descontar.
   * `null` = desconhecido; `0` = não gastou.
   */
  adsNoLucro?: number | null;
  /**
   * A janela do período em dia-calendário BRT. Enviada sempre que há Ads
   * conectado, INCLUSIVE quando não há métrica — é ela que distingue
   * "sync atrasado" de "a Amazon ainda não publicou".
   */
  adsJanela?: { inicioDia: string; esperadoAte: string; incluiHoje?: boolean } | null;
  /**
   * A conta tem Ads conectado?
   *
   * É o que separa "não anuncia" de "não sei quanto gastou". Sem Ads conectado,
   * lucro sem anúncio é o lucro real. COM Ads conectado e sem métrica, lucro
   * seria otimista — e otimista sem aviso é mentira (`null ≠ 0`).
   */
  adsConectado?: boolean;
}

export interface AmazonCard {
  key: string;
  label: string;
  value: string;
  context: string;
  tone?: "positive" | "danger" | "default";
  /** Valor cru, quando conhecido. É o que permite animar o número na tela. */
  raw?: number | null;
  /**
   * A base de cálculo, quando ela é DIFERENTE do card de Faturamento ao lado.
   *
   * ⚠️ CAMPO PRÓPRIO, e não `context`, porque `context` vai para o "i" — e
   * declaração dentro de tooltip não declara nada. Em 31/08/2026 a tela exibia
   * lucro e margem de um universo ao lado do faturamento de outro, COM a frase
   * explicando, e a vendedora mesmo assim concluiu que estava errado: a frase
   * existia num lugar que ela não sabia que existia. O teste garantia a frase e
   * não garantia a LEITURA.
   *
   * Quem renderiza tem de pôr isto num campo visível sem interação (`sub`).
   * `undefined` quando as bases coincidem — explicar diferença que não existe
   * treina a pessoa a ignorar a frase no dia em que ela importa.
   */
  baseDeclarada?: string;
  /**
   * Procedencia da estimativa (ADR-027), para o selo colado ao numero.
   *
   * ⚠️ CAMPO SEPARADO DE `baseDeclarada`, e nao a mesma frase: a frase diz
   * QUANTO do total e estimado e renderiza na face; o selo diz que ESTE numero
   * ainda nao e o oficial, e existe para quem olha rapido sem ler o rodape.
   * `undefined` quando nao ha pedido estimado — marca permanente vira decoracao.
   */
  marcaEstimativa?: string;
}

import { PROCEDENCIA_DO_AGREGADO } from "../../components/procedenciaDaEstimativa";

const money = (v: number, currency: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);
const percent = (v: number) =>
  `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

const diaBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Quantos dias do período ainda não têm métrica de anúncio.
 *
 * Datas `YYYY-MM-DD` lidas como UTC: as duas são dia civil puro, então a
 * diferença é exata e não depende de fuso — a mesma cautela que o `brDate` usa
 * para não deslocar a data de liberação do ML em um dia.
 */
export function diasSemAnuncio(ateDia: string | null, esperadoAte: string): number {
  if (!ateDia) return 0;
  const dias = (Date.parse(`${esperadoAte}T00:00:00Z`) - Date.parse(`${ateDia}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(dias) && dias > 0 ? Math.round(dias) : 0;
}

// Categorização por PADRÃO, não por lista de nomes exatos.
//
// A lista exata era um risco silencioso: a Amazon tem dezenas de tarifas FBA
// (`FBADisposalFee`, `FBARemovalFee`, `FBALongTermStorageFee`,
// `FBAInboundPlacementServiceFee`…) e só `FBAPerUnitFulfillmentFee` estava
// confirmada — o resto era suposição. Numa conta que paga tarifa, um nome fora
// da lista sairia como R$ 0,00: resposta errada com cara de certeza, agora que
// ausência em período conciliado significa zero.
//
// Tipo que não casa com nenhum padrão continua somando em "Taxas" — nada é
// descartado, e "Taxas" é sempre a autoridade sobre o total.
const LOGISTICA_FBA = (tipo: string) => /^FBA/i.test(tipo) || /fulfillment|storage/i.test(tipo);
const ANUNCIOS = (tipo: string) => /advertis|productads/i.test(tipo);
const COMISSAO = (tipo: string) => /commission|referralfee/i.test(tipo);

/**
 * O LUCRO DO PERÍODO — hoje um LEITOR, e é isso que a função tem de ser.
 *
 * ⚠️ ELA JÁ FOI A CONTA (25 a 30/08/2026), e esse foi o defeito. A subtração do
 * anúncio nasceu no card, virou função quando o painel divergiu dele, cresceu
 * para a conta inteira quando a cascata divergiu dos dois — e enquanto isso
 * MERCADO LIVRE, MONITOR e HOME nem sabiam que anúncio existia. Três cópias na
 * tela da Amazon e nenhuma nos outros: a conta estava no andar errado.
 *
 * Em 30/08/2026 a subtração subiu para quem PRODUZ o número (`profit.ts` e os
 * canônicos de cada canal), sob a fronteira escrita em `src/lib/financialMath.ts`:
 * **`estimatedProfit` inclui anúncio; quem consome não subtrai de novo.**
 *
 * O que sobrou aqui é o que uma tela pode fazer: ler o lucro que chegou e dizer
 * o que foi descontado. Se você sentir falta da subtração nesta função, ela já
 * aconteceu — procure `descontarAnuncio` no produtor do canal.
 */
export function lucroDoPeriodo(input: {
  estimatedProfit?: number | null;
  adsNoLucro?: number | null;
}): { lucro: number | null; gastoComAnuncio: number | null; desconhecido: boolean } {
  return {
    lucro: input.estimatedProfit ?? null,
    gastoComAnuncio: input.adsNoLucro ?? null,
    // `null` de gasto com lucro `null` é o produtor dizendo "não sei o anúncio".
    // Com lucro presente, gasto ausente é só uma tela que não recebeu o detalhe.
    desconhecido: input.estimatedProfit == null && input.adsNoLucro == null,
  };
}

/**
 * Tipo de tarifa ausente num período **conciliado** vale ZERO, não "não sei": a
 * Amazon já postou o extrato e simplesmente não cobrou aquilo. Tratar como
 * desconhecido fazia três dos doze cards exibirem "—" para sempre, sugerindo
 * falha de leitura quando o fato é que a tarifa não existe (hoje a logística FBA
 * está isenta pela promoção de vendedor novo).
 *
 * Sem extrato conciliado, aí sim é desconhecido — e continua "—".
 */
function somaTipos(
  breakdown: { type: string; amount: number }[] | undefined,
  pertence: (tipo: string) => boolean,
  conciliado: boolean
): number | null {
  const achados = (breakdown ?? []).filter((f) => pertence(f.type));
  if (achados.length) return +achados.reduce((s, f) => s + f.amount, 0).toFixed(2);
  return conciliado ? 0 : null;
}

export function amazonFinancialCards(input: AmazonCardsInput): AmazonCard[] {
  const f = input.finance;
  const currency = f?.currency ?? "BRL";
  const semExtrato = "Aguardando repasse postado pela Amazon";
  const custoIncompleto = input.unitsWithoutCost > 0;

  // NENHUM REPASSE POSTADO no período: o resumo financeiro EXISTE, mas está
  // vazio. Sem esta trava, tudo que deriva dele saía como R$ 0,00 — e zero aqui
  // não é fato, é ausência.
  //
  // Achado por ela em 24/08/2026: um pedido de R$ 21,90 aguardando pagamento,
  // e a tela mostrando "Custo dos produtos R$ 0,00" e "Lucro R$ 0,00". O painel
  // ao lado já dizia a verdade em prosa ("A Amazon ainda não postou repasse
  // deste período"), enquanto os cards afirmavam que não houve custo nem lucro.
  // É o `null ≠ 0` do AGENTS.md: "não cobraram" e "ainda não sei" viravam o
  // mesmo número.
  //
  // ⚠️ NÃO vale quando há repasse postado e o valor É zero. Aí zero é notícia —
  // a promoção de vendedor novo realmente zera comissão e logística, e o
  // `contextoQuandoZero` de cada card explica isso.
  const semRepassePostado = f != null && f.orderCount === 0;

  // Zero tem significado próprio e merece explicação: "não cobraram" é notícia,
  // e o card que só diz "Total do período conciliado" desperdiça a informação.
  /**
   * ⚠️ `independeDoExtrato` EXISTE POR CAUSA DE UMA TELA EM BRANCO (01/09/2026).
   *
   * O guard `semRepassePostado` apagava TODOS os cards quando a Amazon ainda não
   * tinha postado repasse de nenhum pedido — o que é o estado normal de uma
   * manhã, com tudo pendente. Medido às 11:38 na conta dela: Faturamento em
   * BRANCO enquanto "Pedidos feitos" exibia R$ 348,07, o mesmo número que o
   * Seller Central mostrava. **O número certo estava na tela, no card de baixo,
   * e o card que ela olha estava vazio.**
   *
   * O guard está certo para o que vem do EXTRATO — Taxas, Logística, Frete do
   * comprador, Repasse líquido. Ali "não postou" é mesmo "não sei quanto".
   *
   * Mas Faturamento e Custo NÃO vêm do extrato: o faturamento é a base de
   * pedidos (a mesma do Seller Central) e o custo é cadastro dela. Apagá-los
   * porque a Amazon não liquidou confunde os dois universos de novo — é a mesma
   * família do defeito da base misturada, agora em forma de ausência.
   *
   * ⚠️ Este defeito é ANTERIOR à unificação da base: o guard e este `num` já
   * eram assim em `e8fee24`. Ele só não aparecia porque quase sempre havia ao
   * menos um pedido liquidado no período.
   */
  const num = (
    v: number | null | undefined,
    contextoQuandoFalta: string,
    tone?: "positive" | "danger",
    contextoQuandoZero?: string,
    independeDoExtrato = false
  ): Omit<AmazonCard, "key" | "label"> =>
    v == null || (semRepassePostado && !independeDoExtrato)
      ? { value: "—", context: semRepassePostado && !independeDoExtrato ? semExtrato : contextoQuandoFalta, raw: null }
      : {
          value: money(v, currency),
          // ⚠️ "Total do período CONCILIADO" só vale para o que veio do extrato.
          // Dizer isso do Faturamento — que é a base de pedidos, com pendente
          // dentro — seria afirmar uma conciliação que não aconteceu. Rótulo que
          // promete mais do que o número é da mesma família da declaração falsa
          // que a Vitrine achou no ML em 01/09/2026.
          context: v === 0 && contextoQuandoZero
            ? contextoQuandoZero
            : independeDoExtrato ? "Todos os pedidos do período" : "Total do período conciliado",
          tone,
          raw: v,
        };

  // ⚠️ `conciliado` É "EXISTE EXTRATO", NÃO "EXISTE OBJETO `f`" (30/08/2026).
  //
  // Antes o terceiro argumento era `f != null`, e `f` existe sempre que a rota
  // responde. Com o período sem nenhuma linha de tarifa, os três cards abaixo
  // afirmavam R$ 0,00 com o contexto "A Amazon não cobrou no período" — a mesma
  // fabricação do card "Taxas", replicada em três lugares. `f.fees == null` é
  // exatamente o sinal de "não há extrato ainda".
  const conciliado = f != null && f.fees != null;
  const logistica = somaTipos(f?.feeBreakdown, LOGISTICA_FBA, conciliado);
  const anuncios = somaTipos(f?.feeBreakdown, ANUNCIOS, conciliado);
  const comissao = somaTipos(f?.feeBreakdown, COMISSAO, conciliado);

  // ANÚNCIO É CUSTO, E ENTRA NO LUCRO.
  //
  // Decisão dela em 25/08/2026: *"o card de lucro passa a descontar também o
  // ads, isso é lucro real"*. E o dado que motivou: R$ 295,65 de lucro contra
  // R$ 312,98 de anúncio — o resultado verdadeiro era NEGATIVO, e a tela vinha
  // exibindo o número positivo.
  //
  // ⚠️ Se a Amazon algum dia postar anúncio como tarifa de pedido, o valor já
  // entra em `fees` e já saiu de `estimatedProfit`. Descontar a Ads API por cima
  // contaria o mesmo dinheiro duas vezes — daí a checagem, mesmo que hoje nenhum
  // tipo de tarifa case com o padrão.
  //
  // Com Ads conectado e SEM métrica sincronizada, o gasto é desconhecido — não
  // zero. Lucro, margem e ROI ficam "—" em vez de repetir o número otimista.
  // A MESMA leitura que a rosca e a cascata da tela usam — ver `lucroDoPeriodo`.
  // O anúncio já saiu do lucro no produtor; aqui só se lê o que foi descontado.
  const { gastoComAnuncio, desconhecido: anuncioDesconhecido, lucro: lucroReal } = lucroDoPeriodo(input);
  const anuncioJaNoExtrato = (anuncios ?? 0) > 0;

  // O DIA DE HOJE EXISTE, MAS AINDA ESTÁ SOMANDO.
  //
  // ⚠️ Aqui morava uma afirmação FALSA minha: "a Amazon publica o gasto do dia só
  // no dia seguinte". Medido em 25/08/2026 e desmentido — um relatório de hoje
  // voltou com 6 linhas, R$ 17,53 e 17 cliques.
  //
  // O que é verdade: o gasto de hoje é real e já saiu do bolso, mas cresce até a
  // meia-noite, e a VENDA atribuída a ele entra depois. Então o número aparece
  // (esconder um custo já pago seria pior) com o aviso de que o dia não fechou.
  const diaAindaSomando = input.adsJanela?.incluiHoje === true;
  const porQueSemAnuncio = diaAindaSomando
    ? "O anúncio de hoje ainda não foi contabilizado"
    : "Aguardando o gasto com anúncio do período";

  // Lucro, margem e ROI só existem se TODO componente de custo existir. Com SKU
  // sem custo cadastrado, o resultado seria otimista — e otimista sem aviso é mentira.
  const resultadoValido =
    f != null && !custoIncompleto && !semRepassePostado && !anuncioDesconhecido && lucroReal != null;
  // ═══ FATURAMENTO E MARGEM SÃO DE UNIVERSOS DIFERENTES, E A TELA DIZ QUAL ═══
  //
  // ⚠️ DECISÃO DELA, 30/08/2026: *"Faturamento deve significar todos os pedidos
  // independente de status Confirmado. Pode ser Pendente que entrará na conta.
  // Os outros softwares usam isso."* A prova que ela mandou: o Seller Central
  // marcava "Vendas R$ 1.270,13 hoje até agora" e o nosso card "Pedidos feitos"
  // mostrava exatamente R$ 1.270,13 — o número certo já estava na tela, com o
  // nome errado. Contraria a intuição de "só conta o que está confirmado; quem
  // for reverter achando defeito: NÃO É. Mercado Livre e Shopee já faziam assim;
  // a Amazon era a única fora do padrão.
  //
  // ⚠️ MAS LUCRO E MARGEM NÃO SEGUEM O FATURAMENTO, e isso é deliberado. Pedido
  // pendente na Amazon não tem valor no nosso banco (`gross` é `null`), não tem
  // item e não tem tarifa — medido em 30/08: 40 pendentes, zero itens, zero
  // tarifas. Somar essa receita sem o custo correspondente INFLARIA o lucro, que
  // é o defeito que passamos o dia inteiro removendo da tela.
  //
  // ⚠️ O PARÁGRAFO ACIMA DESCREVE O QUE VALIA ATÉ 31/08/2026. O lucro NÃO fica
  // nunca com a palavra "parcial", que explica ao vendedor uma coisa que ele já
  // sabe em vez de dizer o que falta (AGENTS.md).
  // ⚠️ QUANDO UM PERÍODO PASSADO MUDA DE VALOR, A TELA DIZ POR QUÊ.
  //
  // O estorno passou a reduzir o resultado do MÊS DA VENDA (31/08/2026), então
  // um período que ela já leu pode valer outra coisa hoje — junho caiu
  // R$ 1.877,31, julho R$ 879,49. Número que muda sozinho vira "está errado",
  // mesmo estando certo: foi o que aconteceu duas vezes em 30/08, com o anúncio
  // e com a margem.
  //
  // A frase diz O QUE mudou e QUANTO, com número, e some quando não há estorno —
  // "inclui R$ 0,00 de devolução" seria ruído, e zero aqui é fato.
  const devolucao =
    (input.refunds ?? 0) > 0
      ? `inclui ${money(input.refunds!, currency)} de ${input.refundCount ?? 0} devolução(ões), pela data da venda`
      : null;
  // ⚠️ O FALLBACK NÃO PODE CAIR NO APURADO (01/09/2026).
  //
  // Era `input.faturamentoTotal ?? f?.revenue`. Quando a Sales API falha,
  // `faturamentoTotal` vem `null` e o `??` caía em `f.revenue` — a receita
  // APURADA — exibida sob o rótulo "Faturamento", em silêncio. Medido no mesmo
  // dia: apurado R$ 12,89 contra R$ 348,07 de faturamento real. Seria a
  // definição dela voltando atrás por um caminho de exceção, que é onde ninguém
  // olha.
  //
  // A ordem agora é: o número do Seller Central; se ele falhar, a base do
  // produtor (o mesmo faturamento, calculado do banco); e só então `null` — que
  // a tela mostra como "—" com o motivo, nunca como um número de outro universo.
  const faturamentoExibido = input.faturamentoTotal ?? input.baseDoLucro ?? null;
  // ═══ UMA BASE SÓ: O FATURAMENTO (31/08/2026, decisão final dela) ═══════════
  //
  // *"fazer o cálculo em cima de tudo que é considerado faturamento (pendentes e
  // confirmados). Apenas isso."*
  //
  // ⚠️ O DENOMINADOR ERA `f.revenue` — O APURADO — E O NUMERADOR JÁ COBRIA O
  // FATURAMENTO. Essa combinação exibiu −90,5% na conta A15NQMF7A6J1Y0 em
  // 31/08/2026 (−108,82 sobre 120,19, com o lucro cobrindo R$ 456,86) e +120,9%
  // na conta AO62LVXJMX3AA no mesmo instante (34,94 sobre 28,90, cobrindo
  // 73,12). Margem acima de 100% e margem abaixo de −90% eram o MESMO defeito
  // visto pelos dois lados: dividir o resultado de um universo pela receita de
  // outro. Quem trocar de volta para `f.revenue` reintroduz os dois.
  // ═══ NÃO EXISTE MAIS BASE APURADA NESTA TELA (31/08/2026) ══════════════════
  //
  // ⚠️ ORDEM DELA, a quarta vez pedindo e a primeira em caixa alta: *"TEM QUE
  // ESQUECER O APURADO E LEVAR EM CONSIDERAÇÃO SOMENTE O FATURAMENTO."*
  //
  // A variável `baseApurada` FOI APAGADA de propósito, e não só a frase que ela
  // alimentava. Enquanto o conceito existisse aqui, bastava alguém religar o
  // `?? f?.revenue` para o defeito voltar — e ele voltou em quatro formas
  // diferentes ao longo do mesmo dia. Sem o mecanismo, não há o que religar.
  //
  // A base é o faturamento, e ela é a MESMA do card ao lado, por construção.
  // ⚠️ A BASE DA MARGEM E O NÚMERO DO CARD SÃO CAMPOS DIFERENTES, e a diferença
  // é só no ÚLTIMO recurso.
  //
  // O card não pode EXIBIR o apurado sob o rótulo "Faturamento" — seria a
  // definição dela voltando atrás por um caminho de exceção (ver
  // `faturamentoExibido`). Já a MARGEM precisa de um denominador para existir:
  // sem `baseDoLucro` nem faturamento, cair em `f.revenue` mantém o
  // comportamento anterior em vez de apagar a margem de quem não informa a base
  // nova. Numerador e denominador continuam do mesmo universo — é só o universo
  // que fica menor.
  const base = input.baseDoLucro ?? faturamentoExibido ?? f?.revenue ?? null;
  const margem =
    resultadoValido && lucroReal != null && base != null && base > 0
      ? (lucroReal / base) * 100
      : null;
  // ⚠️ A DECLARAÇÃO DE BASE MORREU AQUI, e o motivo é que ela não tem mais o que
  // declarar: lucro, margem e imposto saem do mesmo número que o card exibe.
  // Uma frase que explica uma diferença inexistente treina a pessoa a ignorar a
  // frase — e esta, especificamente, ficou quatro dias afirmando que o lucro era
  // "sobre R$ X apurados" enquanto ela pedia o contrário.
  //
  // A peça compartilhada (`baseDaMargem.ts`) CONTINUA VIVA para Shopee, ML e
  // TikTok, que ainda têm bases diferentes de verdade. Quem trouxer a frase de
  // volta para a Amazon precisa primeiro trazer de volta duas bases.
  //
  // O QUE FALTA, COM NÚMERO — nunca a palavra "parcial" (AGENTS.md). Os pedidos
  // que a Amazon ainda não valorizou ENTRAM no faturamento (o `orderMetrics` já
  // os conta) e não têm custo nem tarifa nossa. Isso NÃO encolhe a base: torna o
  // lucro otimista, e o jeito certo de tratar é DIZER isso ao lado.
  const semValor = input.pedidosSemValor ?? 0;
  const naBase = input.pedidosNaBase ?? 0;
  // ⚠️ A FRASE DIZIA A COISA ERRADA (01/09/2026). Estava "sem custo e tarifa
  // apurados", e o que falta nesses pedidos e o VALOR: a Amazon ainda nao
  // publicou preco para eles. Custo e tarifa nos ate temos — a tarifa observada
  // cobre 12 dos 13 ASINs do dia. Apontar o componente errado manda a pessoa
  // cadastrar custo que ja esta cadastrado.
  const faltaValor =
    semValor > 0
      ? `${semValor}${naBase > 0 ? ` de ${naBase}` : ""} pedido${semValor > 1 ? "s" : ""} ainda sem valor publicado pela Amazon`
      : null;
  /**
   * A MARGEM DEIXA DE SER AFIRMADA QUANDO A BASE COBRE A MINORIA (01/09/2026).
   *
   * ⚠️ O DEFEITO QUE ISTO REPROVA — a sexta forma da familia "numerador de um
   * universo, denominador de outro", medida na Silveiras Import: a tela exibia
   * Faturamento de 31 pedidos (que vem do `orderMetrics`, agregado) e afirmava
   * "Margem 91,7%" calculada sobre UM pedido, o unico que a Amazon valorizou.
   * Nenhum dos dois numeros estava errado sozinho; a afirmacao de que o segundo
   * descreve o periodo do primeiro e que era falsa.
   *
   * 📌 O CORTE E A MAIORIA, e a escolha e deliberada: um percentual so descreve
   * o periodo se cobrir mais do que omite. Nao e um limiar de tolerancia
   * escolhido a dedo — e a fronteira em que a frase "a margem do periodo" para
   * de ser verdadeira. Medido no mesmo dia: em 30 dias sao 1.625 pedidos na base
   * e a margem de 21,3% segue afirmada, porque a cobertura la e quase total; e
   * so o recorte "Hoje" que cai do lado errado da linha.
   *
   * E o numero continua na tela nos dois casos — o que sai e a AFIRMACAO, nao a
   * informacao. Quem tem 30 de 31 pedidos sem valor precisa ler isso, nao um
   * percentual que muda sozinho amanha.
   */
  const baseCobreAMinoria = naBase > 0 && semValor * 2 > naBase;
  // Quanto do total de tarifas é estimativa (ADR-027).
  //
  // ⚠️ A CONDIÇÃO É "HÁ PEDIDO ESTIMADO", NÃO "O VALOR É MAIOR QUE ZERO".
  // Medido em 31/08/2026 na conta AO62LVXJMX3AA: a Product Fees API respondeu
  // `Status: Success` com `Amount: 0` (e `FeePromotion: 0`) para os 3 pedidos do
  // dia. Com o teste em `estimadas > 0` a marca sumia — e o que a tela mostrava
  // era um lucro sem tarifa nenhuma, sem dizer que aquele zero é ESTIMATIVA que
  // a liquidação pode substituir. É o `null ≠ 0` do AGENTS.md pelo avesso:
  // aqui o zero é um fato publicado pela fonte, e um fato merece ser declarado.
  const estimadas = input.feesEstimadas ?? 0;
  const pedidosEstimados = input.pedidosComTarifaEstimada ?? 0;
  const quantoEstimado =
    pedidosEstimados > 0
      ? `inclui ${money(estimadas, currency)} de tarifa estimada pela Amazon em ${pedidosEstimados} pedido(s) — a oficial entra na liquidação`
      : null;
  /** A linha visível do card de Lucro: base quando difere, o que falta, e a devolução. */
  const notaDoLucro = [faltaValor, devolucao]
    .filter(Boolean)
    .join(" · ") || undefined;
  const roi = resultadoValido && lucroReal != null && input.cogs > 0 ? (lucroReal / input.cogs) * 100 : null;

  // Dias do período sem métrica. Não extrapolamos o que falta (AGENTS.md): o
  // lucro desconta só o anúncio JÁ contabilizado, e o card diz até quando conta.
  const faltamDias = input.ads ? diasSemAnuncio(input.ads.ateDia, input.ads.esperadoAte) : 0;
  const anuncioAte =
    faltamDias > 0 && input.ads?.ateDia
      ? `Anúncio contabilizado até ${diaBR(input.ads.ateDia)} — falta${faltamDias > 1 ? "m" : ""} ${faltamDias} dia${faltamDias > 1 ? "s" : ""}`
      : null;

  // ACOS: gasto sobre a venda que O ANÚNCIO gerou. Mede o anúncio.
  const acos = input.ads && input.ads.sales > 0 ? (input.ads.cost / input.ads.sales) * 100 : null;
  // TACOS: gasto sobre o faturamento TOTAL. Mede quanto da operação inteira o
  // anúncio consome — é o que mostra dependência de mídia, e é o número que
  // denunciou os 62% aqui.
  const tacos = input.ads && f != null && f.revenue > 0 && !semRepassePostado
    ? (input.ads.cost / f.revenue) * 100
    : null;
  const semAds =
    input.adsConectado === false
      ? "Nenhuma conta de anúncio conectada"
      : diaAindaSomando
        ? porQueSemAnuncio
        : "Aguardando sincronização do anúncio";

  const faltaCusto = custoIncompleto
    ? `Aguardando custo de ${input.unitsWithoutCost} unidade(s)`
    : "Aguardando custos dos produtos";

  return [
    {
      key: "revenue", label: "Faturamento",
      // O ultimo argumento e o que impede o card de sumir numa manha de pedidos
      // pendentes: o faturamento nao vem do extrato.
      ...num(faturamentoExibido, "Aguardando cobertura completa do período", undefined, undefined, true),
      // ⚠️ NA FACE, NAO NO "i" (31/08/2026). E o cupom que explica por que este
      // valor e MENOR que "Pedidos feitos"; escondido no tooltip, os dois cards
      // pareciam se contradizer. O Faturamento nao tem base declarada (a base
      // dele E o card), entao a linha livre e desta frase — uma por card.
      baseDeclarada: (f?.promotions ?? 0) > 0
        ? `O que o comprador pagou, já sem ${money(f?.promotions ?? 0, currency)} de cupom.`
        : undefined,
    },
    {
      key: "fees", label: "Taxas", ...num(f?.fees, semExtrato),
      // A MARCA DA ESTIMATIVA VAI NA FACE, NÃO NO "i" (ADR-027 item 5). O
      // concorrente exibe tarifa calculada sem marca nenhuma, como se fosse
      // oficial; a marca é o que nos separa dele. Some quando não há estimativa.
      baseDeclarada: quantoEstimado ?? undefined,
      // O selo acompanha a MESMA condicao da frase — os dois nascem e somem
      // juntos. Separa-los criaria o estado em que o numero esta marcado e nada
      // explica a marca, ou o inverso.
      marcaEstimativa: quantoEstimado ? PROCEDENCIA_DO_AGREGADO : undefined,
    },
    { key: "fbaShipping", label: "Logística FBA", ...num(logistica, "Aguardando tarifas de logística no extrato", undefined, "A Amazon não cobrou logística no período") },
    { key: "buyerShipping", label: "Frete do comprador", ...num(f?.buyerShipping, "Aguardando frete pago pelo comprador", undefined, "Nenhum frete pago pelo comprador") },
    // Fonte é a Ads API, NÃO o extrato — anúncio não é tarifa de pedido.
    // Antes de 25/08/2026 este card lia `feeBreakdown` com o padrão
    // /advertis|productads/, que nunca casou com nada: exibia "R$ 0,00 · Nenhuma
    // despesa com anúncios no período" numa conta gastando R$ 312,98.
    {
      key: "ads", label: "Ads",
      ...(anuncioJaNoExtrato
        ? { value: money(anuncios ?? 0, currency), context: "Postado como tarifa no extrato", raw: anuncios }
        : input.ads == null
          ? { value: "—", context: semAds, raw: null }
          : {
              value: money(input.ads.cost, currency),
              context:
                anuncioAte ??
                (diaAindaSomando
                  ? "Hoje ainda está somando — o valor sobe até a meia-noite"
                  : `${input.ads.purchases} venda(s) atribuída(s) ao anúncio`),
              tone: "danger" as const,
              raw: input.ads.cost,
            }),
    },
    // Ocupa a vaga do antigo "Impostos retidos" (`MarketplaceFacilitatorTax`), que
    // é mecanismo de EUA/Europa e nunca apareceu numa conta BR. A comissão, ao
    // contrário, é a maior tarifa da Amazon para quase todo vendedor — e não
    // tinha card nenhum. Hoje sai R$ 0,00 aqui pela promoção de vendedor novo.
    { key: "commission", label: "Comissão", ...num(comissao, "Aguardando comissão no extrato", undefined, "A Amazon não cobrou comissão no período") },
    { key: "refunds", label: "Estornos", ...num(f?.refunds, semExtrato, undefined, "Nenhum estorno no período") },
    {
      key: "tax", label: "Impostos",
      // Diferente dos demais: não é dado que a Amazon manda, é alíquota que a
      // vendedora declara — a Amazon não conhece o regime tributário dela.
      // Configurada, o card mostra o VALOR do período (o que importa no bolso) e
      // a alíquota como contexto.
      ...(input.taxRate == null
        ? { value: "—", context: "Configure a alíquota na calculadora", raw: null }
        : {
            value: money(input.taxes ?? 0, currency),
            context: `${percent(input.taxRate)} sobre o faturamento`,
            raw: input.taxes ?? 0,
          }),
    },
    {
      key: "cogs", label: "Custo dos produtos",
      // Sem período conciliado não há como afirmar custo zero: "não houve venda" e
      // "ainda não sei o que foi vendido" dariam o mesmo R$ 0,00 na tela.
      // ⚠️ `semRepassePostado` SAIU DAQUI (01/09/2026): o custo e CADASTRO DELA,
      // nao extrato da Amazon. Apagar um numero que ela mesma preencheu porque a
      // Amazon nao liquidou e esconder o trabalho dela — e era o que a tela
      // fazia numa manha inteira de pedidos pendentes.
      ...(f == null || custoIncompleto
        ? { value: "—", context: faltaCusto }
        : num(input.cogs, faltaCusto, undefined, undefined, true)),
    },
    {
      key: "profit", label: "Lucro",
      ...(resultadoValido && lucroReal != null
        // Sem alíquota o lucro sai SEM imposto — e precisa dizer, senão parece
        // líquido de tudo e a pessoa decide preço com um número otimista.
        // Idem para anúncio: a composição fica escrita, componente por componente.
        ? {
            value: money(lucroReal, currency),
            // Sem alíquota o lucro sai SEM imposto e o rótulo diz isso — não
            // bloqueia mais (decisão dela em 26/08/2026). O que continua
            // bloqueando é dado do canal: repasse não postado, custo sem
            // cadastro, anúncio desconhecido.
            context:
              anuncioAte ??
              comSemImposto([
                "Faturamento − taxas − custo",
                input.taxRate == null ? null : "imposto",
                (gastoComAnuncio ?? 0) > 0 ? "anúncio" : null,
              ]
                .filter(Boolean)
                .join(" − "), input.taxRate == null),
            tone: lucroReal > 0 ? "positive" as const : lucroReal < 0 ? "danger" as const : "default" as const,
            raw: lucroReal,
            baseDeclarada: notaDoLucro,
          }
        : {
            value: "—",
            context: semRepassePostado
              ? semExtrato
              : custoIncompleto
                ? faltaCusto
                : anuncioDesconhecido
                  ? porQueSemAnuncio
                  : "Aguardando todos os componentes financeiros",
            raw: null,
          }),
    },
    {
      key: "marginPct", label: "Margem",
      value: margem == null || baseCobreAMinoria ? "—" : percent(margem),
      context: margem == null || baseCobreAMinoria
        ? (baseCobreAMinoria
            ? faltaValor!
            : custoIncompleto ? faltaCusto : "Aguardando receita e lucro completos")
        // A divergencia deste cartao ja e declarada em `baseDeclarada` logo
        // abaixo, entao aqui a peca so NOMEIA — e o prefixo guarda a palavra
        // "Lucro", sem a qual a frase fica ambigua sobre QUAL numero declara.
        : comSemImposto(
            nomeDaBase({ prefixo: "Lucro", rotuloDaBase: "o faturamento do período" }),
            input.taxRate == null,
          ),
      tone: margem == null || baseCobreAMinoria
        ? "default"
        : margem > 0 ? "positive" : margem < 0 ? "danger" : "default",
      // `raw` continua com o numero: quem consome o dado bruto (export, teste,
      // grafico) recebe o que foi calculado. O que a tela para de fazer e
      // AFIRMAR que ele descreve o periodo.
      raw: baseCobreAMinoria ? null : margem,
      baseDeclarada: notaDoLucro,
    },
    {
      key: "roiPct", label: "ROI",
      value: roi == null ? "—" : percent(roi),
      context: roi == null ? (custoIncompleto ? faltaCusto : "Aguardando lucro e custo completos") : comSemImposto("Lucro sobre o custo investido", input.taxRate == null),
      tone: roi == null ? "default" : roi > 0 ? "positive" : roi < 0 ? "danger" : "default",
      raw: roi,
    },
    {
      key: "acos", label: "ACOS",
      // Gasto ÷ venda gerada PELO anúncio. Mede o anúncio, não a operação.
      // Sem venda atribuída não é 0% nem 100%: é indefinido — dividir por zero
      // aqui já seria Infinity, e exibir "0,0%" diria que o anúncio saiu de graça.
      value: acos == null ? "—" : percent(acos),
      context:
        acos == null
          ? input.ads == null
            ? semAds
            : diaAindaSomando
              ? "A venda atribuída ao clique de hoje entra depois"
              : "Nenhuma venda atribuída ao anúncio ainda"
          : `Gasto sobre ${money(input.ads?.sales ?? 0, currency)} gerados pelo anúncio`,
      tone: acos == null ? "default" : acos <= 25 ? "positive" : acos >= 50 ? "danger" : "default",
      raw: acos,
    },
    {
      key: "tacos", label: "TACOS",
      // Gasto ÷ faturamento TOTAL. É o que mostra dependência de mídia: ACOS
      // pode estar ótimo enquanto o anúncio come a operação inteira.
      value: tacos == null ? "—" : percent(tacos),
      context:
        tacos == null
          ? input.ads == null
            ? semAds
            : semRepassePostado
              ? semExtrato
              : "Aguardando faturamento do período"
          : "Gasto com anúncio sobre o faturamento total",
      tone: tacos == null ? "default" : tacos <= 10 ? "positive" : tacos >= 20 ? "danger" : "default",
      raw: tacos,
    },
  ];
}
