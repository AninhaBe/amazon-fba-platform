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

  return [
    {
      id: "vendeu",
      rotulo: "Você vendeu",
      valor: dinheiro(faturamento, moeda),
      share: `${entrada.pedidosPagos.toLocaleString("pt-BR")} pedidos pagos`,
      dica: "Faturamento do período pela data do pedido. Cancelados ficam fora.",
    },
    colunaDeTaxas(entrada),
    {
      id: "logistica",
      rotulo: "Logística FBA",
      valor: valorOuTraco(entrada.logisticaFba),
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
