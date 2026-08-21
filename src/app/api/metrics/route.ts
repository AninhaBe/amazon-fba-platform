import { NextRequest, NextResponse } from "next/server";
import { dbQuery, hasDb } from "@/lib/db";

// Métricas em formato Prometheus — coletadas pelo Fly a cada 15s e visíveis no
// Grafana gerenciado (fly-metrics.net), sem custo adicional.
//
// Por que existe (ADR-019): ao desligar o cron do GitHub em 21/08/2026, sumiu o
// único sinal de "o sync parou" — o e-mail de falha do Actions. O dado sempre
// esteve em `workspace_marketplace_syncs`, só que ninguém olhava. Aqui ele vira
// série temporal com alerta possível.
//
// ⚠️ Rota PÚBLICA por exigência do coletor do Fly, então só expõe contadores
// operacionais: idade do sync, contagem de pedidos por status, tamanho da fila.
// Nada de valor financeiro, nome de produto, id de pedido ou de conta.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SyncRow {
  provider: string;
  status: string;
  segundos: string | null;
}
interface FilaRow {
  status: string;
  total: string;
}
interface PendenteRow {
  provider: string;
  pendentes: string;
  atrasados: string;
}

function linha(nome: string, rotulos: Record<string, string>, valor: number | string) {
  const r = Object.entries(rotulos)
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, "")}"`)
    .join(",");
  return `${nome}{${r}} ${valor}`;
}

export async function GET(_req: NextRequest) {
  if (!hasDb()) {
    return new NextResponse("# banco indisponivel\n", {
      headers: { "content-type": "text/plain; version=0.0.4" },
    });
  }

  const saida: string[] = [];
  try {
    // 1. Idade do último sync bem-sucedido, por conexão. É ESTA a métrica que
    //    substitui o e-mail de falha do GitHub: se parar de cair, alguém parou.
    const syncs = await dbQuery<SyncRow>(
      `SELECT provider, status,
              EXTRACT(EPOCH FROM (now() - COALESCE(last_success_at, updated_at)))::text AS segundos
         FROM workspace_marketplace_syncs`
    );
    saida.push("# HELP nexo_sync_idade_segundos Tempo desde o ultimo sync bem-sucedido por conexao.");
    saida.push("# TYPE nexo_sync_idade_segundos gauge");
    for (const s of syncs) {
      saida.push(linha("nexo_sync_idade_segundos", { provider: s.provider, status: s.status }, Math.round(Number(s.segundos ?? 0))));
    }

    // 2. Pedidos presos em `pending`. Passar de algumas dezenas por mais de umas
    //    horas foi exatamente o defeito de 21/08 (55 de 62 pedidos travados) que
    //    fez o dashboard parecer queda de vendas.
    const pendentes = await dbQuery<PendenteRow>(
      `SELECT provider,
              COUNT(*) FILTER (WHERE status = 'pending')::text AS pendentes,
              COUNT(*) FILTER (WHERE status = 'pending' AND occurred_at < now() - interval '12 hours')::text AS atrasados
         FROM workspace_channel_orders
        WHERE occurred_at > now() - interval '30 days'
        GROUP BY provider`
    );
    saida.push("# HELP nexo_pedidos_pendentes Pedidos aguardando confirmacao do canal.");
    saida.push("# TYPE nexo_pedidos_pendentes gauge");
    saida.push("# HELP nexo_pedidos_pendentes_atrasados Pendentes ha mais de 12h — suspeita de lag de ingestao.");
    saida.push("# TYPE nexo_pedidos_pendentes_atrasados gauge");
    for (const p of pendentes) {
      saida.push(linha("nexo_pedidos_pendentes", { provider: p.provider }, p.pendentes));
      saida.push(linha("nexo_pedidos_pendentes_atrasados", { provider: p.provider }, p.atrasados));
    }

    // 3. Fila de webhooks — a tabela que estourou o banco em 19/08 (ADR-016).
    const fila = await dbQuery<FilaRow>(
      `SELECT status, COUNT(*)::text AS total FROM workspace_marketplace_events GROUP BY status`
    );
    saida.push("# HELP nexo_fila_eventos Eventos na caixa de entrada de webhooks, por status.");
    saida.push("# TYPE nexo_fila_eventos gauge");
    for (const f of fila) saida.push(linha("nexo_fila_eventos", { status: f.status }, f.total));

    // 4. Tamanho do banco — o limite do plano é 500 MB e já foi estourado uma vez.
    const [tam] = await dbQuery<{ bytes: string }>(
      `SELECT pg_database_size(current_database())::text AS bytes`
    );
    saida.push("# HELP nexo_banco_bytes Tamanho do banco de dados.");
    saida.push("# TYPE nexo_banco_bytes gauge");
    saida.push(`nexo_banco_bytes ${tam?.bytes ?? 0}`);

    saida.push("nexo_metricas_ok 1");
  } catch {
    // Falhar aqui não pode derrubar o coletor: devolve o marcador em zero, que
    // por si só já é alertável.
    saida.push("nexo_metricas_ok 0");
  }

  return new NextResponse(saida.join("\n") + "\n", {
    headers: { "content-type": "text/plain; version=0.0.4" },
  });
}
