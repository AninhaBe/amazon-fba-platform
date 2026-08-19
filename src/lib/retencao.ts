import { dbQuery } from "./db";

/**
 * Retenção de dados efêmeros — ver ADR-016.
 *
 * `workspace_marketplace_events` é a caixa de entrada de webhooks do Mercado Livre.
 * Entram ~8.000 eventos/dia e nada saía: em 29 dias a tabela chegou a 172 MB, a maior
 * do banco. Fila sem expurgo cresce para sempre por construção.
 *
 * Só remove evento **processado com sucesso**. `error` e `processing` nunca são
 * removidos — são justamente os que alguém precisa investigar (ADR-016, regra 5).
 *
 * ⚠️ `DELETE` não devolve espaço em disco ao sistema: o espaço volta para
 * reaproveitamento interno do Postgres, mas o tamanho medido só cai com `VACUUM FULL`
 * (que trava a tabela) ou `pg_repack`. O ganho real aqui é **parar de crescer**.
 *
 * O destino é particionar por mês e trocar isto por `DROP PARTITION` (ADR-016).
 */

/**
 * Dias que um evento processado permanece antes do expurgo.
 *
 * 7 dias porque o evento ja cumpriu a funcao no minuto em que virou pedido canonico.
 * O que resta serve para deduplicar reentrega do ML (que acontece em horas) e para
 * forense recente. Medido em 19/08: 30 dias nao removeria nada (a tabela tinha 29
 * dias de historico) e estabilizaria em ~240 mil linhas — mais do que ja havia.
 *
 *   7 dias  -> estabiliza em ~56 mil linhas (~48 MB)
 *  14 dias  -> ~104 mil linhas (~90 MB)
 *  30 dias  -> ~240 mil linhas (~210 MB)  <- pior que o problema
 */
export const RETENCAO_EVENTOS_DIAS = 7;

/** Teto por execução: evita transação longa e lock demorado numa tabela quente. */
const LOTE_MAXIMO = 20_000;

export type ResultadoRetencao = {
  tabela: string;
  removidas: number;
  restantes: number;
  aindaElegiveis: number;
  duracaoMs: number;
};

export async function expurgarEventosProcessados(
  dias: number = RETENCAO_EVENTOS_DIAS
): Promise<ResultadoRetencao> {
  const inicio = performance.now();

  // ctid é o identificador físico da linha; usar aqui evita depender de PK
  // (a tabela não tem uma) e mantém o DELETE limitado ao lote.
  const removidas = await dbQuery<{ count: string }>(
    `WITH alvo AS (
       SELECT ctid FROM workspace_marketplace_events
       WHERE status = 'complete'
         AND processed_at IS NOT NULL
         AND processed_at < now() - ($1 || ' days')::interval
       LIMIT $2
     )
     DELETE FROM workspace_marketplace_events e
     USING alvo WHERE e.ctid = alvo.ctid
     RETURNING 1`,
    [String(dias), LOTE_MAXIMO]
  );

  const [contagem] = await dbQuery<{ restantes: string; elegiveis: string }>(
    `SELECT count(*) AS restantes,
            count(*) FILTER (
              WHERE status = 'complete'
                AND processed_at IS NOT NULL
                AND processed_at < now() - ($1 || ' days')::interval
            ) AS elegiveis
       FROM workspace_marketplace_events`,
    [String(dias)]
  );

  return {
    tabela: "workspace_marketplace_events",
    removidas: removidas.length,
    restantes: Number(contagem?.restantes ?? 0),
    // Se sobrou elegível, o lote encheu: a próxima execução do cron continua.
    aindaElegiveis: Number(contagem?.elegiveis ?? 0),
    duracaoMs: Math.round(performance.now() - inicio),
  };
}
