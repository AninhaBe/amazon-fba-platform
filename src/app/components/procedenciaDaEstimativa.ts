// Texto puro, em arquivo .ts e nao .tsx de propósito: `node --experimental-strip-types`
// (o runner de `npm test`) não carrega `.tsx`, e a frase precisa ser testada pelo
// COMPORTAMENTO — chamando a função e conferindo a saída — e não por casamento no
// fonte, que é a família de teste decorativo que o AGENTS.md proíbe.
/**
 * A PROCEDÊNCIA DO AGREGADO — o card que soma muitas linhas.
 *
 * ⚠️ ESTA FRASE SUBSTITUI UMA QUE ERA FALSA (01/09/2026). A anterior dizia
 * *"Estimado pela tabela da Amazon"*, e o agregado soma linhas de origens
 * diferentes: medido contra o banco no dia em que os campos chegaram, das 1.006
 * linhas de 30 dias, 165 tinham estimativa — **164 da Product Fees API, 1
 * observada, e nenhuma de tabela**. A frase nomeava a única fonte que não tinha
 * uma linha sequer.
 *
 * Não é possível nomear a fonte de um número que soma fontes distintas sem
 * contá-las, e contar é campo que o agregado não recebe. Então a frase diz o que
 * é verdade para qualquer mistura: que ainda não é o oficial, e o que a
 * substitui. **A procedência específica vive na LINHA**, onde ela é verificável.
 */
export const PROCEDENCIA_DO_AGREGADO =
  "Inclui tarifa ainda não liquidada — o valor que a Amazon postar na liquidação substitui este.";

/**
 * O RÓTULO DA FACE DO AGREGADO.
 *
 * ⚠️ Ele não pode nomear origem, pelo mesmo motivo da frase acima: o card
 * soma linhas de fontes diferentes. O que ele diz é o que vale para qualquer
 * mistura — que aquele total ainda vai mudar na liquidação. É a marca da
 * ADR-027 sem a palavra que a vendedora recusou.
 */
export const ROTULO_DO_AGREGADO = "ainda não liquidado";

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
      percentualDaCategoria: number | null;
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

const SEM_ORIGEM = "Origem não informada — não dá para conferir de onde este valor saiu. O valor que a Amazon postar na liquidação substitui este.";

export function procedenciaDaFonte(estimativa: FonteDaEstimativa | null | undefined): ProcedenciaLida {
  if (!estimativa || !("fonte" in estimativa)) return { texto: SEM_ORIGEM, origemConhecida: false };
  const moeda = estimativa.moeda ?? "BRL";
  // ⚠️ A PROMESSA DA ADR-027 CONTINUA EM TODAS AS FRASES, e é ela que
  // sobrou depois de a palavra "estimado" sair: o número muda na liquidação. A
  // marca visual existe para isso, e some quando o valor postado chega.
  const fim = "O valor que a Amazon postar na liquidação substitui este.";

  switch (estimativa.fonte) {
    case "observada": {
      const detalhe = composicao(estimativa, moeda);
      return {
        texto: `Tarifa que a Amazon já cobrou neste mesmo produto, no pedido de ${diaBR(estimativa.diaDoPedido)}${detalhe ? ` (${detalhe})` : ""}. ${fim}`,
        origemConhecida: true,
      };
    }
    case "tabela": {
      const detalhe = composicao(estimativa, moeda);
      // Percentual ausente OMITE a cláusula, nunca vira "0,00%": é o `null ≠ 0`
      // aplicado ao texto. Hoje ele vem null em 100% dos casos — a fonte tabela
      // está parada por falta da categoria por ASIN —, e a frase precisa
      // aguentar isso sem ficar torta.
      // O percentual que chega é o EFETIVO SOBRE O PREÇO (fração), não a
      // alíquota nominal da categoria — por isso a frase diz "sobre o preço".
      // Nomear "da categoria" afirmaria um número que ninguém publicou com esse
      // recorte, e é conferível pela vendedora contra o pedido.
      const comissao = estimativa.percentualDaCategoria == null
        ? ""
        : `: comissão de ${percentual(estimativa.percentualDaCategoria)} sobre o preço + tarifa FBA`;
      return {
        texto: `Tarifa da tabela oficial da Amazon${comissao}${detalhe ? ` (${detalhe})` : ""}. ${fim}`,
        origemConhecida: true,
      };
    }
    case "api": {
      const detalhe = composicao(estimativa, moeda);
      return {
        texto: detalhe ? `Tarifa calculada pela Amazon (Product Fees API): ${detalhe}. ${fim}` : `Tarifa calculada pela Amazon (Product Fees API). ${fim}`,
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
 * O TEXTO DA MARCA NA FACE — a ORIGEM, não a palavra "estimado".
 *
 * ⚠️ A PALAVRA SAIU A PEDIDO DA VENDEDORA (01/09/2026), com estas
 * palavras: *"não é estimado, é a tabela oficial"*. E ela tem razão sobre o que
 * o rótulo estava vendendo: "estimado" sugere conta nossa, chute, média — e
 * nenhuma das três fontes é isso. Todas são número **publicado pela Amazon**:
 * uma é o que ela já cobrou neste produto, outra é a tabela dela, a terceira é
 * a resposta da API dela. Chamar isso de estimativa depreciava o dado.
 *
 * ⚠️ O QUE **NÃO** SAIU FOI A MARCA. A pílula continua ali, e ela é o
 * diferencial da ADR-027: diz que aquele número ainda não é o do extrato e vai
 * ser substituído na liquidação. O concorrente mostra o valor de tabela **sem
 * marca nenhuma**, como se fosse final, e nunca troca pelo extrato (medido em
 * 31/08/2026). Tirar a palavra e manter a marca é exatamente a diferença entre
 * as duas coisas: o dado é oficial, o pedido é que ainda não liquidou.
 *
 * A promessa migrou para o tooltip e para o rótulo do agregado
 * (`ROTULO_DO_AGREGADO`), que é onde ela cabe sem nomear fonte.
 */
export function rotuloDaMarca(fonte: FonteDaEstimativa | null | undefined): string {
  switch (fonte?.fonte) {
    case "observada":
      return "tarifa já cobrada neste produto";
    case "tabela":
      return "tabela oficial Amazon";
    case "api":
      return "calculada pela Amazon (API)";
    default:
      // Origem desconhecida continua VISÍVEL na face — é defeito nosso, não
      // estado do dado, e defeito não mora em tooltip. Também aqui sem a
      // palavra "estimado": ela afirmaria uma procedência que não existe.
      return "origem não informada";
  }
}

/**
 * O MAPEADOR DA FRONTEIRA — o valor que o banco grava vira a variante da tela.
 *
 * ⚠️ ELE MORA AQUI, num lugar só, pelo mesmo motivo que a conversão de unidade:
 * é o ponto em que o vocabulário do banco (`product_fees_api`) encontra o da
 * tela. Espalhar `origem === "product_fees_api"` pelos pontos de render é como
 * nasce o dia em que um deles não conhece um valor novo e mostra o nome cru.
 *
 * ⚠️ VALOR FORA DOS TRÊS CONHECIDOS VIRA DESCONHECIDO, nunca texto cru. A tela
 * não inventa nome para o que não sabe ler — e desconhecido é VISÍVEL, não
 * silencioso: `rotuloDaMarca` muda a palavra na face.
 */
export function fonteDaLinha(linha: {
  origemDaTarifa?: string | null;
  observadaEm?: string | null;
  percentualDaCategoria?: number | null;
  comissao?: number | null;
  fba?: number | null;
  moeda?: string;
}): FonteDaEstimativa | null {
  const comum = { comissao: linha.comissao ?? null, fba: linha.fba ?? null, moeda: linha.moeda };
  switch (linha.origemDaTarifa) {
    case "observada":
      /**
       * ⚠️ SEM A DATA, A ORIGEM OBSERVADA VIRA DESCONHECIDA — de propósito.
       *
       * A frase da origem observada É a data: *"a Amazon já cobrou isto neste
       * produto no pedido de 30/08"*. Sem ela não há afirmação a fazer, só um
       * rótulo que ninguém confere. E ela some por defeito real: até 01/09/2026
       * a extração da data vinha de uma expressão sem as barras invertidas, que
       * não casava data nenhuma — `observadaEm` teria sido `null` para sempre,
       * inclusive nas linhas que tinham observação.
       *
       * Tratar como desconhecida deixa esse defeito VISÍVEL na tela. Renderizar
       * "estimado pela tarifa observada" sem a data o esconderia.
       */
      return linha.observadaEm ? { fonte: "observada", diaDoPedido: linha.observadaEm, ...comum } : null;
    case "product_fees_api":
      return { fonte: "api", ...comum };
    case "tabela":
      /**
       * O percentual é COMPLEMENTO aqui, e não a afirmação inteira: *"estimado
       * pela tabela da Amazon"* já é uma frase completa e checável (ela abre a
       * tabela). Por isso `tabela` sem percentual continua com origem conhecida,
       * ao contrário de `observada` sem data.
       *
       * E ele vem `null` em 100% dos casos hoje: a fonte tabela está parada por
       * falta da categoria por ASIN, que não existe no nosso banco.
       */
      return { fonte: "tabela", percentualDaCategoria: linha.percentualDaCategoria ?? null, ...comum };
    default:
      return null;
  }
}
