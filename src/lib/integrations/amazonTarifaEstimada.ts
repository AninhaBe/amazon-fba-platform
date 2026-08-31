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
 * Persiste a tarifa estimada dos pedidos que ainda não têm tarifa REAL.
 *
 * ⚠️ COEXISTE COM A REAL, NÃO SOBRESCREVE (ADR-027). A chave primária de
 * `workspace_channel_order_fees` inclui `fee_type` e `provider_fee_code`, então
 * a estimativa entra como `fee_type = 'estimated'` ao lado da comissão real
 * quando ela chegar. É isso que permite medir a pontaria depois — e é por isso
 * que nenhuma migration foi necessária.
 *
 * ⚠️ SÓ PARA PEDIDO SEM TARIFA REAL. Um pedido já liquidado tem a tarifa da
 * Amazon; estimar por cima somaria duas vezes na leitura, que soma `fees` sem
 * distinguir. A consulta abaixo exclui quem já tem qualquer tarifa que não seja
 * estorno.
 *
 * ⚠️ E O PREÇO É O DO PEDIDO, NÃO O DE HOJE (ADR-027). Vem de `unit_price`
 * quando a Amazon já expôs, ou de `ordered_gross / qty` — o preço de tabela do
 * próprio pedido, capturado do relatório All Orders. Nunca o preço atual do
 * catálogo: a tarifa que interessa é a daquela venda.
 */
export async function estimarTarifaDosPedidosSemTarifa(
  connectionId: string,
  limite = 200,
): Promise<{ pedidos: number; linhas: number; chaves: number }> {
  const { dbQuery } = await import("../db");
  const { currentWorkspaceId } = await import("../workspaceScope");
  const workspaceId = currentWorkspaceId();

  const linhas = await dbQuery<{
    external_order_id: string; external_product_id: string; qty: number;
    unit_price: string | null; preco_de_tabela: string | null;
  }>(
    `SELECT i.external_order_id, i.external_product_id, i.qty, i.unit_price,
            (o.ordered_gross / NULLIF(SUM(i.qty) OVER (PARTITION BY i.external_order_id), 0))::text AS preco_de_tabela
       FROM workspace_channel_order_items i
       JOIN workspace_channel_orders o
         ON o.workspace_id = i.workspace_id AND o.provider = i.provider
        AND o.connection_id = i.connection_id AND o.external_order_id = i.external_order_id
      WHERE i.workspace_id = $1 AND i.provider = 'amazon' AND i.connection_id = $2
        AND NOT EXISTS (
          SELECT 1 FROM workspace_channel_order_fees f
           WHERE f.workspace_id = i.workspace_id AND f.provider = i.provider
             AND f.connection_id = i.connection_id AND f.external_order_id = i.external_order_id
             AND f.fee_type NOT IN ('refund', 'estimated')
        )
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

  // Soma por pedido e por tipo de tarifa da Amazon: uma linha por
  // (pedido, 'estimated', ReferralFee/FBAFees/…), preservando a decomposição que
  // vira a procedência no tooltip. Recalcular o total por fora daria outro número.
  const porPedido = new Map<string, Map<string, number>>();
  for (const linha of comPreco) {
    const estimativa = estimativas.get(chaveDe({ asin: linha.external_product_id, preco: precoDe(linha)! }));
    if (!estimativa) continue;
    const tipos = porPedido.get(linha.external_order_id) ?? new Map<string, number>();
    for (const detalhe of estimativa.detalhes) {
      tipos.set(detalhe.tipo, +((tipos.get(detalhe.tipo) ?? 0) + detalhe.valor * linha.qty).toFixed(2));
    }
    porPedido.set(linha.external_order_id, tipos);
  }

  let gravadas = 0;
  for (const [pedido, tipos] of porPedido) {
    for (const [tipo, valor] of tipos) {
      await dbQuery(
        `INSERT INTO workspace_channel_order_fees
           (workspace_id, provider, connection_id, external_order_id, fee_type, provider_fee_code, amount, currency)
         VALUES ($1, 'amazon', $2, $3, 'estimated', $4, $5, 'BRL')
         ON CONFLICT (workspace_id, provider, connection_id, external_order_id, fee_type, provider_fee_code)
         DO UPDATE SET amount = EXCLUDED.amount
          WHERE workspace_channel_order_fees.amount IS DISTINCT FROM EXCLUDED.amount`,
        [workspaceId, connectionId, pedido, tipo, valor],
      );
      gravadas += 1;
    }
  }
  return { pedidos: porPedido.size, linhas: gravadas, chaves: estimativas.size };
}
