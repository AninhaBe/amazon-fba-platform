import { dbQuery, hasDb } from "../db";
import { runWithWorkspace } from "../workspaceScope";
import { getIntegration } from "./integrationStore";
import { coletarAdsDoMercadoLivre, type ResultadoDaColeta } from "./mercadoLivreAdsSync";
import { filtroDeAcessoLiberado } from "./assinaturaPausaSync";

/**
 * Um ciclo de coleta de Product Ads para todas as conexões vivas do ML.
 *
 * ⚠️ SÍNCRONO, ao contrário da Amazon: não há relatório para pedir e colher
 * depois, então este passo faz tudo. Best-effort por conexão — falha de uma
 * não pode calar as outras (mesmo princípio do `runScheduledAdsSync`).
 *
 * A janela é curta de propósito: o PADS aceita 90 dias para trás, mas recolher
 * tudo a cada ciclo seria reescrever o passado inteiro sem motivo. Aqui pegamos
 * a janela recente, que é a que muda — o histórico só precisa de uma passada.
 */

const PROVIDER = "mercado_livre";
const DIAS_DA_JANELA = 7;

function diaEmBrasilia(deslocamentoDias = 0): string {
  return new Date(Date.now() - 3 * 60 * 60_000 - deslocamentoDias * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export interface ResultadoDoCicloDeAds {
  connectionId: string;
  gravadas: number;
  duplicadasIgnoradas: number;
  /** `false` quando a soma dos anúncios não bate com a das campanhas. */
  confere: boolean | null;
  erro?: string;
}

export async function runScheduledMercadoLivreAds(): Promise<ResultadoDoCicloDeAds[]> {
  if (!hasDb()) return [];

  const filtroDeAcesso = await filtroDeAcessoLiberado("sync");
  const conexoes = await dbQuery<{ workspace_id: string; connection_id: string }>(
    `SELECT sync.workspace_id::text AS workspace_id, sync.connection_id
       FROM workspace_marketplace_syncs sync
       JOIN workspace_integrations integration
         ON integration.workspace_id = sync.workspace_id
        AND integration.id = sync.connection_id
        AND integration.provider = sync.provider
      WHERE sync.provider = $1
        AND ${filtroDeAcesso}
        AND integration.status = 'connected'
        -- Demo nunca vai à API real (mesmo predicado do scheduler de sync).
        AND integration.metadata->'demo' IS DISTINCT FROM 'true'::jsonb`,
    [PROVIDER],
  );

  const resultados: ResultadoDoCicloDeAds[] = [];
  for (const conexao of conexoes) {
    try {
      const resultado = await runWithWorkspace(conexao.workspace_id, async () => {
        const connection = await getIntegration(conexao.connection_id);
        if (!connection || connection.provider !== PROVIDER) return null;
        // ⚠️ UM PEDIDO POR DIA, e a soma dos dias é feita AQUI — nunca pela API.
        //
        // Este laço substitui uma chamada única de oito dias cujo resultado era
        // gravado como se fosse de um dia só (ver `coletarAdsDoMercadoLivre`).
        // Custa 2 chamadas por dia em vez de 2 no total; em troca, cada linha da
        // tabela passa a ser do dia que ela diz ser.
        //
        // A janela continua curta pelo mesmo motivo de sempre: o PADS aceita 90
        // dias para trás, e recolher tudo a cada ciclo reescreveria o passado
        // inteiro sem motivo. O que muda é só a granularidade do pedido.
        const total: ResultadoDaColeta = { gravadas: 0, duplicadasIgnoradas: 0, sanidade: null };
        for (let atras = 0; atras <= DIAS_DA_JANELA; atras += 1) {
          const parcial = await coletarAdsDoMercadoLivre(connection, diaEmBrasilia(atras));
          total.gravadas += parcial.gravadas;
          total.duplicadasIgnoradas += parcial.duplicadasIgnoradas;
          // Basta um dia não conferir para o ciclo não conferir: a sanidade é
          // sobre o dado gravado, e ela não pode ficar verde pela média.
          if (parcial.sanidade && (total.sanidade == null || !parcial.sanidade.confere)) {
            total.sanidade = parcial.sanidade;
          }
        }
        return total;
      });
      if (!resultado) continue;
      resultados.push({
        connectionId: conexao.connection_id,
        gravadas: resultado.gravadas,
        duplicadasIgnoradas: resultado.duplicadasIgnoradas,
        confere: resultado.sanidade?.confere ?? null,
      });
    } catch (error) {
      // Anúncio é complementar: nunca derruba o ciclo do canal.
      const mensagem = error instanceof Error ? error.message : "Falha ao coletar anúncios do Mercado Livre.";
      console.error(`[ml-ads] conexao=${conexao.connection_id} falhou: ${mensagem}`);
      resultados.push({ connectionId: conexao.connection_id, gravadas: 0, duplicadasIgnoradas: 0, confere: null, erro: mensagem });
    }
  }
  return resultados;
}
