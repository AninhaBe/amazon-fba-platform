import { dbQuery, hasDb } from "../db";
import { currentAccount } from "../accountContext";
import { getIntegrations } from "./integrationStore";
import { currentWorkspaceId } from "../workspaceScope";
import { amazonConnectionId } from "./amazonSync";
import type { Period } from "../period";

// Vive em `integrations/` porque consulta um canal por nome — regra do projeto,
// coberta por tests/providerIsolation.test.mjs.
//
// O MESMO faturamento que o dashboard mostra, para o monitor poder começar dele.
//
// O monitor abria em "Receita conciliada" e o dashboard em "Faturamento", com
// valores diferentes e nenhuma ponte — ela cobrou: *"não bate ainda, tem que vir
// o mesmo dado"* (23/08/2026).
//
// Não eram duas verdades nem duas fontes de verdade: medido no banco, a mesma
// tabela produz os dois números. `COALESCE(gross, ordered_gross)` dá os
// R$ 474,72 do dashboard; `SUM(gross)` sozinho dá os R$ 452,61 do monitor. A
// diferença inteira é o pedido que a Amazon ainda não valorizou — um só, de
// R$ 22,11, parado em `Pending` havia cinco dias.
//
// Com estes campos a cascata do monitor passa a partir do número que ela já
// conhece e a descontar a parte pendente À VISTA, em vez de simplesmente
// começar mais baixo sem dizer por quê.

export interface FaturamentoCanonico {
  /** Tudo que foi vendido no período (inclui pendente). Igual ao dashboard. */
  faturamentoPeriodo: number;
  /** Pedidos do período, cancelados fora. */
  pedidosPeriodo: number;
  /** Parte do faturamento que a Amazon ainda não valorizou. */
  aguardandoConfirmacao: number;
  /** Quantos pedidos compõem `aguardandoConfirmacao`. */
  pedidosAguardando: number;
}

interface Linha {
  faturamento: string | null;
  pedidos: string;
  aguardando: string | null;
  pedidos_aguardando: string;
}

async function conexaoAtiva(): Promise<string | null> {
  const account = currentAccount();
  if (account) return amazonConnectionId(account.sellerId);
  const conectadas = (await getIntegrations("amazon")).filter((conexao) => conexao.status === "connected");
  return conectadas[0]?.id ?? null;
}

/**
 * `null` quando não há banco ou conexão — o chamador então mantém o
 * comportamento antigo em vez de exibir zero, que seria afirmar "não vendeu".
 */
export async function faturamentoDoPeriodo(period: Period): Promise<FaturamentoCanonico | null> {
  if (!hasDb()) return null;
  const connectionId = await conexaoAtiva();
  if (!connectionId) return null;

  const linhas = await dbQuery<Linha>(
    `SELECT COALESCE(SUM(COALESCE(gross, ordered_gross)), 0)::text AS faturamento,
            COUNT(*)::text                                        AS pedidos,
            -- O que ainda não tem valor confirmado pela Amazon: o pedido existe
            -- e tem preço de tabela, mas gross (o valor que ela postou) é nulo.
            COALESCE(SUM(ordered_gross) FILTER (WHERE gross IS NULL), 0)::text AS aguardando,
            COUNT(*) FILTER (WHERE gross IS NULL)::text            AS pedidos_aguardando
       FROM workspace_channel_orders
      WHERE workspace_id = $1 AND provider = 'amazon' AND connection_id = $2
        AND occurred_at BETWEEN $3 AND $4
        AND status <> 'cancelled'`,
    [currentWorkspaceId(), connectionId, period.startISO, period.endISO]
  );
  const l = linhas[0];
  if (!l) return null;
  return {
    faturamentoPeriodo: +Number(l.faturamento ?? 0).toFixed(2),
    pedidosPeriodo: Number(l.pedidos ?? 0),
    aguardandoConfirmacao: +Number(l.aguardando ?? 0).toFixed(2),
    pedidosAguardando: Number(l.pedidos_aguardando ?? 0),
  };
}
