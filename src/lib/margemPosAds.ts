/**
 * MARGEM DE CONTRIBUIÇÃO PÓS-ADS — a conta que só o NEXO consegue fazer.
 *
 * Os marketplaces calculam ACOS sobre a RECEITA porque não sabem o custo da
 * vendedora. Nós sabemos: o custo por SKU está cadastrado e a tarifa real chega
 * pelo extrato. Então dá para responder o que nenhum painel deles responde —
 * *"este anúncio, depois do custo do produto e da tarifa, ainda dá lucro?"*.
 *
 * ⚠️ DE ONDE ESTA CONTA PARTE — E POR QUE ELA NÃO PODE PARTIR DO LUCRO DO CANAL.
 *
 * Existem dois pontos de partida válidos para descontar anúncio, e misturá-los
 * desconta duas vezes:
 *
 *   (a) partir do LUCRO DO CANAL (`estimatedProfit`). A partir de 30/08/2026 ele
 *       JÁ INCLUI o ads (contrato do backend, registrado em `financialMath.ts`).
 *       Quem consome esse número NÃO subtrai anúncio de novo.
 *   (b) partir de RECEITA, TARIFA e CUSTO medidos no período — nenhum dos três
 *       inclui anúncio, então aqui o ads é nosso para subtrair.
 *
 * ESTE MÓDULO USA (b), e é de propósito: a aba de Ads precisa da conta POR
 * PRODUTO ANUNCIADO, e o lucro do canal é do canal inteiro — não dá para
 * derivá-lo por produto sem inventar rateio. Consequência prática: este arquivo
 * NUNCA lê `estimatedProfit`, e quem for "simplificar" juntando as duas rotas
 * cria o desconto duplo — a mesma armadilha do `anuncioJaNoExtrato` da Amazon,
 * onde o anúncio postado como tarifa já tinha saído do lucro e descontá-lo pela
 * Ads API por cima contaria o mesmo dinheiro duas vezes.
 *
 * ⚠️ POR QUE ESTA CONTA MORA EM `src/lib` E NÃO NA TELA.
 *
 * Ela nasceu para a aba de Ads, mas o briefing, um detector, a Curva ABC ou um
 * e-mail vão querer o mesmo número. Se a conta morar no componente, o segundo
 * consumidor não consegue importar e REIMPLEMENTA — foi exatamente assim que o
 * lucro da Amazon acabou com três cópias em três superfícies, cada conserto
 * alcançando só a que alguém tinha visto (ver `lucroDoPeriodo`). Conta vive onde
 * qualquer consumidor alcança.
 *
 * ⚠️ POR QUE NÃO É POR VENDA ATRIBUÍDA — E ISTO NÃO É UMA ESCOLHA DE ESTILO.
 *
 * O caminho "óbvio" seria usar as vendas que a fonte atribui ao anúncio
 * (`vendasAtribuidas`) e descontar tarifa e custo delas. Não dá, por duas razões
 * que se somam:
 *
 *  1. A janela não casa. A Amazon atribui produto em 14 dias por clique
 *     (`clicks14d`) e campanha em 30 (`sales30d`); a tarifa vem por DATA DE
 *     POSTAGEM do extrato. São recortes diferentes do tempo — subtrair um do
 *     outro produz um número que não descreve período nenhum.
 *  2. Para casar os dois seria preciso uma TARIFA MÉDIA POR UNIDADE calculada
 *     por nós, e média histórica nossa é proibida (AGENTS.md, "não extrapolar"):
 *     é exatamente o tipo de número que parece preciso e não foi medido.
 *
 * Então a conta é do PERÍODO, produto a produto, e só com fato capturado: o que
 * este produto faturou, o que pagou de tarifa, o que custou, e o que consumiu de
 * anúncio — tudo entre as mesmas duas datas. Não é atribuição, e não promete
 * ser: é "o que este produto deixou no período, já pago o anúncio".
 *
 * Quem for "melhorar" isto daqui a três meses trocando para venda atribuída:
 * leia os dois itens acima primeiro. O número fica mais bonito e passa a mentir.
 */

/** Uma linha de produto anunciado, como a rota `/api/ads` entrega. */
export interface ProdutoAnunciado {
  provider: string;
  productId: string;
  /** `null` quando o canal não informa (o ML devolve vazio em 100% das linhas). */
  sku: string | null;
  titulo: string | null;
  moeda: string;

  // ---- DA FONTE, como ela mandou. Nunca recalculado aqui. ----
  /** Gasto com anúncio no período. Sempre conhecido: já saiu do bolso. */
  gasto: number;
  /** `null` = a fonte não informou. Ver `anuncioContraMargem` sobre o `0` dela. */
  vendasAtribuidas: number | null;
  pedidosAtribuidos: number | null;
  acos: number | null;
  roas: number | null;
  janelaAtribuicao: string | null;

  // ---- DO PERÍODO, medido. É isto que alimenta o "sobrou". ----
  /** `0` = não vendeu (fato). `null` = não foi possível apurar. */
  receitaPeriodo: number | null;
  /** `null` = tarifa ainda não postada pelo canal — não é zero. */
  tarifaPeriodo: number | null;
  /** `null` = SKU sem custo cadastrado — não é zero. */
  custoPeriodo: number | null;
  unidadesPeriodo: number | null;
}

/** O que impede o veredito, em linguagem de tela. Vazio = nada impede. */
export type FaltaParaOSobrou = "tarifa" | "custo" | "receita";

export interface MargemPosAds {
  /** `null` quando falta qualquer componente. NUNCA zero para "não sei". */
  sobrou: number | null;
  /** O que falta, para a tela dizer com nome — nunca "parcial". */
  falta: FaltaParaOSobrou[];
}

/**
 * `receita − tarifa − custo − anúncio`, no período.
 *
 * Zero é fato e `null` é ausência, componente a componente: produto anunciado
 * que NÃO vendeu tem receita `0`, tarifa `0` e custo `0` — e o resultado é o
 * gasto com anúncio negativo, que é a verdade mais útil da tela. Já tarifa não
 * postada ou SKU sem custo são `null`, e aí não há veredito: exibir o gasto
 * como se fosse prejuízo fechado acusaria a vendedora de um prejuízo que talvez
 * não exista.
 */
export function margemPosAds(produto: ProdutoAnunciado): MargemPosAds {
  const falta: FaltaParaOSobrou[] = [];
  if (produto.receitaPeriodo == null) falta.push("receita");
  if (produto.tarifaPeriodo == null) falta.push("tarifa");
  if (produto.custoPeriodo == null) falta.push("custo");
  if (falta.length > 0) return { sobrou: null, falta };

  const sobrou =
    (produto.receitaPeriodo ?? 0) -
    (produto.tarifaPeriodo ?? 0) -
    (produto.custoPeriodo ?? 0) -
    produto.gasto;
  return { sobrou: +sobrou.toFixed(2), falta: [] };
}

/**
 * O total do canal — a MESMA conta, somando os produtos daquele canal.
 *
 * Some só o que tem veredito, e devolve quantos produtos ficaram de fora: um
 * total que engolisse produto sem custo afirmaria um resultado apoiado em dado
 * que não existe, e é a origem de metade dos defeitos que a gente consertou.
 */
export function margemPosAdsDoCanal(produtos: ProdutoAnunciado[]): {
  sobrou: number | null;
  gasto: number;
  produtosComVeredito: number;
  produtosSemVeredito: number;
} {
  const gasto = +produtos.reduce((soma, p) => soma + p.gasto, 0).toFixed(2);
  const vereditos = produtos.map((p) => ({ p, m: margemPosAds(p) }));
  const comVeredito = vereditos.filter((v) => v.m.sobrou != null);
  return {
    // Nenhum produto com veredito: o canal não tem resultado a afirmar, e "—" é
    // a resposta honesta. Zero diria "não sobrou nada", que é outra coisa.
    sobrou: comVeredito.length === 0
      ? null
      : +comVeredito.reduce((soma, v) => soma + (v.m.sobrou ?? 0), 0).toFixed(2),
    gasto,
    produtosComVeredito: comVeredito.length,
    produtosSemVeredito: vereditos.length - comVeredito.length,
  };
}
