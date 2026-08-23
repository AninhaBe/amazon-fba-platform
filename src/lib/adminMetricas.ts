import { dbQuery, hasDb } from "./db";

// Retrato agregado do NEXO inteiro, para a tela de administração.
//
// ⚠️ Esta é a ÚNICA parte do produto que consulta SEM filtrar por workspace.
// A exceção é deliberada e está registrada em
// docs/adr/ADR-024-tela-de-administracao.md.
//
// 📌 Regra que o ADR fixa e este arquivo obedece: **só agregado**. Nenhuma
// consulta aqui devolve nome, e-mail ou faturamento de um vendedor
// identificável. Contagem e distribuição, nada mais. Se algum dia precisar
// identificar um workspace para suporte, é pelo `workspace_id` — nunca ao lado
// de dinheiro.
//
// Conexões de demonstração ficam de fora em toda consulta: são seed, e inflariam
// a leitura de adoção com conta que não é cliente.

const FORA_DEMO = "connection_id NOT LIKE '%demo%'";

export interface CanalAdmin {
  canal: string;
  conexoes: number;
  comErro: number;
  workspaces: number;
  /** Minutos desde o sync mais recente deste canal. `null` = nunca sincronizou. */
  frescorMin: number | null;
}

export interface VolumeAdmin {
  canal: string;
  pedidos30d: number;
  workspacesComVenda: number;
}

export interface AdocaoAdmin {
  workspacesTotal: number;
  comAlgumaIntegracao: number;
  comCustoCadastrado: number;
  comWatchlist: number;
}

export interface MetricasAdmin {
  canais: CanalAdmin[];
  volume: VolumeAdmin[];
  adocao: AdocaoAdmin;
  geradoEm: string;
}

export async function coletarMetricasAdmin(): Promise<MetricasAdmin | null> {
  if (!hasDb()) return null;

  const [canais, volume, adocao] = await Promise.all([
    // ⚠️ A fonte é `workspace_marketplace_syncs`, NÃO `workspace_integrations`.
    //
    // Medido em 23/08/2026: `workspace_integrations` só tinha Mercado Livre real
    // — Amazon e TikTok não se registram lá (a Amazon autentica por LWA na conta,
    // não por conexão OAuth). Usar aquela tabela mostraria "Amazon: 0 conexões"
    // com 3 contas sincronizando. A tabela de syncs é a única onde TODO canal
    // aparece, e é por isso que ela é a fonte aqui.
    dbQuery<{ canal: string; conexoes: string; com_erro: string; workspaces: string; frescor_min: string | null }>(
      `SELECT provider AS canal,
              COUNT(*)::text                                     AS conexoes,
              COUNT(*) FILTER (WHERE status = 'error')::text      AS com_erro,
              COUNT(DISTINCT workspace_id)::text                  AS workspaces,
              MIN(EXTRACT(EPOCH FROM (now() - COALESCE(last_success_at, updated_at))) / 60)::int::text AS frescor_min
         FROM workspace_marketplace_syncs
        WHERE ${FORA_DEMO}
        GROUP BY provider
        ORDER BY COUNT(*) DESC`
    ),
    dbQuery<{ canal: string; pedidos: string; workspaces: string }>(
      `SELECT provider AS canal,
              COUNT(*)::text                       AS pedidos,
              COUNT(DISTINCT workspace_id)::text   AS workspaces
         FROM workspace_channel_orders
        WHERE occurred_at > now() - interval '30 days'
          AND status <> 'cancelled'
          AND ${FORA_DEMO}
        GROUP BY provider
        ORDER BY COUNT(*) DESC`
    ),
    dbQuery<{ total: string; com_integracao: string; com_custo: string; com_watchlist: string }>(
      // Uma consulta só: quatro contagens sobre o mesmo universo de workspaces.
      `SELECT (SELECT COUNT(DISTINCT workspace_id) FROM workspace_marketplace_syncs)::text AS total,
              -- Mesma razão da consulta acima: só a tabela de syncs vê todos os canais.
              (SELECT COUNT(DISTINCT workspace_id) FROM workspace_marketplace_syncs
                WHERE connection_id NOT LIKE '%demo%')::text                          AS com_integracao,
              (SELECT COUNT(DISTINCT workspace_id) FROM workspace_product_costs
                WHERE cost > 0)::text                                                 AS com_custo,
              (SELECT COUNT(DISTINCT workspace_id) FROM workspace_rank_history)::text AS com_watchlist`
    ),
  ]);

  const n = (v: string | null | undefined) => Number(v ?? 0);
  const a = adocao[0];
  return {
    canais: canais.map((c) => ({
      canal: c.canal,
      conexoes: n(c.conexoes),
      comErro: n(c.com_erro),
      workspaces: n(c.workspaces),
      // `null` quando o canal nunca sincronizou — não é "zero minutos".
      frescorMin: c.frescor_min == null ? null : n(c.frescor_min),
    })),
    volume: volume.map((v) => ({
      canal: v.canal,
      pedidos30d: n(v.pedidos),
      workspacesComVenda: n(v.workspaces),
    })),
    adocao: {
      workspacesTotal: n(a?.total),
      comAlgumaIntegracao: n(a?.com_integracao),
      comCustoCadastrado: n(a?.com_custo),
      comWatchlist: n(a?.com_watchlist),
    },
    geradoEm: new Date().toISOString(),
  };
}
