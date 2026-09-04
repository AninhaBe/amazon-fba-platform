import { dbQuery } from "../db";
import { currentWorkspaceId } from "../workspaceScope";

const PROVIDER = "mercado_livre";

/**
 * JANELA DA CONCILIAÇÃO DE FRETE DO ML — e por que ela existe.
 *
 * ⚠️ Esta consulta era o MAIOR consumidor de IO do banco: 88 GB de leitura
 * desde 15/07/2026, **35% de todo o disco lido**, a 5,9–12,3 segundos por
 * chamada, ~90 vezes por dia. Medido em 04/09/2026 no `pg_stat_statements` de
 * produção, depois do alerta de Disk IO Budget do Supabase.
 *
 * A causa não era o índice: o `EXPLAIN` mostra um Nested Loop Anti Join com
 * **38.113 iterações** — todo pedido pago desde 23/07/2025 — que devolvia
 * **zero linhas**. Não havia um único envio faltando na tabela inteira. Ela
 * pagava a varredura do histórico completo, a cada passo do sync, para não
 * achar nada.
 *
 * Medido nos três cenários, contra produção:
 *
 *   sem janela ....... 5859 ms | 255.240 buffers
 *   janela 30 dias .... 378 ms |  64.958 buffers   (−94% tempo, −75% buffers)
 *   janela  7 dias .....  40 ms |  27.396 buffers
 *
 * 📌 E O QUE A JANELA CUSTA, dito na cara: um envio que falhe por mais de 30
 * dias sai do alcance do caminho quente e ficaria invisível. Trocar IO por
 * buraco silencioso seria pior que o problema — por isso a janela **não vem
 * sozinha**: `contarFreteFaltandoNoHistorico` varre o histórico inteiro uma vez
 * por dia e alarma se achar qualquer coisa. A garantia continua de pé; o que
 * mudou foi a frequência com que ela é paga.
 */
export const JANELA_DE_FRETE_DIAS = 30;

/** De quanto em quanto tempo o histórico completo é varrido. */
export const INTERVALO_DA_VARREDURA_COMPLETA_MS = 24 * 60 * 60_000;

export type EnvioFaltando = { shipment_id: string; order_ids: string[] };

/**
 * Envios sem custo conciliado DENTRO da janela — o caminho quente, o que roda a
 * cada passo do sync.
 */
export async function enviosFaltandoNaJanela(
  connectionId: string,
  limite: number,
  dias: number = JANELA_DE_FRETE_DIAS
): Promise<EnvioFaltando[]> {
  return dbQuery<EnvioFaltando>(
    `SELECT orders.payload #>> '{shipping,id}' AS shipment_id,
            array_agg(orders.external_order_id) AS order_ids
       FROM workspace_marketplace_orders orders
       LEFT JOIN workspace_marketplace_shipments shipments
         ON shipments.workspace_id = orders.workspace_id
        AND shipments.provider = orders.provider
        AND shipments.connection_id = orders.connection_id
        AND shipments.external_shipment_id = orders.payload #>> '{shipping,id}'
      WHERE orders.workspace_id = $1 AND orders.provider = $2 AND orders.connection_id = $3
        AND orders.occurred_at > now() - ($5 || ' days')::interval
        AND orders.status = 'paid' AND orders.payload #>> '{shipping,id}' IS NOT NULL
        AND shipments.external_shipment_id IS NULL
      GROUP BY shipment_id
      ORDER BY shipment_id DESC
      LIMIT $4`,
    [currentWorkspaceId(), PROVIDER, connectionId, limite, String(dias)]
  );
}

/**
 * Envios sem custo conciliado FORA da janela — o histórico completo.
 *
 * Só CONTA. Não busca, não grava: a pergunta que ela responde é "a janela está
 * escondendo alguma coisa?", e a resposta honesta a essa pergunta é um número.
 */
export async function contarFreteFaltandoNoHistorico(
  connectionId: string,
  dias: number = JANELA_DE_FRETE_DIAS
): Promise<number> {
  const [linha] = await dbQuery<{ faltando: string }>(
    `SELECT count(DISTINCT orders.payload #>> '{shipping,id}')::text AS faltando
       FROM workspace_marketplace_orders orders
       LEFT JOIN workspace_marketplace_shipments shipments
         ON shipments.workspace_id = orders.workspace_id
        AND shipments.provider = orders.provider
        AND shipments.connection_id = orders.connection_id
        AND shipments.external_shipment_id = orders.payload #>> '{shipping,id}'
      WHERE orders.workspace_id = $1 AND orders.provider = $2 AND orders.connection_id = $3
        AND orders.occurred_at <= now() - ($4 || ' days')::interval
        AND orders.status = 'paid' AND orders.payload #>> '{shipping,id}' IS NOT NULL
        AND shipments.external_shipment_id IS NULL`,
    [currentWorkspaceId(), PROVIDER, connectionId, String(dias)]
  );
  return Number(linha?.faltando ?? 0);
}

/**
 * Decisão PURA: já passou o intervalo da varredura completa?
 *
 * `undefined` = nunca varreu neste processo. Vale varrer: um deploy zera a
 * lembrança, e pagar a varredura completa uma vez por deploy é barato perto de
 * pagá-la 90 vezes por dia.
 */
export function deveVarrerHistoricoCompleto(
  ultimaVarreduraMs: number | undefined,
  agoraMs: number,
  intervaloMs: number = INTERVALO_DA_VARREDURA_COMPLETA_MS
): boolean {
  if (ultimaVarreduraMs === undefined) return true;
  return agoraMs - ultimaVarreduraMs >= intervaloMs;
}

/**
 * Texto do alarme, ou `null` quando não há o que alarmar.
 *
 * ⚠️ Separado da consulta de propósito: alarme que só existe dentro de um `if`
 * no meio do sync não pode ser testado sem banco, e alarme não testado é alarme
 * que ninguém sabe se toca.
 */
export function alarmeDeFreteForaDaJanela(
  connectionId: string,
  faltando: number,
  dias: number = JANELA_DE_FRETE_DIAS
): string | null {
  if (faltando <= 0) return null;
  return `[frete-ml] ${connectionId}: ${faltando} envio(s) sem custo conciliado FORA da janela de ${dias} dias`
    + ` — o caminho quente nao alcanca estes; conciliar a mao ou ampliar a janela`;
}
