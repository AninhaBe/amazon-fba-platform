import { CHAVE_ASSINATURA } from "../billing/runtime";
import { SETTING_KEY as CHAVE_TRIAL } from "../trial";

/**
 * SÓ SINCRONIZA QUEM TEM ACESSO — ordem da dona do produto em 07/09/2026:
 * *"basicamente todos que não estão com assinatura ativa, pode pausar"*.
 *
 * ⚠️ UMA REGRA, UMA FONTE. Este filtro é a tradução para SQL da MESMA decisão de
 * `src/lib/billing/acesso.ts`, e não uma segunda lógica parecida. Duas regras que
 * hoje coincidem é como uma fica para trás — foi assim que a central passou a
 * recusar um canal que já sabia responder (31/08/2026). A equivalência entre as
 * duas não é promessa: `tests/schedulerPausaContaCortada.test.mjs` roda os
 * quatro casos da fronteira no Postgres e compara, um a um, com o que
 * `decidirAcesso` devolve para a mesma entrada.
 *
 * Os quatro casos, e por que cada um:
 *
 * | assinatura | trial   | sync      | por quê                                  |
 * |------------|---------|-----------|------------------------------------------|
 * | `cortada`  | qualquer| **pausa** | cortou, parou                            |
 * | ausente    | vencido | **pausa** | quem não vê o dado não precisa dele      |
 * | ausente    | ativo   | continua  | avaliação sem dado não converte ninguém  |
 * | ausente    | ausente | continua  | o mundo interno de hoje                  |
 *
 * (`ativa` continua, em qualquer combinação: é o sinal específico.)
 *
 * ⚠️ A RETOMADA É DE GRAÇA, e é por isso que isto é um FILTRO e não uma escrita:
 * nada é marcado ao cortar, nada precisa ser desmarcado ao reativar. No ciclo
 * seguinte a conexão volta a ser eleita com o `covered_from` intocado e o
 * scheduler recupera a janela parada pelo caminho que já usa para qualquer
 * conexão atrasada. Uma coluna `pausada` exigiria lembrar de limpá-la — e o dia
 * em que alguém esquecesse, a conta paga ficaria muda.
 *
 * ⚠️ E NÃO OLHA `sync.status`. Reusar a coluna de status daria dois significados
 * a ela — "onde a varredura está" e "se a conta pode rodar" —, que é literalmente
 * a família que custou 11 horas de varredura parada em 03/09/2026 (`updated_at`)
 * e um vigia cego em 02/09 (`last_success_at`).
 */
export function filtroDeAcessoLiberado(alias: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) {
    throw new Error(`Alias inválido para o filtro de acesso: ${alias}`);
  }
  // ⚠️ NÃO começa com `AND`: quem chama escreve o conector. A primeira versão
  // embutia o `AND` e produzia `WHERE AND NOT EXISTS (...)` no eleitor do
  // TikTok, cujo WHERE começa por este filtro — SQL inválido que o TypeScript
  // não vê, porque para ele é só uma string.
  //
  // ⚠️ COMPARAÇÃO DE TEXTO, sem cast e sem RegExp — e as duas ausências são a
  // correção de um defeito medido aqui em 07/09/2026, não preferência de estilo.
  //
  // O cast: `(value->>'endsAt')::timestamptz` derruba a consulta INTEIRA com
  // erro de conversão se uma única linha tiver `endsAt` malformado — e aí o
  // scheduler daquele canal para para TODO mundo, por causa do dado de um.
  //
  // A RegExp que eu tinha posto para proteger o cast: escrita dentro de template
  // literal, `\d` virou `d`, e o filtro nasceu comparando com `^d{4}-d{2}...`.
  // Ficou VERDE na leitura e ERRADO na execução — a conta de trial vencido
  // continuava sincronizando. É a armadilha que o AGENTS.md já registra (``
  // virando BACKSPACE), e só apareceu porque a equivalência foi MEDIDA.
  //
  // `endsAt` é sempre ISO-UTC de `toISOString()`, então comparar como texto
  // ordena igual a comparar como data. Valor malformado simplesmente não é
  // "menor que agora" e não conta como vencido — que é exatamente o que o lado
  // TypeScript faz (`new Date("lixo")` vira NaN e `expired` é falso).
  return `NOT EXISTS (
          SELECT 1 FROM workspace_settings assinatura_cortada
           WHERE assinatura_cortada.workspace_id = ${alias}.workspace_id
             AND assinatura_cortada.key = '${CHAVE_ASSINATURA}'
             AND assinatura_cortada.value->>'status' = 'cortada'
        )
        AND NOT (
          NOT EXISTS (
            SELECT 1 FROM workspace_settings tem_assinatura
             WHERE tem_assinatura.workspace_id = ${alias}.workspace_id
               AND tem_assinatura.key = '${CHAVE_ASSINATURA}'
          )
          AND EXISTS (
            SELECT 1 FROM workspace_settings trial_vencido
             WHERE trial_vencido.workspace_id = ${alias}.workspace_id
               AND trial_vencido.key = '${CHAVE_TRIAL}'
               AND trial_vencido.value->>'endsAt'
                     < to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          )
        )`;
}
