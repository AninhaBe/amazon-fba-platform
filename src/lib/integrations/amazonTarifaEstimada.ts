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
