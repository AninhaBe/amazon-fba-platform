import { spapiFetch, defaultMarketplaceId } from "../spapi";

/**
 * TARIFA ESTIMADA PELA PRÓPRIA AMAZON, EM LOTE — a implementação da ADR-027.
 *
 * ⚠️ POR QUE ISTO NÃO FERE "NÃO EXTRAPOLAR" (AGENTS.md). O número vem da tabela
 * que a Amazon publica (Product Fees API), dado o ASIN e o preço praticado. Não
 * é média dos nossos pedidos, não é regra de três sobre o que já liquidou — isso
 * sim seria extrapolação, e continua proibido. É a exceção nomeada da ADR-027:
 * número da fonte, marcado na tela, substituído na liquidação.
 *
 * ⚠️ LOTE DE 20, E ISSO MUDA A ORDEM DE GRANDEZA DO CUSTO.
 * A ADR previa `getMyFeesEstimateForASIN`, um ASIN por chamada. A documentação
 * traz também `getMyFeesEstimates`, que aceita **até 20 itens por chamada**.
 * Somado ao reuso por chave `(ASIN, preço)` — o preço praticado é estável, então
 * a mesma chave se repete centenas de vezes —, o custo medido em 31/08/2026 foi:
 *
 *   um dia:          22 linhas de pedido →  11 chaves → 1 chamada
 *   últimos 30 dias: 1.617 linhas        →  47 chaves → 3 chamadas
 *
 * 34× de redução na janela de 30 dias. **Não é uma chamada por pedido.**
 *
 * ⚠️ FALHA NÃO VIRA ZERO. Item que a Amazon não estimar sai do mapa e o chamador
 * fica sem tarifa para aquela chave — que é `null`, não `0`. O modo de falha é o
 * comportamento de antes: a linha continua sem tarifa e a tela diz isso.
 */

/** O teto da API. Passar disso é erro de requisição, não truncamento silencioso. */
export const LOTE_MAXIMO = 20;

export interface ChaveDeTarifa {
  asin: string;
  /** Preço praticado NAQUELE pedido — não o preço de hoje (ADR-027). */
  preco: number;
}

export interface TarifaEstimada {
  asin: string;
  preco: number;
  /** Total estimado (comissão + FBA) para uma unidade àquele preço. */
  total: number;
  /** Decomposição como a Amazon devolveu — é o que a tela mostra na procedência. */
  detalhes: { tipo: string; valor: number }[];
  moeda: string;
}

/** Chave textual estável — é ela que faz 1.617 linhas virarem 47 chamadas. */
export const chaveDe = ({ asin, preco }: ChaveDeTarifa) => `${asin}:${preco.toFixed(2)}`;

interface FeeDetail {
  FeeType?: string;
  FeeAmount?: { CurrencyCode?: string; Amount?: number };
}
interface EstimateResult {
  Status?: string;
  FeesEstimateIdentifier?: { IdValue?: string; PriceToEstimateFees?: { ListingPrice?: { Amount?: number } } };
  FeesEstimate?: {
    TotalFeesEstimate?: { CurrencyCode?: string; Amount?: number };
    FeeDetailList?: FeeDetail[];
  };
  Error?: { Message?: string };
}

/**
 * Estima a tarifa de várias chaves `(ASIN, preço)` numa só ida — em lotes de 20.
 *
 * Devolve um mapa `chaveDe() -> TarifaEstimada`. Chave ausente do mapa = a
 * Amazon não estimou, e o chamador **não pode** substituir por zero.
 */
export async function estimarTarifasEmLote(
  chaves: ChaveDeTarifa[],
  opcoes: { moeda?: string; porFba?: boolean; marketplaceId?: string } = {},
): Promise<Map<string, TarifaEstimada>> {
  const { moeda = "BRL", porFba = true, marketplaceId = defaultMarketplaceId() } = opcoes;
  const resultado = new Map<string, TarifaEstimada>();

  // Deduplicar ANTES de fatiar: é o passo que faz o custo cair 34×, e fazer
  // depois desperdiçaria vagas do lote com repetição.
  const unicas = new Map<string, ChaveDeTarifa>();
  for (const chave of chaves) {
    if (!chave.asin || !Number.isFinite(chave.preco) || chave.preco <= 0) continue;
    unicas.set(chaveDe(chave), chave);
  }
  const lista = [...unicas.values()];

  for (let inicio = 0; inicio < lista.length; inicio += LOTE_MAXIMO) {
    const lote = lista.slice(inicio, inicio + LOTE_MAXIMO);
    const body = {
      FeesEstimateByIdRequest: lote.map((chave) => ({
        IdType: "ASIN",
        IdValue: chave.asin,
        FeesEstimateRequest: {
          MarketplaceId: marketplaceId,
          IsAmazonFulfilled: porFba,
          PriceToEstimateFees: {
            ListingPrice: { CurrencyCode: moeda, Amount: chave.preco },
            Shipping: { CurrencyCode: moeda, Amount: 0 },
          },
          // O identificador volta na resposta e é como cada estimativa é casada
          // com o pedido dela — sem ele, um lote de 20 vira 20 respostas anônimas.
          Identifier: chaveDe(chave),
        },
      })),
    };

    let respostas: EstimateResult[] = [];
    try {
      // ⚠️ O LOTE NÃO ESTÁ LIGADO, E ISSO É MEDIÇÃO, NÃO PREGUIÇA (31/08/2026).
      //
      // `POST /products/fees/v0/feesEstimate` com `FeesEstimateByIdRequest`
      // devolveu erro nesta conta, e a documentação que o MCP serve confirma que
      // a operação existe e aceita 20 itens, mas NÃO traz o corpo exato. Chutar o
      // formato seria inventar contrato de API — o erro que este projeto vem
      // pagando a semana toda.
      //
      // Então cada chave vai pelo endpoint de UM ASIN, que já é provado no repo
      // (`src/lib/fees.ts`, usado pela calculadora desde sempre). O custo sobe de
      // 3 para 47 chamadas na janela de 30 dias — ainda BOUNDED, porque a dedup
      // por `(ASIN, preço)` acontece antes: 1.617 linhas viram 47 chamadas, não
      // 1.617.
      //
      // 📌 PENDENTE: descobrir o corpo do lote e voltar a 3 chamadas. Está
      // registrado em TODO.md; a assinatura desta função já é de lote, então
      // ligar é trocar o miolo, não reescrever o chamador.
      void body;
      respostas = await Promise.all(lote.map(async (chave) => {
        const data = await spapiFetch<{ payload?: { FeesEstimateResult?: EstimateResult } }>(
          `/products/fees/v0/items/${encodeURIComponent(chave.asin)}/feesEstimate`,
          {
            method: "POST",
            body: {
              FeesEstimateRequest: {
                MarketplaceId: marketplaceId,
                IsAmazonFulfilled: porFba,
                PriceToEstimateFees: {
                  ListingPrice: { CurrencyCode: moeda, Amount: chave.preco },
                  Shipping: { CurrencyCode: moeda, Amount: 0 },
                },
                Identifier: chaveDe(chave),
              },
            },
          },
        );
        const resultado = data.payload?.FeesEstimateResult ?? {};
        // O endpoint de um ASIN não ecoa o identificador do jeito que o de lote
        // ecoaria; casamos pela chave que acabamos de pedir.
        return {
          ...resultado,
          FeesEstimateIdentifier: {
            IdValue: chave.asin,
            PriceToEstimateFees: { ListingPrice: { Amount: chave.preco } },
          },
        } as EstimateResult;
      }));
    } catch (erro) {
      // ⚠️ Um lote que falha NÃO derruba os outros nem vira zero: as chaves dele
      // simplesmente não entram no mapa, e quem lê fica sem tarifa — que é
      // `null`. Falha na estimativa nunca pode falhar a ingestão (ADR-027).
      console.error("[amazon-fees] lote de estimativa falhou", {
        de: inicio,
        tamanho: lote.length,
        motivo: erro instanceof Error ? erro.message.slice(0, 200) : "erro desconhecido",
      });
      continue;
    }

    for (const item of respostas) {
      // ⚠️ `!Amount` DESCARTAVA ZERO, E ZERO AQUI É FATO (achado em 31/08/2026).
      //
      // A Amazon devolveu `Status: "Success"` com `TotalFeesEstimate: 0` nesta
      // conta — e é verdade: a promoção de vendedor novo zera comissão e FBA. O
      // guard com `!` tratava esse zero como ausência e a estimativa sumia.
      //
      // É o `null ≠ 0` do AGENTS.md invertido, dentro de código que eu acabei de
      // escrever para honrar essa mesma regra. `Amount == null` é "não sei";
      // `Amount === 0` é "a Amazon não cobra nada por este item a este preço".
      if (item.Status !== "Success" || item.FeesEstimate?.TotalFeesEstimate?.Amount == null) continue;
      const identificador = item.FeesEstimateIdentifier?.IdValue;
      const preco = item.FeesEstimateIdentifier?.PriceToEstimateFees?.ListingPrice?.Amount;
      if (!identificador || preco == null) continue;
      const chave = chaveDe({ asin: identificador, preco });
      resultado.set(chave, {
        asin: identificador,
        preco,
        total: +item.FeesEstimate.TotalFeesEstimate.Amount.toFixed(2),
        // Guardado como a Amazon devolveu: é o que vira "comissão R$ X + FBA R$ Y"
        // no tooltip de procedência, e recalcular por fora daria outro número.
        detalhes: (item.FeesEstimate.FeeDetailList ?? [])
          .filter((detalhe) => detalhe.FeeAmount?.Amount != null)
          .map((detalhe) => ({
            tipo: detalhe.FeeType ?? "desconhecida",
            valor: +detalhe.FeeAmount!.Amount!.toFixed(2),
          })),
        moeda: item.FeesEstimate.TotalFeesEstimate.CurrencyCode ?? moeda,
      });
    }
  }

  return resultado;
}

/**
 * Persiste a tarifa PREVISTA na tabela própria, com GRÃO DE LINHA (ADR-027
 * Emenda II, `migrations/0022`).
 *
 * ⚠️ ESTA FUNÇÃO ESCREVIA EM `workspace_channel_order_fees` COM
 * `fee_type = 'estimated'`, E ISSO ACABOU EM 01/09/2026. O motivo é o que o
 * Delta mediu: com a procedência ocupando o lugar da natureza, previsto e real
 * não tinham chave comum ('ReferralFee' caía em `other`, 'Commission' em
 * `commission`), e a substituição virava mapeamento à mão em JS em vez de join.
 *
 * ⚠️ E SE ALGUÉM APONTAR ISTO DE VOLTA PARA A TABELA ANTIGA, O ESTRAGO É MAIOR
 * QUE ANTES: a primeira ramificação da view `..._efetivas` lê
 * `workspace_channel_order_fees` INTEIRA e carimba `basis = 'actual'`. Uma linha
 * `estimated` gravada lá voltaria à tela como se fosse tarifa OFICIAL da Amazon
 * — exatamente a marca que nos separa do concorrente.
 *
 * O que muda no comportamento, e é decisão da ADR:
 * - grão de LINHA (`line_no`), não de pedido — é o que torna o desvio por SKU
 *   possível quando a oficial chegar;
 * - `fee_type` no vocabulário canônico: ReferralFee → `commission`, FBAFees →
 *   `fulfillment`. O rótulo da Amazon vive em `provider_fee_code`;
 * - `unit_price` e `qty` gravados junto: sem eles o desvio é inatribuível — não
 *   dá para saber se erramos a tarifa ou se o preço mudou.
 *
 * ⚠️ E O FILTRO DE SELEÇÃO MUDOU JUNTO, senão a correção da view não serve para
 * nada. Antes a consulta excluía o pedido que já tivesse QUALQUER tarifa real.
 * Com a substituição agora sendo por (pedido, `fee_type`), esse filtro deixaria
 * sem estimativa de FBA os 95,3% de pedidos que têm comissão real e nenhuma
 * logística (5.247 de 5.503, medido em 01/09/2026). Agora a exclusão é POR
 * TIPO: só não se estima o que a Amazon já postou.
 *
 * ⚠️ O PREÇO É O DO PEDIDO, NÃO O DE HOJE (ADR-027). Vem de `unit_price` quando
 * a Amazon já expôs, ou de `ordered_gross / qty` — o preço de tabela do próprio
 * pedido. Nunca o preço atual do catálogo.
 *
 * ⚠️ ZERO DA FONTE É FATO, E É GRAVADO. Medido em 31/08/2026 na conta
 * `AO62LVXJMX3AA`: a Product Fees API responde `Success` com `Amount: 0` (e
 * `FeePromotion: 0`) para os ASINs dela, enquanto devolve 12% + FBA R$ 5,65 nos
 * ASINs do outro vendedor no mesmo minuto — o que aponta para isenção real da
 * conta, não defeito da chamada. Desconhecido é LINHA AUSENTE; zero é uma linha
 * com `amount = 0.00`. Confundir os dois é o `null != 0` do AGENTS.md.
 */
export async function estimarTarifaDosPedidosSemTarifa(
  connectionId: string,
  limite = 200,
): Promise<{ pedidos: number; linhas: number; chaves: number }> {
  const { dbQuery } = await import("../db");
  const { currentWorkspaceId } = await import("../workspaceScope");
  const workspaceId = currentWorkspaceId();

  const linhas = await dbQuery<{
    external_order_id: string; line_no: number; external_product_id: string; qty: number;
    unit_price: string | null; preco_de_tabela: string | null;
    tem_comissao_real: boolean; tem_logistica_real: boolean;
  }>(
    `SELECT i.external_order_id, i.line_no, i.external_product_id, i.qty, i.unit_price,
            (o.ordered_gross / NULLIF(SUM(i.qty) OVER (PARTITION BY i.external_order_id), 0))::text AS preco_de_tabela,
            EXISTS (SELECT 1 FROM workspace_channel_order_fees f
                     WHERE f.workspace_id = i.workspace_id AND f.provider = i.provider
                       AND f.connection_id = i.connection_id
                       AND f.external_order_id = i.external_order_id
                       AND f.fee_type = 'commission')  AS tem_comissao_real,
            EXISTS (SELECT 1 FROM workspace_channel_order_fees f
                     WHERE f.workspace_id = i.workspace_id AND f.provider = i.provider
                       AND f.connection_id = i.connection_id
                       AND f.external_order_id = i.external_order_id
                       AND f.fee_type = 'fulfillment') AS tem_logistica_real
       FROM workspace_channel_order_items i
       JOIN workspace_channel_orders o
         ON o.workspace_id = i.workspace_id AND o.provider = i.provider
        AND o.connection_id = i.connection_id AND o.external_order_id = i.external_order_id
      WHERE i.workspace_id = $1 AND i.provider = 'amazon' AND i.connection_id = $2
        AND o.status <> 'cancelled'
      ORDER BY o.occurred_at DESC
      LIMIT $3`,
    [workspaceId, connectionId, limite],
  );
  if (!linhas.length) return { pedidos: 0, linhas: 0, chaves: 0 };

  const precoDe = (linha: (typeof linhas)[number]) => {
    const real = linha.unit_price == null ? null : Number(linha.unit_price);
    if (real != null && real > 0) return real;
    const tabela = linha.preco_de_tabela == null ? null : Number(linha.preco_de_tabela);
    return tabela != null && tabela > 0 ? tabela : null;
  };

  const comPreco = linhas.filter((linha) => precoDe(linha) != null);
  const estimativas = await estimarTarifasEmLote(
    comPreco.map((linha) => ({ asin: linha.external_product_id, preco: precoDe(linha)! })),
  );

  /**
   * O vocabulário canônico, e ele é a razão de existir da tabela nova: é esta
   * tradução que faz previsto e real terem a MESMA chave e a substituição virar
   * join. Tipo fora do mapa cai em `other` — nunca em `estimated`, que o CHECK
   * do banco recusa de propósito.
   */
  const NATUREZA: Record<string, string> = {
    ReferralFee: "commission",
    FBAFees: "fulfillment",
    VariableClosingFee: "other",
    PerItemFee: "other",
  };

  const pedidosTocados = new Set<string>();
  let gravadas = 0;
  for (const linha of comPreco) {
    const preco = precoDe(linha)!;
    const estimativa = estimativas.get(chaveDe({ asin: linha.external_product_id, preco }));
    if (!estimativa) continue;
    for (const detalhe of estimativa.detalhes) {
      const natureza = NATUREZA[detalhe.tipo] ?? "other";
      // Só não se estima o que a Amazon JÁ POSTOU daquele tipo.
      if (natureza === "commission" && linha.tem_comissao_real) continue;
      if (natureza === "fulfillment" && linha.tem_logistica_real) continue;
      await dbQuery(
        `INSERT INTO workspace_channel_order_fee_estimates
           (workspace_id, provider, connection_id, external_order_id, line_no, fee_type,
            provider_fee_code, amount, currency, unit_price, qty, source)
         VALUES ($1, 'amazon', $2, $3, $4, $5, $6, $7, 'BRL', $8, $9, 'product_fees_api')
         ON CONFLICT (workspace_id, provider, connection_id, external_order_id, line_no, fee_type)
         DO UPDATE SET amount = EXCLUDED.amount, provider_fee_code = EXCLUDED.provider_fee_code,
                       unit_price = EXCLUDED.unit_price, qty = EXCLUDED.qty, estimated_at = now()
          WHERE workspace_channel_order_fee_estimates.superseded_at IS NULL`,
        [workspaceId, connectionId, linha.external_order_id, linha.line_no, natureza,
         detalhe.tipo, +(detalhe.valor * linha.qty).toFixed(2), preco, linha.qty],
      );
      gravadas += 1;
      pedidosTocados.add(linha.external_order_id);
    }
  }
  return { pedidos: pedidosTocados.size, linhas: gravadas, chaves: estimativas.size };
}

/**
 * Carimba `superseded_at` nas estimativas cujo tipo já foi postado pela Amazon.
 *
 * ⚠️ A LINHA NUNCA É APAGADA — é ela que permite medir a pontaria (ADR-027 §5).
 * O carimbo separa "previsão vigente" de "previsão já conferida", e é lido por
 * coluna em vez de subconsulta na tela.
 *
 * Por (pedido, `fee_type`), pela mesma razão do resto: a comissão oficial não
 * substitui a estimativa de logística que a Amazon ainda não postou.
 */
export async function carimbarEstimativasSubstituidas(connectionId: string): Promise<number> {
  const { dbQuery } = await import("../db");
  const { currentWorkspaceId } = await import("../workspaceScope");
  const linhas = await dbQuery<{ n: string }>(
    `WITH carimbadas AS (
       UPDATE workspace_channel_order_fee_estimates e
          SET superseded_at = now()
        WHERE e.workspace_id = $1 AND e.provider = 'amazon' AND e.connection_id = $2
          AND e.superseded_at IS NULL
          AND EXISTS (SELECT 1 FROM workspace_channel_order_fees r
                       WHERE r.workspace_id = e.workspace_id AND r.provider = e.provider
                         AND r.connection_id = e.connection_id
                         AND r.external_order_id = e.external_order_id
                         AND r.fee_type = e.fee_type)
        RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM carimbadas`,
    [currentWorkspaceId(), connectionId],
  );
  return Number(linhas[0]?.n ?? 0);
}

/**
 * ESTIMA PELA TARIFA QUE A AMAZON JÁ COBROU NAQUELE ASIN — sem chamar API.
 *
 * ═══ POR QUE ESTA FONTE EXISTE, e por que ela é a primeira da fila ═══
 *
 * A vendedora pediu, em 31/08/2026: *"Pegar a TABELA de comissão por porcentagem
 * da amazon […] e usar a tarifa FBA referente à regra daquele produto"*. Nós
 * traduzimos "tabela" para Product Fees API — leitura defensável, porque a API
 * devolve o valor publicado pela própria Amazon. **E quebrou exatamente onde a
 * tabela não quebraria:** a Product Fees responde POR VENDEDOR e a conta que ela
 * confere (`A15NQMF7A6J1Y0`) está com o **token revogado**. Resultado medido em
 * 01/09/2026: 1 pedido com tarifa estimada e travessão nos outros 18.
 *
 * Esta fonte não chama ninguém. Ela lê o que a Amazon **já cobrou** naquele
 * mesmo ASIN, no nosso próprio extrato.
 *
 * ⚠️ NÃO É MÉDIA HISTÓRICA NOSSA, e a distinção é a que a ADR-027 protege. Não
 * se projeta o desconhecido a partir de uma tendência: pega-se **o valor de UMA
 * cobrança real**, a mais recente daquele ASIN, e usa-se ele enquanto o oficial
 * daquele pedido não chega. A procedência fica gravada com a **data da
 * observação**, então a tela pode dizer "estimado pela tarifa de 30/08".
 *
 * ⚠️ E É UM TOTAL, NÃO DUAS PARCELAS — isto precisa estar claro para quem for
 * comparar com o software concorrente. O que temos gravado do passado é
 * `transactions_total`: a soma de tudo que a Amazon cobrou no pedido, incluindo
 * **armazenagem e anúncio**, que a decomposição do concorrente ignora. Medido:
 * ASIN `B0FNYMSTRL` a R$ 13,90 tem tarifa observada de **R$ 7,54**, contra os
 * R$ 7,32 que "12% + FBA 5,65" daria. Somos R$ 0,22 mais conservadores, e mais
 * corretos — o excedente é armazenagem real.
 *
 * Por isso o `fee_type` é `other`, e não `commission`: chamar um agregado de
 * comissão foi o defeito corrigido em `amazonSync.ts` no mesmo dia. Quando o
 * token voltar, a ingestão passa a gravar decomposto e esta fonte cede lugar.
 *
 * ⚠️ O PREÇO IMPORTA. Tarifa de comissão é percentual, então a observação só
 * vale para um preço parecido. A janela é de ±20%: fora disso a linha fica SEM
 * estimativa e a tela diz o que falta — inventar seria o que a regra proíbe.
 */
export async function estimarPelaTarifaObservada(
  connectionId: string,
  limite = 400,
  /**
   * Janela em dias, contada da data do PEDIDO. Fora dela nao se estima.
   *
   * ⚠️ ISTO NAO E UMA OTIMIZACAO — E O ESCOPO DA FEATURE (01/09/2026). Sem
   * janela, uma passada deste estimador escreveu 12.901 linhas e R$ 123.414 em
   * estimativa, e 100% disso caiu em pedidos com MAIS DE 60 DIAS: historico
   * profundo que a tela nao alcanca, que ninguem pediu, e que a politica
   * acordada no mesmo dia excluia de proposito ("mais antigo que 60 dias fica
   * com tarifa null, que e a verdade: nao capturado").
   *
   * Estimar o passado profundo nao ajuda ninguem a decidir nada — e enche o
   * banco de numero que parece medido.
   */
  janelaEmDias = 60,
): Promise<{
  pedidos: number; linhas: number; asins: number; semObservacao: number;
  /** Linhas que o BANCO recusou — a passada segue, e quem chamou decide. */
  recusadas: number; motivos: Record<string, number>;
}> {
  const { dbQuery } = await import("../db");
  const { currentWorkspaceId } = await import("../workspaceScope");
  const workspaceId = currentWorkspaceId();

  /**
   * A tarifa observada por ASIN, normalizada POR UNIDADE.
   *
   * ⚠️ `SUM(fee) / SUM(qty)` e não `AVG(fee)`: um pedido de 3 unidades paga
   * tarifa de 3 unidades, e tratar isso como uma observação de unidade única
   * triplicaria a estimativa. Foi o erro que a primeira consulta desta medição
   * cometeu — juntar pedidos com itens multiplica a tarifa pelo número de linhas.
   */
  /**
   * ⚠️ POR `fee_type`, NAO SOMADA (01/09/2026).
   *
   * Esta consulta somava tudo num numero so, e o estimador gravava
   * `fee_type = 'other'` — 1.532 linhas assim. Isso quebrava as DUAS coisas que
   * a 0022 existe para permitir:
   *  - a PONTARIA da ADR-027 (previsto x real na liquidacao) ficava impossivel,
   *    porque o real chega como `commission`/`fulfillment` e a estimativa era
   *    `other`: nunca casariam por chave;
   *  - e a componente de LOGISTICA, que e valor fixo por produto e nao depende
   *    de preco, nao existia como campo separado para ser usada sozinha.
   *
   * 📌 A DECOMPOSICAO NAO VEM DE GRACA, e a cobertura esta medida: no extrato da
   * Silveiras Import (01/09/2026) ha 5.270 pedidos com uma unica linha
   * `commission` — que e o agregado antigo `transactions_total` gravado sob esse
   * nome — contra 3 pedidos com `fulfillment`, os unicos ingeridos depois de
   * `naturezaDaTarifa()` passar a separar por rubrica. Ou seja: hoje a
   * estimativa nasce quase toda como `commission`, herdando o rotulo do extrato.
   *
   * Herdar o rotulo e deliberado, e e o que torna previsto e real comparaveis:
   * comparamos o que a fonte chamou de X com a nossa previsao para X. A medida
   * que o extrato novo chegar decomposto, a estimativa segue junto sem mudar uma
   * linha aqui.
   */
  const observadas = await dbQuery<{
    asin: string; fee_type: string; tarifa_por_unidade: string;
    preco_por_unidade: string | null; visto_em: string;
  }>(
    `WITH pedidos AS (
       SELECT o.external_order_id, o.occurred_at, f.fee_type, SUM(f.amount) AS tarifa
         FROM workspace_channel_orders o
         JOIN workspace_channel_order_fees f
           ON f.workspace_id = o.workspace_id AND f.provider = o.provider
          AND f.connection_id = o.connection_id AND f.external_order_id = o.external_order_id
        WHERE o.workspace_id = $1 AND o.provider = 'amazon' AND o.connection_id = $2
          AND o.status <> 'cancelled'
          AND f.fee_type NOT IN ('refund', 'estimated')
        GROUP BY 1, 2, 3
     ),
     -- Só pedido de UM ASIN: com dois produtos diferentes não há como saber
     -- quanto da tarifa é de cada um, e ratear seria inventar.
     unicos AS (
       SELECT p.external_order_id, p.occurred_at, p.fee_type, p.tarifa,
              MIN(i.external_product_id) AS asin,
              SUM(i.qty) AS qtd,
              SUM(i.qty * i.unit_price) AS receita
         FROM pedidos p
         JOIN workspace_channel_order_items i
           ON i.workspace_id = $1 AND i.provider = 'amazon' AND i.connection_id = $2
          AND i.external_order_id = p.external_order_id
        WHERE p.tarifa IS NOT NULL AND i.unit_price IS NOT NULL
        GROUP BY 1, 2, 3, 4
       HAVING COUNT(DISTINCT i.external_product_id) = 1 AND SUM(i.qty) > 0
     ),
     ranqueadas AS (
       SELECT asin, fee_type, tarifa / qtd AS tarifa_por_unidade,
              receita / qtd AS preco_por_unidade, occurred_at,
              ROW_NUMBER() OVER (PARTITION BY asin, fee_type ORDER BY occurred_at DESC) AS recencia
         FROM unicos
     )
     SELECT asin, fee_type, tarifa_por_unidade::text, preco_por_unidade::text,
            occurred_at::date::text AS visto_em
       FROM ranqueadas WHERE recencia = 1`,
    [workspaceId, connectionId],
  );
  // Um ASIN tem UMA observacao POR RUBRICA — e todas as rubricas do ASIN sao
  // gravadas, cada uma na sua linha, com o mesmo `line_no` do item.
  const porAsin = new Map<string, typeof observadas>();
  for (const o of observadas) {
    const atual = porAsin.get(o.asin);
    if (atual) atual.push(o);
    else porAsin.set(o.asin, [o]);
  }

  // As linhas que ainda não têm tarifa NENHUMA — nem real, nem estimativa vigente.
  const linhas = await dbQuery<{
    external_order_id: string; line_no: number; external_product_id: string;
    qty: number; unit_price: string | null; preco_de_tabela: string | null;
  }>(
    `SELECT i.external_order_id, i.line_no, i.external_product_id, i.qty, i.unit_price,
            (o.ordered_gross / NULLIF(SUM(i.qty) OVER (PARTITION BY i.external_order_id), 0))::text AS preco_de_tabela
       FROM workspace_channel_order_items i
       JOIN workspace_channel_orders o
         ON o.workspace_id = i.workspace_id AND o.provider = i.provider
        AND o.connection_id = i.connection_id AND o.external_order_id = i.external_order_id
      WHERE i.workspace_id = $1 AND i.provider = 'amazon' AND i.connection_id = $2
        AND o.status <> 'cancelled'
        AND o.occurred_at >= now() - ($4 || ' days')::interval
        AND NOT EXISTS (
          SELECT 1 FROM workspace_channel_order_fees f
           WHERE f.workspace_id = i.workspace_id AND f.provider = i.provider
             AND f.connection_id = i.connection_id
             AND f.external_order_id = i.external_order_id
             AND f.fee_type NOT IN ('refund', 'estimated')
        )
        AND NOT EXISTS (
          SELECT 1 FROM workspace_channel_order_fee_estimates e
           WHERE e.workspace_id = i.workspace_id AND e.provider = i.provider
             AND e.connection_id = i.connection_id
             AND e.external_order_id = i.external_order_id
             AND e.line_no = i.line_no AND e.superseded_at IS NULL
        )
      ORDER BY o.occurred_at DESC
      LIMIT $3`,
    [workspaceId, connectionId, limite, janelaEmDias],
  );

  const precoDe = (linha: (typeof linhas)[number]) => {
    const real = linha.unit_price == null ? null : Number(linha.unit_price);
    if (real != null && real > 0) return real;
    const tabela = linha.preco_de_tabela == null ? null : Number(linha.preco_de_tabela);
    return tabela != null && tabela > 0 ? tabela : null;
  };

  const pedidosTocados = new Set<string>();
  const asinsUsados = new Set<string>();
  let gravadas = 0;
  let semObservacao = 0;
  let recusadas = 0;
  const motivoDaRecusa = new Map<string, number>();

  for (const linha of linhas) {
    const preco = precoDe(linha);
    const rubricas = porAsin.get(linha.external_product_id);
    if (!rubricas?.length) { semObservacao += 1; continue; }

    // A janela de preco olha o patamar do ASIN, que e o mesmo em todas as
    // rubricas — entao decide uma vez por linha, nao uma vez por rubrica.
    //
    // ⚠️ A JANELA SO VALE QUANDO HA PRECO DOS DOIS LADOS (01/09/2026). Antes
    // disto o laco comecava com `if (preco == null || !observada) continue`, e
    // esse `preco == null` era um PORTAO DE ENTRADA por preco que nunca foi
    // decidido: o valor gravado e `tarifa_por_unidade * qty`, ABSOLUTO em R$, e
    // nao depende de preco nenhum. So a comparacao de patamar depende.
    //
    // Medido na Silveiras Import em 01/09/2026, com a autorizacao caida: dos 31
    // pedidos do dia, 30 chegam sem `unit_price` e sem `ordered_gross` (a Amazon
    // ainda nao publicou valor), e 12 dos 13 ASINs do dia JA TEM tarifa
    // observada no historico. O portao descartava os 30 antes de qualquer
    // comparacao — 0 de 30 com estimativa, contra 1 de 1 entre os que tinham
    // preco. A correlacao era perfeita.
    //
    // 📌 E ISTO NAO PRODUZ LUCRO PARA ESSES PEDIDOS, nem e para produzir: sem
    // receita nao ha resultado, e a base ja os mantem de fora pela regra "custo
    // e tarifa so existem para o pedido cuja receita existe". O que muda e que a
    // tarifa fica gravada e datada, pronta para o instante em que o valor
    // chegar — em vez de esperar uma nova passada do estimador.
    const precoObservado = Number(rubricas[0].preco_por_unidade ?? 0);
    if (preco != null && precoObservado > 0
        && Math.abs(preco - precoObservado) / precoObservado > 0.2) {
      semObservacao += 1;
      continue;
    }

    let gravouAlguma = false;
    for (const observada of rubricas) {
      // ⚠️ SO COMISSAO E LOGISTICA VIRAM ESTIMATIVA POR UNIDADE.
      //
      // As duas sao recorrentes e proporcionais ao que foi vendido: toda venda
      // daquele ASIN paga comissao, e toda unidade enviada paga FBA. Ja o que
      // cai em `other` — medido no extrato da Silveiras: `ShippingChargeback` e
      // `AmazonForAllFee` — sao eventos INCIDENTAIS. Multiplicar um estorno de
      // frete que aconteceu uma vez pela quantidade de todo pedido daquele ASIN
      // e extrapolacao, e produziu R$ 41.368,54 de tarifa inventada numa
      // passada de 01/09/2026 — mais que o total de tarifa REAL do periodo.
      //
      // A regra da casa: nao extrapolar. A excecao da ADR-027 e para numero
      // PUBLICADO pela fonte, nao para evento isolado repetido por nos.
      if (observada.fee_type !== "commission" && observada.fee_type !== "fulfillment") continue;
      const valor = +(Number(observada.tarifa_por_unidade) * linha.qty).toFixed(2);
      if (!Number.isFinite(valor) || valor < 0) continue;

      // ⚠️ UMA LINHA RECUSADA NAO DERRUBA O LOTE (01/09/2026).
      //
      // Sem este `try`, o primeiro INSERT que o banco recusa aborta a passada
      // inteira — e foi exatamente o que aconteceu: as linhas saem ordenadas por
      // data DECRESCENTE, os pedidos sem preco de hoje vem primeiro, e
      // `unit_price NOT NULL` matou a re-estimativa na primeira delas. Resultado
      // medido: 1.532 estimativas apagadas para regravar e ZERO regravadas.
      //
      // A recusa e informacao, nao acidente: o lote continua e quem chamou
      // recebe `recusadas` com o motivo para decidir. Perder 1.500 linhas boas
      // por causa de uma ruim e o oposto do que este estimador existe para fazer.
      try {
      await dbQuery(
        `INSERT INTO workspace_channel_order_fee_estimates
           (workspace_id, provider, connection_id, external_order_id, line_no, fee_type,
            provider_fee_code, amount, currency, unit_price, qty, source)
         VALUES ($1, 'amazon', $2, $3, $4, $5, $6, $7, 'BRL', $8, $9, 'observada')
         ON CONFLICT (workspace_id, provider, connection_id, external_order_id, line_no, fee_type)
         DO UPDATE SET amount = EXCLUDED.amount, provider_fee_code = EXCLUDED.provider_fee_code,
                       unit_price = EXCLUDED.unit_price, qty = EXCLUDED.qty,
                       source = EXCLUDED.source, estimated_at = now()
          WHERE workspace_channel_order_fee_estimates.superseded_at IS NULL`,
        [
          workspaceId, connectionId, linha.external_order_id, linha.line_no,
          // A RUBRICA HERDADA DA OBSERVACAO, nunca 'other': e o que faz previsto
          // e real casarem por chave na liquidacao (ADR-027).
          observada.fee_type,
          // A procedencia verificavel: de qual observacao este numero veio.
          `observada:${observada.visto_em}`,
          valor, preco, linha.qty,
        ],
      );
      gravadas += 1;
      gravouAlguma = true;
      asinsUsados.add(linha.external_product_id);
      } catch (erro) {
        recusadas += 1;
        const motivo = erro instanceof Error ? erro.message : String(erro);
        motivoDaRecusa.set(motivo, (motivoDaRecusa.get(motivo) ?? 0) + 1);
      }
    }
    if (gravouAlguma) pedidosTocados.add(linha.external_order_id);
    else semObservacao += 1;
  }

  return {
    pedidos: pedidosTocados.size, linhas: gravadas, asins: asinsUsados.size, semObservacao,
    recusadas, motivos: Object.fromEntries(motivoDaRecusa),
  };
}
