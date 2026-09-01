/**
 * A TARIFA DE LOGÍSTICA FBA DA AMAZON BRASIL — regra publicada pela Amazon.
 *
 * **Fonte:** https://sellercentral.amazon.com.br/help/hub/reference/201112670?locale=pt-BR
 * (Seller Central → "Tarifas de logística do FBA para pedidos da Amazon"; exige
 * login de vendedor).
 * **Capturada em:** 01/09/2026.
 *
 * ⚠️ Como a tabela de comissão, esta é uma **cópia com data**, não autoridade
 * própria. A Amazon muda sem aviso — quem revisar deve abrir a página, comparar,
 * e **atualizar a data mesmo que nada mude**, porque data velha é o único sinal
 * de que ninguém conferiu.
 *
 * 📌 **A PROMOÇÃO VIGENTE É A RAZÃO DE `observada > tabela` IMPORTAR AQUI.**
 * Desde 01/08/2026, renovável até 31/01/2027: isenção total de logística nos
 * primeiros 30 dias para vendedor FBA novo, e depois tarifa fixa para preço
 * ≥ R$ 79 com investimento em Ads. Ou seja, a tarifa REAL da conta pode ser
 * menor que esta tabela — até zero. Estimar por tabela onde há observação seria
 * inventar um custo que a vendedora não paga.
 */

/** Faixas de preço da matriz, em ordem. `ate: null` = a última, sem teto. */
const FAIXAS_DE_PRECO: Array<{ ate: number | null }> = [
  { ate: 99.99 },   // 79 – 99,99
  { ate: 119.99 },
  { ate: 149.99 },
  { ate: 199.99 },
  { ate: null },    // > 200
];

/**
 * Abaixo de R$ 79 a tarifa é FIXA POR FAIXA DE PREÇO e **independe do peso** —
 * é uma célula mesclada na tabela original. É onde cai a maior parte do catálogo
 * da conta, e é por isso que peso e dimensão ainda não são necessários para
 * estimar quase tudo.
 */
const ABAIXO_DE_79: Array<{ ate: number; tarifa: number }> = [
  { ate: 29.99, tarifa: 5.65 },
  { ate: 49.99, tarifa: 5.85 },
  { ate: 78.99, tarifa: 6.05 },
];

/** Cada linha: teto de peso em GRAMAS e a tarifa por faixa de preço. */
const MATRIZ: Array<{ ateGramas: number; tarifas: number[] }> = [
  { ateGramas: 100, tarifas: [10.05, 12.05, 14.05, 15.05, 15.55] },
  { ateGramas: 200, tarifas: [10.45, 12.45, 14.45, 15.45, 16.05] },
  { ateGramas: 300, tarifas: [10.95, 12.95, 14.95, 15.95, 16.55] },
  { ateGramas: 400, tarifas: [11.45, 13.45, 15.45, 16.95, 17.15] },
  { ateGramas: 500, tarifas: [11.95, 13.95, 15.95, 17.05, 17.85] },
  { ateGramas: 750, tarifas: [12.05, 14.05, 16.05, 18.45, 18.55] },
  { ateGramas: 1_000, tarifas: [12.45, 14.45, 16.45, 19.05, 19.25] },
  { ateGramas: 1_500, tarifas: [12.95, 14.95, 16.95, 19.45, 20.35] },
  { ateGramas: 2_000, tarifas: [13.05, 15.05, 17.05, 19.95, 21.35] },
  { ateGramas: 3_000, tarifas: [14.05, 16.05, 18.05, 20.05, 22.35] },
  { ateGramas: 4_000, tarifas: [15.05, 17.05, 19.05, 21.95, 23.35] },
  { ateGramas: 5_000, tarifas: [16.05, 18.05, 20.05, 22.95, 24.35] },
  { ateGramas: 6_000, tarifas: [24.05, 27.05, 29.05, 30.05, 30.35] },
  { ateGramas: 7_000, tarifas: [25.05, 28.05, 30.05, 31.05, 33.35] },
  { ateGramas: 8_000, tarifas: [26.05, 29.05, 31.05, 32.05, 35.35] },
  { ateGramas: 9_000, tarifas: [27.05, 30.05, 32.05, 33.05, 37.35] },
  { ateGramas: 10_000, tarifas: [35.05, 40.05, 46.05, 51.05, 51.35] },
];

/** Acima de 10 kg, por quilo adicional, na mesma ordem das faixas de preço. */
const KG_ADICIONAL = [3.05, 3.05, 3.05, 3.50, 3.50];

/** Embalagem padronizada pela Amazon, somada ao peso para efeito de tarifa. */
const EMBALAGEM_GRAMAS = 20;

export interface DimensoesDoProduto {
  /** Peso do produto em gramas, sem embalagem. */
  pesoGramas?: number | null;
  /** Em centímetros. As três precisam existir para o peso dimensional valer. */
  comprimentoCm?: number | null;
  larguraCm?: number | null;
  alturaCm?: number | null;
}

/**
 * O PESO PARA TARIFA: o maior entre o peso real e o dimensional, mais 20 g.
 *
 * O dimensional é `C × L × A ÷ 6.000` (regra IATA), em quilos — convertido para
 * gramas aqui. `null` quando não há nem peso nem as três dimensões: sem isso não
 * dá para escolher a linha da matriz, e escolher a primeira seria subestimar
 * todo produto pesado.
 */
export function pesoParaTarifa(dim: DimensoesDoProduto): number | null {
  const real = dim.pesoGramas != null && dim.pesoGramas > 0 ? dim.pesoGramas : null;
  const temTodasAsDimensoes =
    dim.comprimentoCm != null && dim.larguraCm != null && dim.alturaCm != null
    && dim.comprimentoCm > 0 && dim.larguraCm > 0 && dim.alturaCm > 0;
  const dimensional = temTodasAsDimensoes
    ? (dim.comprimentoCm! * dim.larguraCm! * dim.alturaCm! / 6_000) * 1_000
    : null;
  if (real == null && dimensional == null) return null;
  return Math.max(real ?? 0, dimensional ?? 0) + EMBALAGEM_GRAMAS;
}

const indiceDaFaixaDePreco = (preco: number): number => {
  const i = FAIXAS_DE_PRECO.findIndex((f) => f.ate == null || preco <= f.ate);
  return i === -1 ? FAIXAS_DE_PRECO.length - 1 : i;
};

export interface TarifaFbaEstimada {
  valor: number;
  /** Como o número foi obtido, para a procedência na tela. */
  regra: "faixa-de-preco" | "matriz-peso-preco" | "matriz-mais-kg-adicional";
  /** O peso usado, em gramas, quando a matriz entrou. */
  pesoGramas?: number;
}

/**
 * A tarifa FBA de UMA unidade.
 *
 * `null` quando falta o que decide:
 *  - **sem preço** — é o caso do pedido pendente. Note que mesmo abaixo de R$ 79
 *    a FAIXA depende do preço (5,65 / 5,85 / 6,05), então não há atalho: sem
 *    preço não há tarifa por tabela, nem para produto barato;
 *  - **preço ≥ R$ 79 e sem peso nem dimensões** — a matriz precisa de uma linha,
 *    e a primeira linha seria uma escolha nossa disfarçada de dado.
 */
export function tarifaFbaPelaTabela(
  precoUnitario: number | null,
  dimensoes: DimensoesDoProduto = {},
): TarifaFbaEstimada | null {
  if (precoUnitario == null || precoUnitario <= 0) return null;

  if (precoUnitario < 79) {
    const faixa = ABAIXO_DE_79.find((f) => precoUnitario <= f.ate) ?? ABAIXO_DE_79[ABAIXO_DE_79.length - 1];
    return { valor: faixa.tarifa, regra: "faixa-de-preco" };
  }

  const peso = pesoParaTarifa(dimensoes);
  if (peso == null) return null;

  const coluna = indiceDaFaixaDePreco(precoUnitario);
  const linha = MATRIZ.find((l) => peso <= l.ateGramas);
  if (linha) {
    return { valor: linha.tarifas[coluna], regra: "matriz-peso-preco", pesoGramas: peso };
  }

  /**
   * ⚠️ ACIMA DE 10 kg — E AQUI ESTÃO AS DUAS AMBIGUIDADES DA PRÓPRIA PÁGINA,
   * registradas em `docs/tarifas-amazon-br.md` §2.2 e implementadas na LEITURA
   * LITERAL DA MATRIZ, por decisão:
   *
   * 1. a página diz "total arredondado para cima para o quilograma inteiro mais
   *    próximo", o que contradiz as faixas sub-quilo da própria tabela (0–100 g,
   *    100–200 g…). Se o arredondamento valesse, aquelas linhas não existiriam;
   * 2. o exemplo 3 da página (12,62 kg, faixa 150–199,99) resulta em **R$ 61,85**
   *    lá, enquanto a matriz lida ao pé da letra dá `51,05 + 3 × 3,50 = R$ 61,55`.
   *    Trinta centavos de diferença que ninguém explica.
   *
   * Implemento o literal porque é o que a tabela DIZ, e a divergência fica
   * escrita aqui em vez de escondida atrás de um número redondo. E a ordem
   * `observada > tabela` corrige na prática: no dia em que a conta vender um
   * produto acima de 10 kg, a tarifa real substitui a estimativa e a diferença
   * aparece na medição de pontaria, que é onde ela deve aparecer.
   */
  const ultima = MATRIZ[MATRIZ.length - 1];
  const excedenteKg = Math.ceil((peso - ultima.ateGramas) / 1_000);
  const valor = +(ultima.tarifas[coluna] + excedenteKg * KG_ADICIONAL[coluna]).toFixed(2);
  return { valor, regra: "matriz-mais-kg-adicional", pesoGramas: peso };
}
