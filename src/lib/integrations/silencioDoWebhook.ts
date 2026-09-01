import { dbQuery } from "../db";

/**
 * ALARME DE SILÊNCIO DO WEBHOOK — mede INTERVALO, não volume.
 *
 * ═══ POR QUE ELE EXISTE, com o número que o justifica ═══
 *
 * Medido em 01/09/2026 sobre 41,7 dias de histórico: o webhook do Mercado Livre
 * teve **cinco silêncios acima de 60 horas**, o maior de **236 horas — quase dez
 * dias** (15/08 21:20 → 25/08 17:37). Ninguém soube, porque não havia nada
 * olhando.
 *
 * ⚠️ E A JUSTIFICATIVA NÃO É PERDA DE PEDIDO — essa hipótese foi levantada e
 * DERRUBADA no mesmo dia, e fica registrada aqui para ninguém ressuscitá-la.
 *
 * Chegou-se a afirmar que 7 pedidos da CRYSTALFANCY se perderam na borda da
 * retomada de 25/08. **Falso.** O método comparava o que o ML lista numa janela
 * com o que o banco tem *na mesma janela*, e a API devolve pedidos ligeiramente
 * fora da borda pedida — a diferença media a discordância dos FILTROS, não a
 * ausência do DADO. Procurados por id, sem janela, **os 7 estavam todos no
 * banco**, e os 125 de uma varredura maior também.
 *
 * A VARREDURA PERIÓDICA FUNCIONOU durante os cinco apagões: é por isso que nada
 * se perdeu. Isso é evidência a favor do desenho atual, não contra.
 *
 * O QUE JUSTIFICA ESTE ALARME, e basta: **a ingestão passou dez dias dependendo
 * só do polling, e ninguém soube.** Silêncio longo sem aviso é ruim mesmo quando
 * nada se perde — porque a próxima vez pode coincidir com uma varredura parada,
 * e aí não haveria segunda rede. Ver
 * `docs/plans/amplificacao-de-escrita-nos-syncs.md`.
 *
 * ═══ POR QUE INTERVALO E NÃO VOLUME ═══
 *
 * O volume varia **7×** ao longo do dia: ~307 eventos/hora no pico (10h–12h) e
 * ~44/hora na madrugada (4h–5h). Qualquer limite de volume que não dispare às 11h
 * dispara às 4h — e alarme que toca sozinho toda noite é desligado em uma semana.
 *
 * O intervalo entre eventos, não: mesmo na hora mais fraca são 44/hora, um a cada
 * 82 segundos. **O problema do falso alarme não se resolve com limite mais
 * esperto — resolve-se escolhendo a grandeza certa.**
 *
 * ═══ O LIMITE: 45 MINUTOS ═══
 *
 * Numa semana saudável o p99 do intervalo é 4 minutos e o pior silêncio é 18.
 * 45 min é **2,5× o pior caso observado** — nunca teria disparado num período
 * bom, e teria disparado nos **cinco** apagões.
 *
 * ⚠️ E A RESSALVA QUE ORIGINOU O NÚMERO ANTERIOR, escrita aqui para não se
 * perder: a primeira proposta foi 30 minutos, a partir de uma medição de **7
 * dias**. Aqueles 7 dias eram um período bom, e generalizá-los produziu a frase
 * "o webhook está saudável, maior silêncio 18 minutos" — verdadeira e enganosa,
 * porque a história tem 41,7 dias e cinco apagões. **Janela curta generalizada é
 * a mesma família do contador acumulado lido como taxa:** nos dois casos o
 * instrumento responde com confiança uma pergunta que ele não cobre.
 */

/** 2,5× o pior silêncio observado num período saudável. Ver a nota acima. */
export const LIMITE_DE_SILENCIO_MS = 45 * 60_000;

export interface SilencioDoWebhook {
  provider: string;
  ultimoEventoHaMinutos: number | null;
  limiteMinutos: number;
  estado: "ok" | "silencioso" | "sem-historico";
  /** Frase pronta para quem lê: diz o que quebrou E o que ainda funciona. */
  mensagem: string | null;
}

/**
 * Só o Mercado Livre por enquanto — e a razão é que **só ele tem entrega por
 * evento em produção**.
 *
 * ⚠️ NÃO REPLIQUE O LIMITE PARA OUTRO CANAL SEM MEDIR O DELE. O padrão
 * (intervalo, não volume) é geral; os 45 minutos são deste canal, deste volume.
 * Copiar para um canal com um décimo dos eventos produz exatamente o alarme falso
 * que este desenho existe para evitar. Shopee e TikTok não têm push em produção;
 * a Amazon tem notificação SP-API, mas o produto não depende dela — lá o alarme
 * certo é o passo do cron falhando, que já existe.
 */
const PROVIDER = "mercado_livre";

/**
 * A DECISÃO, isolada do banco de propósito: é ela que precisa de teste, e teste
 * de decisão não deveria exigir Postgres. `medirSilencioDoWebhook` só busca o
 * número e delega para cá.
 */
export function avaliarSilencio(minutos: number | null): SilencioDoWebhook {
  const limiteMinutos = LIMITE_DE_SILENCIO_MS / 60_000;
  if (minutos == null || !Number.isFinite(minutos)) {
    // Sem histórico não é silêncio: é ausência de dado. Afirmar "silencioso"
    // aqui seria alarme sobre uma pergunta que não foi respondida.
    return { provider: PROVIDER, ultimoEventoHaMinutos: null, limiteMinutos, estado: "sem-historico", mensagem: null };
  }
  const arredondado = Math.round(minutos);
  const silencioso = arredondado > limiteMinutos;
  return {
    provider: PROVIDER,
    ultimoEventoHaMinutos: arredondado,
    limiteMinutos,
    estado: silencioso ? "silencioso" : "ok",
    // ⚠️ A frase diz o que quebrou E o que ainda funciona. Aviso que só assusta
    // produz pânico; aviso que aponta o que sobrou permite decidir.
    mensagem: silencioso
      ? `O Mercado Livre não envia evento há ${arredondado} minutos (normal: menos de 5). `
        + "Os pedidos ainda chegam pela sincronização periódica, que é mais lenta."
      : null,
  };
}

export async function medirSilencioDoWebhook(): Promise<SilencioDoWebhook> {
  const linhas = await dbQuery<{ minutos: string | null }>(
    `SELECT extract(epoch FROM (now() - max(received_at))) / 60 AS minutos
       FROM workspace_marketplace_events
      WHERE provider = $1`,
    [PROVIDER],
  );
  const bruto = linhas[0]?.minutos;
  return avaliarSilencio(bruto == null ? null : Number(bruto));
}
