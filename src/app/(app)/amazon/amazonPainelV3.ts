/**
 * A primeira viewport da Amazon no padrão **v3** — o mesmo `PainelV3` do
 * Mercado Livre, alimentado pelo que a Amazon entrega.
 *
 * ⚠️ ISTO É UM MAPEADOR, E DE PROPÓSITO: nenhuma conta nova
 * acontece aqui. Cada coluna lê o MESMO campo do produtor que o cartão
 * correspondente já exibia, porque o critério de aceite desta leva é o diff de
 * números ao centavo — trocar de layout não pode trocar um valor. Módulo puro
 * para que isso seja exercitável por teste, com dados fabricados dos dois lados
 * de cada fronteira, em vez de conferido no olho.
 *
 * ## A regra de ouro aplicada
 *
 * Replicar entre canais é replicar a **garantia**, nunca o mecanismo. As três
 * diferenças que o ML não tem e que mudam a faixa:
 *
 * 1. **ANÚNCIO ENTRA NO LUCRO** (decisão dela, 25/08/2026: *"o card de lucro
 *    passa a descontar também o ads, isso é lucro real"* — o dado que motivou
 *    foi R$ 295,65 de lucro contra R$ 312,98 de anúncio, resultado verdadeiro
 *    NEGATIVO). No ML ele não entra (30/08): lá o seller desconta no
 *    fechamento dele. Por isso a Amazon tem uma coluna a mais, entre custo e
 *    lucro — sem ela o lucro apareceria maior do que é.
 * 2. **A LOGÍSTICA É TARIFA, NÃO FRETE PAGO.** No ML "Frete que você paga" sai
 *    do bolso da vendedora; no FBA a logística é uma tarifa da Amazon, e existe
 *    ainda o frete do COMPRADOR, que é outra coisa. Coluna própria para a
 *    logística; o frete do comprador fica na dica, onde não se confunde com
 *    custo.
 * 3. **TARIFA ESTIMADA (ADR-027).** A Amazon publica tarifa tarde, então parte
 *    de `fees` pode ser estimativa da tabela oficial. Isso é **rastro**, não
 *    parcela — ver a nota em `colunaDeTaxas`.
 */

import type { DadosV3 } from "../../components/PainelV3";

/** O que o produtor da Amazon entrega e esta faixa consome. */
export interface EntradaDaFaixaAmazon {
  moeda: string;
  faturamento: number;
  pedidosPagos: number;
  /** Tarifas do período. ⚠️ `estimadas` é PARTE deste número — ver `colunaDeTaxas`. */
  tarifas: number | null;
  tarifasEstimadas?: number | null;
  pedidosComTarifaEstimada?: number | null;
  /** Logística FBA, quando a Amazon já postou. `null` = ainda não postou. */
  logisticaFba: number | null;
  /** Frete pago pelo COMPRADOR — não é custo dela; vai para a dica. */
  freteDoComprador?: number | null;
  comissao?: number | null;
  estornos?: number | null;
  custoDosProdutos: number | null;
  /** Gasto com anúncio que ENTRA no lucro. `null` = desconhecido. */
  anuncio: number | null;
  /** `null` = alíquota não cadastrada (ADR-038: a conta usa zero, com rastro). */
  aliquota?: number | null;
  imposto?: number | null;
  lucro: number | null;
  margemPct: number | null;
  /**
   * A base do lucro quando ela difere do faturamento exibido ao lado.
   * ⚠️ Vem pronta do produtor e vai para a linha VISÍVEL da margem, nunca para
   * a dica: declaração que exige hover não declara (lição de 31/08/2026).
   */
  baseDoResultado?: string | null;
  /** O que falta para o número fechar, já com número e destino. */
  faltas?: string[];
  /**
   * A legenda do faturamento, quando ela tem o que dizer.
   *
   * ⚠️ ELA SOBREVIVEU A TROCA DE PECA DE PROPOSITO. Era o
   * `info` do cartao de Faturamento e resolvia uma contradicao real medida em
   * 22/08/2026: "R$ 0,00 · 1 pedido" na mesma linha. Quando ha pedido sem
   * valor, o texto DIZ isso em vez de fingir coerencia — e uma frase que a
   * substituicao teria levado junto sem ninguem notar.
   */
  dicaDoFaturamento?: string;
}

const dinheiro = (valor: number, moeda: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(valor);

/** Percentual sobre a venda, com a MESMA base da coluna "Você vendeu". */
function sobreAVenda(parte: number | null | undefined, base: number, moeda: string): string {
  void moeda;
  if (parte == null || !Number.isFinite(parte)) return "";
  if (!base || !Number.isFinite(base)) return "";
  return ((parte / base) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "% da venda";
}

/**
 * A coluna de Taxas — onde mora a armadilha mais cara desta leva.
 *
 * ⚠️ `tarifasEstimadas` É PARTE DE `tarifas`, NUNCA UMA PARCELA A
 * SOMAR. O produtor calcula as duas no MESMO `WHERE`, com `FILTER`: o total é
 * a soma de todas as linhas de tarifa, e a estimada é o subconjunto com
 * `basis = 'estimated'`. Somar as duas contaria a estimativa DUAS VEZES, e o
 * número ficaria maior que a tarifa real sem nada ficar vermelho — a tela
 * apenas mostraria um custo inflado e a margem espremida.
 *
 * O lugar da estimativa é o RASTRO: a linha sob o número diz quanto do total
 * ainda é estimativa, e ela some sozinha quando a Amazon posta a tarifa real
 * (ADR-027).
 */
export function colunaDeTaxas(entrada: EntradaDaFaixaAmazon) {
  const { tarifas, tarifasEstimadas, pedidosComTarifaEstimada, moeda, faturamento } = entrada;
  const estimada = tarifasEstimadas ?? 0;
  const temEstimativa = estimada > 0;
  return {
    id: "taxas",
    rotulo: "Taxas da Amazon",
    valor: tarifas == null ? "—" : dinheiro(tarifas, moeda),
    bruto: tarifas,
    formatar: (v: number) => dinheiro(v, moeda),
    // O rastro ganha da porcentagem quando existe: "quanto disso ainda é
    // estimativa" é a pergunta que a pessoa faz olhando este número.
    share: temEstimativa
      ? `inclui ${dinheiro(estimada, moeda)} estimados${pedidosComTarifaEstimada ? ` em ${pedidosComTarifaEstimada} pedido(s)` : ""}`
      : sobreAVenda(tarifas, faturamento, moeda),
    tom: (tarifas == null ? "vazio" : "normal") as "vazio" | "normal",
    dica: [
      "Comissão, logística e estornos somados.",
      entrada.comissao != null ? `Comissão ${dinheiro(entrada.comissao, moeda)}.` : null,
      entrada.estornos != null && entrada.estornos !== 0 ? `Estornos ${dinheiro(entrada.estornos, moeda)}.` : null,
      entrada.freteDoComprador != null && entrada.freteDoComprador !== 0
        ? `O comprador pagou ${dinheiro(entrada.freteDoComprador, moeda)} de frete — não é custo seu e não entra nesta conta.`
        : null,
      temEstimativa ? "A parte estimada vem da tabela da Amazon e é substituída na liquidação." : null,
    ].filter(Boolean).join(" "),
  };
}

/**
 * As sete colunas mais a margem — a faixa de 8 que a dona do produto aprovou
 * em 12/09/2026.
 */
export function colunasDoPeriodoAmazon(entrada: EntradaDaFaixaAmazon): DadosV3["colunas"] {
  const { moeda, faturamento } = entrada;
  const valorOuTraco = (valor: number | null | undefined) =>
    valor == null ? "—" : dinheiro(valor, moeda);
  const tomDe = (valor: number | null | undefined) => (valor == null ? "vazio" : "normal") as "vazio" | "normal";
  /**
   * ⚠️ O EFEITO DE TROCA DE NUMERO VALE AQUI TAMBEM (ordem dela,
   * 12/09/2026). A peca so anima quando recebe o valor CRU — travessao nao
   * rola, e por isso `bruto` e `null` quando o numero e desconhecido: o efeito
   * nunca pode transformar ausencia em contagem a partir do zero, que pareceria
   * "caiu para zero".
   */
  const formatar = (v: number) => dinheiro(v, moeda);

  return [
    {
      id: "vendeu",
      rotulo: "Você vendeu",
      valor: dinheiro(faturamento, moeda),
      bruto: faturamento,
      formatar,
      share: `${entrada.pedidosPagos.toLocaleString("pt-BR")} pedidos pagos`,
      dica: entrada.dicaDoFaturamento
        || "Faturamento do período pela data do pedido. Cancelados ficam fora.",
    },
    colunaDeTaxas(entrada),
    {
      id: "logistica",
      rotulo: "Logística FBA",
      valor: valorOuTraco(entrada.logisticaFba),
      bruto: entrada.logisticaFba,
      formatar,
      share: entrada.logisticaFba == null
        ? "aguardando o extrato da Amazon"
        : sobreAVenda(entrada.logisticaFba, faturamento, moeda),
      tom: tomDe(entrada.logisticaFba),
      dica: "O que a Amazon cobra para armazenar e enviar. É tarifa dela, não frete que você paga.",
    },
    {
      id: "custo",
      rotulo: "Custo dos produtos",
      valor: valorOuTraco(entrada.custoDosProdutos),
      bruto: entrada.custoDosProdutos,
      formatar,
      share: sobreAVenda(entrada.custoDosProdutos, faturamento, moeda),
      tom: tomDe(entrada.custoDosProdutos),
      dica: "Custo cadastrado por SKU na data do pedido.",
    },
    {
      /**
       * ⚠️ ESTA COLUNA É A DIFERENÇA ENTRE OS DOIS CANAIS, e
       * existir aqui não é simetria com o ML — é o contrário dela. No ML o
       * anúncio fica FORA da conta do lucro; aqui ele entra, por decisão dela
       * de 25/08/2026, porque na Amazon o gasto é cobrado no mesmo extrato.
       */
      id: "anuncio",
      rotulo: "Anúncios",
      valor: valorOuTraco(entrada.anuncio),
      bruto: entrada.anuncio,
      formatar,
      share: entrada.anuncio == null
        ? "gasto ainda não informado"
        : sobreAVenda(entrada.anuncio, faturamento, moeda),
      tom: tomDe(entrada.anuncio),
      dica: "Entra no lucro: na Amazon o anúncio é cobrado no mesmo extrato da venda.",
    },
    {
      id: "imposto",
      rotulo: "Impostos",
      // ADR-038: alíquota não cadastrada vale ZERO na conta, e o rastro fica na
      // linha de baixo. Travessão aqui diria "não sei", e a conta sabe.
      valor: entrada.aliquota == null ? "—" : valorOuTraco(entrada.imposto ?? 0),
      bruto: entrada.aliquota == null ? null : entrada.imposto ?? 0,
      formatar,
      share: entrada.aliquota == null
        ? "alíquota não configurada"
        // Vírgula, não ponto: `${8.5}` sai "8.5%" e a tela mistura duas
        // convenções de número na mesma linha. Pego pelo teste, não no olho.
        : `alíquota de ${entrada.aliquota.toLocaleString("pt-BR")}%`,
      tom: (entrada.aliquota == null ? "vazio" : "normal") as "vazio" | "normal",
      dica: "Percentual que você cadastrou, aplicado sobre o faturamento do período.",
    },
    {
      id: "lucro",
      rotulo: "Lucro",
      valor: valorOuTraco(entrada.lucro),
      bruto: entrada.lucro,
      formatar,
      share: "",
      // Verde só quando há lucro E ele é positivo; prejuízo é vermelho. Cor é
      // estado — a mesma regra que o ML corrigiu em 11/09/2026.
      tom: (entrada.lucro == null
        ? "vazio"
        : entrada.lucro < 0
          ? "negativo"
          : "positivo") as "vazio" | "negativo" | "positivo",
      dica: "Faturamento menos taxas, logística, custo, anúncio e imposto.",
    },
  ];
}

/** A oitava coluna: a margem, com a base declarada na linha visível. */
export function margemDoPeriodoAmazon(entrada: EntradaDaFaixaAmazon): DadosV3["margem"] {
  const faltando = entrada.faltas ?? [];
  return {
    valor: entrada.margemPct == null
      ? "—"
      : entrada.margemPct.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%",
    tom: (entrada.margemPct == null ? "vazio" : entrada.margemPct < 0 ? "negativo" : "positivo") as
      "vazio" | "negativo" | "positivo",
    /**
     * ⚠️ NUNCA VAZIA QUANDO HÁ PENDÊNCIA, e nunca escondida
     * atrás de hover. É a regra que o ML quebrou na troca de layout e que
     * custou a Margem aparecer sozinha por dois dias: número que depende de
     * dado faltando não pode parecer completo.
     */
    nota: faltando.length > 0
      ? `falta ${faltando.join(", ")}`
      : entrada.baseDoResultado ?? "",
  };
}

/**
 * Monta a entrada da faixa A PARTIR DOS CARTOES que a tela já exibia.
 *
 * ⚠️ E ESTA E A GARANTIA DO DIFF DE NUMEROS, nao um atalho de
 * codigo. O criterio de aceite desta leva e "mudou pixel, nao valor": lendo o
 * `raw` do cartao correspondente, cada coluna mostra LITERALMENTE o numero que
 * o cartao mostrava — nao um re-calculo a partir do mesmo campo, que poderia
 * divergir no dia em que alguem mudasse o cartao e esquecesse a faixa.
 *
 * Os cartoes que NAO viram coluna (comissao, estorno, frete do comprador)
 * entram na dica da coluna de taxas. `ROI`, `ACOS` e `TACOS` ficam fora: sao
 * medida de anuncio, e o lugar deles e o bloco de Anuncios.
 */
export function entradaDaFaixaDosCards(
  cards: Array<{ key: string; raw?: number | null }>,
  extras: {
    moeda: string;
    pedidosPagos: number;
    tarifasEstimadas?: number | null;
    pedidosComTarifaEstimada?: number | null;
    aliquota?: number | null;
    baseDoResultado?: string | null;
    faltas?: string[];
    dicaDoFaturamento?: string;
  },
): EntradaDaFaixaAmazon {
  const bruto = (key: string): number | null => {
    const card = cards.find((c) => c.key === key);
    return card?.raw ?? null;
  };
  return {
    moeda: extras.moeda,
    pedidosPagos: extras.pedidosPagos,
    faturamento: bruto("revenue") ?? 0,
    tarifas: bruto("fees"),
    tarifasEstimadas: extras.tarifasEstimadas ?? null,
    pedidosComTarifaEstimada: extras.pedidosComTarifaEstimada ?? null,
    logisticaFba: bruto("fbaShipping"),
    freteDoComprador: bruto("buyerShipping"),
    comissao: bruto("commission"),
    estornos: bruto("refunds"),
    custoDosProdutos: bruto("cogs"),
    anuncio: bruto("ads"),
    aliquota: extras.aliquota ?? null,
    imposto: bruto("tax"),
    lucro: bruto("profit"),
    margemPct: bruto("marginPct"),
    baseDoResultado: extras.baseDoResultado ?? null,
    faltas: extras.faltas,
    dicaDoFaturamento: extras.dicaDoFaturamento,
  };
}

/* ── O painel inteiro: a Amazon no esqueleto do Mercado Livre ─────────────────
   Ordem dela em 12/09/2026, verbatim: *"cara, e replicar a mesma estrutura do
   mercado livre na amazon"*. Não é entrega incremental: a tela passa a ter a
   MESMA sequência — faixa, Top 8 + Ritmo lado a lado, o que falta para o número
   fechar, e os pedidos. O que o canal tem de diferente entra como DADO, não
   como estrutura própria.
   ─────────────────────────────────────────────────────────────────────────── */

export interface ProdutoDoTopAmazon {
  sku: string;
  /** ⚠️ Pode faltar: a Amazon as vezes devolve SKU sem titulo, e ai a linha mostra o SKU. */
  title?: string;
  units: number;
  revenue: number;
  marginPct: number | null;
}

export interface DiaDaSerieAmazon {
  date: string;
  revenue: number;
  orders: number;
  units: number;
  /** `null` = dia não apurável — fica só com o contorno e não entra na média. */
  profit: number | null;
  /** A tarifa daquele dia inclui estimativa (ADR-027). */
  profitEstimated?: boolean;
  /** Estorno POSTADO no dia — explica barra derrubada por venda antiga. */
  refunds?: number;
}

/**
 * O Top N produtos.
 *
 * ⚠️ A CONTRIBUIÇÃO SAI COMO TRAVESSÃO, e isso é fidelidade ao
 * que a Amazon entrega: o produtor do ML manda contribuição por produto e o da
 * Amazon não. Preencher com o faturamento, ou com zero, seria inventar — e a
 * coluna existe justamente para dizer quanto sobrou. Travessão diz "não sei",
 * que é a verdade.
 */
export function produtosDoTopAmazon(
  produtos: ProdutoDoTopAmazon[],
  moeda: string,
): Array<{ id: string; posicao: number; titulo: string; sku: string | null; unidades: string; faturamento: string; fracao: number; contribuicao: string; margemPct: number | null }> {
  const maior = produtos.reduce((topo, p) => Math.max(topo, p.revenue), 0);
  return produtos.slice(0, 8).map((p, i) => ({
    id: p.sku || String(i),
    posicao: i + 1,
    titulo: p.title || p.sku,
    sku: p.sku || null,
    unidades: `${p.units.toLocaleString("pt-BR")} un`,
    faturamento: dinheiro(p.revenue, moeda),
    fracao: maior > 0 ? p.revenue / maior : 0,
    contribuicao: "—",
    margemPct: p.marginPct,
  }));
}

/**
 * Os dias do ritmo.
 *
 * ⚠️ TRES FATOS DA AMAZON QUE O ML NAO TEM, medidos pelo backend
 * na conta real em 12/09/2026 — e os três quebram a suposição de que o lucro
 * cabe dentro da barra de receita:
 *
 *   1. dia SEM VENDA com gasto de anúncio dá lucro NEGATIVO (05/09: −17,18).
 *      "Gastou sem vender" é situação real aqui, porque o anúncio entra no
 *      lucro deste canal;
 *   2. dia com barra de receita ZERO e lucro POSITIVO (07–10/09): pedido
 *      pendente valorizado por tabela entra no lucro e não na receita, que só
 *      conta pago;
 *   3. pelo mesmo motivo o lucro pode EXCEDER a receita da barra (06/09: barra
 *      21,90, lucro 22,68).
 *
 * A decisão (cérebro, 12/09) foi manter a FORMA do ML e adaptar o mínimo: o dia
 * negativo desce abaixo do eixo, e a dica explica quando o lucro vem de pedido
 * ainda não pago. Nada de forma nova — ela refina depois, vendo.
 */
export function diasDoRitmoAmazon(
  serie: DiaDaSerieAmazon[],
  { metrica, moeda, hoje, diaDaSemana }: { metrica: string; moeda: string; hoje: string; diaDaSemana: (data: string) => string },
): Array<{ id: string; dia: string; total: number; lucro: number | null; rotuloTotal: string; rotuloLucro: string | null; destaque?: boolean; dica?: string }> {
  const ultimo = serie[serie.length - 1]?.date;
  return serie.map((d) => {
    const total = metrica === "Faturamento" ? d.revenue : metrica === "Pedidos" ? d.orders : d.units;
    const excedeAReceita = d.profit != null && d.profit > 0 && d.profit > d.revenue;
    return {
      id: d.date,
      dia: d.date === hoje ? "hoje" : diaDaSemana(d.date),
      total,
      lucro: d.profit,
      rotuloTotal: metrica === "Faturamento"
        ? dinheiro(d.revenue, moeda)
        : total.toLocaleString("pt-BR") + (metrica === "Pedidos" ? " ped." : " un."),
      rotuloLucro: d.profit == null ? null : dinheiro(d.profit, moeda),
      destaque: d.date === ultimo,
      dica: [
        d.profitEstimated ? "Inclui tarifa estimada, substituída na liquidação." : null,
        excedeAReceita ? "O lucro passa da barra porque há pedido já valorizado que ainda não foi pago — a barra conta só o pago." : null,
        d.refunds ? `Inclui ${dinheiro(d.refunds, moeda)} de estorno lançado neste dia, de venda anterior.` : null,
      ].filter(Boolean).join(" ") || undefined,
    };
  });
}
