// Texto puro, em arquivo .ts e nao .tsx de propósito: `node --experimental-strip-types`
// (o runner de `npm test`) não carrega `.tsx`, e a frase precisa ser testada pelo
// COMPORTAMENTO — chamando a função e conferindo a saída — e não por casamento no
// fonte, que é a família de teste decorativo que o AGENTS.md proíbe.
/**
 * A frase de procedência, montada a partir do que a Amazon devolveu.
 *
 * Fica no `title`/`aria-label` da marca — é COMPLEMENTO, não a frase que muda a
 * leitura. A que muda a leitura ("inclui R$ X estimados de N pedidos") já
 * renderiza na face do card, sem interação.
 */
export function procedenciaDaEstimativa(partes: { comissao?: number | null; fba?: number | null; moeda?: string }): string {
  const moeda = partes.moeda ?? "BRL";
  const dinheiro = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(v);
  const detalhe = [
    partes.comissao == null ? null : `comissão ${dinheiro(partes.comissao)}`,
    partes.fba == null ? null : `FBA ${dinheiro(partes.fba)}`,
  ].filter(Boolean).join(" + ");
  // Sem as parcelas, a frase ainda precisa dizer as duas coisas que importam:
  // que é estimativa da Amazon e que o oficial substitui. Detalhe ausente não
  // vira zero nem some com a explicação.
  return detalhe
    ? `Estimado pela Amazon: ${detalhe} — a tarifa oficial entra na liquidação.`
    : "Estimado pela tabela da Amazon — a tarifa oficial entra na liquidação.";
}

// ═══════════════════════════════════════════════════════════════════════════
// QUATRO PROCEDÊNCIAS — peça preparada, ainda NÃO ligada na tela (01/09/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// A estimativa deixou de ter uma fonte só. A tela precisa dizer QUAL, e com a
// informação que torna aquela procedência **verificável** — não basta nomear a
// fonte, tem de dar o que permite conferir:
//
//   observada  a tarifa que a Amazon JÁ cobrou naquele mesmo ASIN, em pedido
//              liquidado. É o número da fonte, só que de OUTRO pedido — então o
//              que torna verificável é a DATA do pedido de onde veio;
//   tabela     percentual de categoria + tarifa FBA por produto. Verificável
//              pelo PERCENTUAL usado, que é o que ela confere contra a Amazon;
//   api        Product Fees, quando há token. A composição (comissão + FBA) já
//              é a verificação — é o que a própria API devolveu.
//
// `oficial` NÃO aparece aqui de propósito: quando o extrato chega não há
// estimativa, e a marca SOME. Modelar "oficial" como quarta variante convidaria
// alguém a renderizar um selo dizendo que o número é oficial — e selo
// permanente vira decoração.
//
// ⚠️ A FACE CONTINUA COM UMA MARCA SÓ: "estimado". A distinção entre as três
// vive no tooltip. Um selo por procedência seria empilhamento novo dois dias
// depois da auditoria que tirou 9–12 marcas da tela.
//
// ⚠️ NÃO LIGADA AINDA, e o que falta é PRECISO (medido em 01/09/2026): o
// vocabulário já foi definido pelo backend — `origemDaTarifa`, `observadaEm` em
// `provider_fee_code` no formato `observada:2026-08-30`, e `percentualDaCategoria`
// —, mas **nada disso chega até aqui**. A consulta que monta a marca da linha
// (`amazonOverviewCanonical.ts`, o SELECT de `workspace_channel_order_fee_estimates`)
// traz `external_order_id`, `line_no`, `fee_type` e `amount`, e mais nada: nem
// `source`, nem `provider_fee_code`.
//
// Ligar antes disso renderizaria "origem não informada" em TODA linha, com o
// teste verde — a família de defeito que este projeto passou 01/09/2026
// inteiro caçando. Falta o produtor ler as duas colunas e devolver
// `origemDaTarifa` e `observadaEm` na marca da linha.
//
// Quando existir, as chamadas migram de `procedenciaDaEstimativa` para
// `procedenciaDaFonte` num commit só e a função de cima sai. Até lá as duas
// convivem, e é ESTA que tem o contrato novo.

/**
 * AS TRÊS FONTES QUE CHEGAM À TELA — e por que `oficial` não é uma delas.
 *
 * ⚠️ `oficial` EXISTE NO VOCABULÁRIO DO BANCO E NÃO CHEGA AQUI, e isso é prova
 * de comportamento, não opinião. Quando a tarifa oficial é postada:
 *
 *   1. o produtor carimba `superseded_at` na estimativa
 *      (`amazonTarifaEstimada.ts`, o UPDATE que fecha a estimativa daquele tipo);
 *   2. o leitor filtra `superseded_at IS NULL`
 *      (`amazonOverviewCanonical.ts`, no SELECT das estimativas por linha).
 *
 * Ou seja: estimativa substituída **deixa de ser marca**, porque o número
 * daquela linha passou a ser o real. `oficial` descreve o ciclo de vida da linha
 * no banco; esta peça descreve o que a tela mostra. **A ausência é o contrato** —
 * quem acrescentar `oficial` aqui está modelando um estado que a tela nunca vê,
 * e a marca que ele produziria seria uma marca de estimativa sobre um número que
 * já não é estimado.
 *
 * ⚠️ E `tabela` AINDA NÃO TEM PRODUTOR — **não apague**. Hoje só existem
 * `source='observada'` e `source='product_fees_api'`. A ausência de `tabela` não
 * é variante morta: é o pedido original da Ana (*"pegar a TABELA de comissão por
 * porcentagem da Amazon"*, 31/08/2026) que foi traduzido para a Product Fees API
 * por conveniência — e a tradução quebrou exatamente onde a tabela não
 * quebraria: a Product Fees responde POR VENDEDOR, a conta está com o token
 * revogado, e o resultado medido foi 1 pedido com estimativa e travessão nos
 * outros 18. O ramo fica esperando o produtor.
 */
export type FonteDaEstimativa =
  | { fonte: "observada"; diaDoPedido: string; comissao?: number | null; fba?: number | null; moeda?: string }
  | {
      fonte: "tabela";
      /**
       * A FRAÇÃO, não o número da porcentagem — o backend define
       * `percentualDaCategoria = amount / unit_price`, então comissão de 12,01%
       * chega como `0.1201`.
       *
       * ⚠️ O NOME SEGUE O DO BACKEND DE PROPÓSITO: um `percentualDaComissao`
       * aqui e um `percentualDaCategoria` lá convidam alguém a repassar um pelo
       * outro sem converter, e o erro seria de 100× — "0,12%" na tela onde a
       * Amazon cobra 12,01%. Erro de unidade não fica vermelho em lugar nenhum:
       * ele só parece um número pequeno.
       */
      percentualDaCategoria: number;
      comissao?: number | null; fba?: number | null; moeda?: string;
    }
  | { fonte: "api"; comissao?: number | null; fba?: number | null; moeda?: string };

export interface ProcedenciaLida {
  /** O que vai no `title`/`aria-label` da marca. */
  texto: string;
  /**
   * `false` quando veio valor estimado sem procedência reconhecível.
   *
   * ⚠️ ISSO É DEFEITO, NÃO ESTADO NORMAL — e a tela tem de deixar ver. Uma
   * estimativa sem origem não é conferível por ninguém: não dá para saber se o
   * número veio de um pedido antigo, de uma tabela ou de lugar nenhum. Tratar
   * como "estimado" silencioso é a família do zero fabricado — um valor que
   * passa por informação sem ter procedência.
   */
  origemConhecida: boolean;
}

const dinheiroDe = (moeda: string) => (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(v);

function composicao(partes: { comissao?: number | null; fba?: number | null }, moeda: string): string {
  const dinheiro = dinheiroDe(moeda);
  // Parcela ausente é OMITIDA, nunca vira zero: a Amazon posta em partes, e
  // 95,3% dos pedidos com tarifa real têm comissão e nenhuma logística.
  return [
    partes.comissao == null ? null : `comissão ${dinheiro(partes.comissao)}`,
    partes.fba == null ? null : `FBA ${dinheiro(partes.fba)}`,
  ].filter(Boolean).join(" + ");
}

/**
 * A fração vira o percentual como ela lê na tabela da Amazon: `0.1201` → "12,01%".
 *
 * A conversão mora AQUI, num lugar só, porque é o ponto em que a unidade do
 * banco (fração) encontra a unidade da tela (porcentagem). Espalhar `* 100`
 * pelos pontos de render é como o erro de 100× nasce.
 */
function percentual(fracao: number): string {
  return `${(fracao * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/** `2026-08-31` → `31/08/2026`, o formato em que ela procura o pedido. */
function diaBR(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : iso;
}

const SEM_ORIGEM = "Valor estimado sem origem informada — não dá para conferir de onde ele saiu. A tarifa oficial entra na liquidação.";

export function procedenciaDaFonte(estimativa: FonteDaEstimativa | null | undefined): ProcedenciaLida {
  if (!estimativa || !("fonte" in estimativa)) return { texto: SEM_ORIGEM, origemConhecida: false };
  const moeda = estimativa.moeda ?? "BRL";
  const fim = "A tarifa oficial entra na liquidação.";

  switch (estimativa.fonte) {
    case "observada": {
      const detalhe = composicao(estimativa, moeda);
      return {
        texto: `Estimado pela tarifa que a Amazon já cobrou neste produto no pedido de ${diaBR(estimativa.diaDoPedido)}${detalhe ? ` (${detalhe})` : ""}. ${fim}`,
        origemConhecida: true,
      };
    }
    case "tabela": {
      const detalhe = composicao(estimativa, moeda);
      return {
        texto: `Estimado pela tabela da Amazon: comissão de ${percentual(estimativa.percentualDaCategoria)} da categoria + tarifa FBA${detalhe ? ` (${detalhe})` : ""}. ${fim}`,
        origemConhecida: true,
      };
    }
    case "api": {
      const detalhe = composicao(estimativa, moeda);
      return {
        texto: detalhe ? `Estimado pela Amazon: ${detalhe} — ${fim.toLowerCase()}` : `Estimado pela Product Fees API da Amazon. ${fim}`,
        origemConhecida: true,
      };
    }
    default:
      // Fonte que o servidor mandou e a tela não conhece. Mesmo tratamento da
      // ausente: visível, nunca silenciosa.
      return { texto: SEM_ORIGEM, origemConhecida: false };
  }
}

/**
 * O texto da marca na FACE.
 *
 * Uma só para as três procedências — a distinção vive no tooltip. O ÚNICO caso
 * que muda a palavra é a origem desconhecida, e não porque seja uma quarta
 * procedência: é porque é DEFEITO, e defeito que só aparece no hover não
 * aparece (a lição do v207 e a do `emVoo`).
 */
export function rotuloDaMarca(origemConhecida: boolean): string {
  return origemConhecida ? "estimado" : "estimado · origem não informada";
}
