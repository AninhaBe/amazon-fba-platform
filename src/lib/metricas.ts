import { dbQuery, hasDb } from "./db";
import { limiteDeSilencioMs } from "./integrations/cadenciaDoSync";

// Métricas operacionais em formato Prometheus.
//
// Por que existem (ADR-019): ao desligar o cron do GitHub em 21/08/2026, sumiu o
// único sinal de "o sync parou" — o e-mail de falha do Actions. O dado sempre
// esteve em `workspace_marketplace_syncs`; aqui vira série temporal, com
// histórico e alerta possível no Grafana gerenciado do Fly.
//
// ⚠️ Servidas numa porta INTERNA (ver src/instrumentation.ts), nunca pela porta
// pública do app: contagem de pedidos e tamanho de banco são dado de negócio, e
// o coletor do Fly alcança a máquina pela rede privada. Ainda assim, nada aqui
// tem valor financeiro, nome de produto nem identificador de conta.

interface SyncRow { provider: string; frescor: string | null; com_erro: string; conexoes: string }
interface PendenteRow { provider: string; pendentes: string; atrasados: string }
interface FilaRow { status: string; total: string }

/**
 * Escreve uma família de métricas inteira: HELP, TYPE e TODAS as amostras juntas.
 *
 * O formato Prometheus exige que as amostras de uma métrica sejam consecutivas.
 * Emitir intercalado é o tipo de erro que não quebra nada visivelmente — o
 * coletor simplesmente entrega dado errado, e foi assim que o rótulo `provider`
 * desapareceu na primeira versão desta rota.
 */
// ⚠️ O rótulo NÃO pode se chamar `provider`: o coletor do Fly descarta esse nome
// (medido 21/08 — a série chegava no Prometheus sem rótulo nenhum, enquanto
// `status` passava normalmente). Usamos `canal`, que também é a palavra do
// produto. Ao criar métrica nova, conferir no Grafana se o rótulo sobreviveu.
function familia(
  saida: string[],
  nome: string,
  ajuda: string,
  amostras: Array<[Record<string, string>, number | string]>
) {
  saida.push(`# HELP ${nome} ${ajuda}`);
  saida.push(`# TYPE ${nome} gauge`);
  for (const [rotulos, valor] of amostras) saida.push(linha(nome, rotulos, valor));
}

function linha(nome: string, rotulos: Record<string, string>, valor: number | string) {
  const r = Object.entries(rotulos)
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, "")}"`)
    .join(",");
  return `${nome}{${r}} ${valor}`;
}

export async function coletarMetricas(): Promise<string> {
  if (!hasDb()) return "nexo_metricas_ok 0\n";

  const saida: string[] = [];
  try {
    // 1. Idade do último sync bem-sucedido. É ESTA que substitui o e-mail de
    //    falha do GitHub: se parar de cair, alguém parou de trabalhar.
    // Agregado POR PROVEDOR, não por conexão: emitir uma linha por conexão
    // criava séries com rótulos idênticos (várias conexões do mesmo provedor no
    // mesmo status), e séries duplicadas colidem no Prometheus — foi assim que o
    // rótulo `provider` sumiu na primeira coleta (21/08). Agregar também evita
    // colocar identificador de conta numa métrica.
    //
    // MIN = a conexão MAIS FRESCA do provedor: responde "este canal está
    // sincronizando?". Conexão quebrada isolada aparece em `com_erro`, abaixo.
    // Demo fica de fora: é seed, nunca sincroniza, e dispararia alarme eterno.
    const syncs = await dbQuery<SyncRow>(
      `SELECT provider,
              MIN(EXTRACT(EPOCH FROM (now() - COALESCE(last_success_at, updated_at))))::text AS frescor,
              COUNT(*) FILTER (WHERE status = 'error')::text AS com_erro,
              COUNT(*)::text AS conexoes
         FROM workspace_marketplace_syncs
        WHERE connection_id NOT LIKE '%demo%'
        GROUP BY provider`
    );
    // ⚠️ Uma família por vez, com TODAS as amostras juntas logo após o TYPE.
    // Intercalar famílias (as 3 métricas do amazon, depois as 3 do tiktok...) é
    // formato inválido: o coletor do Fly engoliu isso e devolveu UMA série SEM
    // rótulo nenhum — o `provider` sumiu (medido 21/08). O helper `familia`
    // abaixo existe para essa regra não depender de disciplina.
    familia(saida, "nexo_sync_idade_segundos", "Tempo desde o sync mais recente do provedor.",
      syncs.map((s) => [{ canal: s.provider }, Math.round(Number(s.frescor ?? 0))]));
    familia(saida, "nexo_sync_conexoes_com_erro", "Conexoes do provedor em estado de erro.",
      syncs.map((s) => [{ canal: s.provider }, s.com_erro]));
    familia(saida, "nexo_sync_conexoes", "Conexoes configuradas por provedor.",
      syncs.map((s) => [{ canal: s.provider }, s.conexoes]));

    // ⚠️ O LIMITE VIRA SÉRIE PARA O ALERTA NÃO TER NÚMERO DIGITADO (02/09/2026).
    //
    // Sem isto, a regra no Grafana seria `nexo_sync_idade_segundos > 900` — e
    // esse 900 é uma SEGUNDA fonte da verdade, num lugar que nenhum teste alcança
    // e que ninguém revisa junto com o código. No dia em que a cadência da Shopee
    // mudar de 3 para 10 minutos, o alerta continua com o número velho e passa a
    // gritar sozinho — até alguém desligá-lo, que é como alarme morre.
    //
    // Com as duas séries, a regra é `nexo_sync_idade_segundos >
    // nexo_sync_limite_segundos`: muda a cadência em `cadenciaDoSync.ts`, muda o
    // alerta no mesmo deploy. É a mesma regra que fez o vigia derivar o limite em
    // vez de copiá-lo — dois lugares que coincidem hoje é como um fica para trás.
    familia(saida, "nexo_sync_limite_segundos", "Limite de silencio do canal antes de alarmar.",
      syncs.map((s) => [{ canal: s.provider }, Math.round(limiteDeSilencioMs(s.provider) / 1000)]));

    // 2. Pedidos presos em `pending`. Dezenas parados por horas foi exatamente o
    //    defeito de 21/08 (55 de 62 travados) que fez o dashboard parecer queda
    //    de vendas quando o volume estava normal.
    const pendentes = await dbQuery<PendenteRow>(
      `SELECT provider,
              COUNT(*) FILTER (WHERE status = 'pending')::text AS pendentes,
              COUNT(*) FILTER (WHERE status = 'pending' AND occurred_at < now() - interval '12 hours')::text AS atrasados
         FROM workspace_channel_orders
        WHERE occurred_at > now() - interval '30 days'
          AND connection_id NOT LIKE '%demo%'
        GROUP BY provider`
    );
    familia(saida, "nexo_pedidos_pendentes", "Pedidos aguardando confirmacao do canal.",
      pendentes.map((p) => [{ canal: p.provider }, p.pendentes]));
    familia(saida, "nexo_pedidos_pendentes_atrasados", "Pendentes ha mais de 12h - suspeita de lag de ingestao.",
      pendentes.map((p) => [{ canal: p.provider }, p.atrasados]));

    // 3. Fila de webhooks — a tabela que estourou o banco em 19/08 (ADR-016).
    const fila = await dbQuery<FilaRow>(
      `SELECT status, COUNT(*)::text AS total FROM workspace_marketplace_events GROUP BY status`
    );
    familia(saida, "nexo_fila_eventos", "Eventos na caixa de entrada de webhooks.",
      fila.map((f) => [{ status: f.status }, f.total]));

    // 4. Tamanho do banco — o limite do plano é 500 MB e já foi estourado.
    const [tam] = await dbQuery<{ bytes: string }>(`SELECT pg_database_size(current_database())::text AS bytes`);
    saida.push("# HELP nexo_banco_bytes Tamanho do banco de dados.");
    saida.push("# TYPE nexo_banco_bytes gauge");
    saida.push(`nexo_banco_bytes ${tam?.bytes ?? 0}`);

    saida.push("nexo_metricas_ok 1");
  } catch {
    // Falhar aqui não pode derrubar o coletor. O zero já é alertável por si só.
    saida.push("nexo_metricas_ok 0");
  }
  return saida.join("\n") + "\n";
}
