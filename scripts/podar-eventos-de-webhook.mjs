/**
 * PODA DA CAIXA DE ENTRADA DE WEBHOOKS — script de cura padrão da casa.
 *
 * ⚠️ POR QUE ELE EXISTE, e o alvo NÃO é o que parecia (04/09/2026).
 *
 * Ao investigar o alerta de Disk IO Budget do Supabase, a hipótese era que os
 * 34.823 eventos `complete` nunca eram podados. **Medido, a hipótese caiu:** a
 * retenção do ADR-016 alcança `complete` normalmente — o `processed_at` mais
 * antigo era 28/08, exatamente a janela de 7 dias. Aquela tabela está saudável.
 *
 * O que a medição achou no lugar foi um defeito NOVO, meu, de 02/09/2026:
 *
 *   o push da Shopee grava `status = 'processed'`.
 *   a retenção remove `status = 'complete'`.
 *
 * São duas palavras para o mesmo estado, e a retenção só conhece uma. Os
 * eventos da Shopee são **imortais por construção**: 5.239 linhas em dois dias,
 * ~2.600/dia, crescendo para sempre. É a mesma família de `last_success_at` e
 * `updated_at` — coluna genérica, dois escritores, vocabulários diferentes, e
 * **nada fica vermelho**: o SQL não erra, o dado não corrompe, só a linha nunca
 * morre.
 *
 * 📌 A correção definitiva é o push da Shopee passar a escrever `complete` (uma
 * palavra), e está no commit que acompanha este script. ESTE script cura o dado
 * que o defeito já produziu — que é o que código novo nunca faz sozinho.
 *
 * ⚠️ ITERA INQUILINOS POR CONSULTA, nunca por constante. Conta de demonstração
 * fica de fora POR NOME.
 *
 * Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/ts-resolver.mjs \
 *        scripts/podar-eventos-de-webhook.mjs            # DRY-RUN (padrão)
 *        scripts/podar-eventos-de-webhook.mjs --aplicar  # remove de verdade
 */
process.env.DB_POOL_MAX = "3";
import { dbQuery } from "../src/lib/db.ts";
import { RETENCAO_EVENTOS_DIAS } from "../src/lib/retencao.ts";

const APLICAR = process.argv.includes("--aplicar");
const arg = (nome, padrao) => {
  const i = process.argv.indexOf(nome);
  return i === -1 ? padrao : process.argv[i + 1];
};
const DIAS = Number(arg("--dias", String(RETENCAO_EVENTOS_DIAS)));
const LOTE = 20_000;

// ⚠️ NUNCA abaixo da política do ADR-016: expurgo mais agressivo que a política
// exige nova decisão, não uma flag de linha de comando.
if (!Number.isFinite(DIAS) || DIAS < RETENCAO_EVENTOS_DIAS) {
  console.error(`--dias tem de ser >= ${RETENCAO_EVENTOS_DIAS} (politica do ADR-016).`);
  process.exit(1);
}

// Os dois vocabulários do MESMO estado. `error` e `pending` NUNCA entram aqui:
// são justamente os que alguém precisa investigar (ADR-016, regra 5).
const ESTADOS_CONCLUIDOS = ["complete", "processed"];

console.log(`\n=== PODA DE EVENTOS DE WEBHOOK — ${APLICAR ? "APLICANDO" : "DRY-RUN"} (janela de ${DIAS} dias)`);

// O ALVO SAI DE UMA CONSULTA. Demo fora por nome.
const inquilinos = await dbQuery(
  `SELECT DISTINCT e.workspace_id::text AS workspace_id, e.provider
     FROM workspace_marketplace_events e
    WHERE COALESCE(e.connection_id, '') NOT LIKE '%demo%'
    ORDER BY 1, 2`,
  [],
);

const total = await dbQuery(
  `SELECT status, count(*)::text AS n,
          count(*) FILTER (WHERE processed_at IS NOT NULL
                             AND processed_at < now() - ($1 || ' days')::interval)::text AS elegiveis
     FROM workspace_marketplace_events GROUP BY status ORDER BY 2 DESC`,
  [String(DIAS)],
);
console.log("\nestado atual da tabela inteira:");
for (const l of total) {
  const podavel = ESTADOS_CONCLUIDOS.includes(l.status);
  console.log(`  ${l.status.padEnd(11)} ${String(l.n).padStart(7)} linhas | elegiveis: ${String(l.elegiveis).padStart(6)}`
    + (podavel ? "" : "  <- NAO e podado (investigacao)"));
}

let podadas = 0;
let processados = 0;
console.log(`\ninquilinos com evento: ${inquilinos.length}`);

for (const alvo of inquilinos) {
  try {
    const [conta] = await dbQuery(
      `SELECT count(*)::text AS n FROM workspace_marketplace_events
        WHERE workspace_id = $1 AND provider = $2
          AND status = ANY($3::text[]) AND processed_at IS NOT NULL
          AND processed_at < now() - ($4 || ' days')::interval
          AND COALESCE(connection_id, '') NOT LIKE '%demo%'`,
      [alvo.workspace_id, alvo.provider, ESTADOS_CONCLUIDOS, String(DIAS)],
    );
    const elegiveis = Number(conta?.n ?? 0);
    if (APLICAR && elegiveis > 0) {
      // ctid é o identificador físico: a tabela não tem PK única por linha, e o
      // teto por execução evita transação longa numa tabela quente.
      const removidas = await dbQuery(
        `WITH alvo AS (
           SELECT ctid FROM workspace_marketplace_events
            WHERE workspace_id = $1 AND provider = $2
              AND status = ANY($3::text[]) AND processed_at IS NOT NULL
              AND processed_at < now() - ($4 || ' days')::interval
              AND COALESCE(connection_id, '') NOT LIKE '%demo%'
            LIMIT $5
         )
         DELETE FROM workspace_marketplace_events e USING alvo WHERE e.ctid = alvo.ctid RETURNING 1`,
        [alvo.workspace_id, alvo.provider, ESTADOS_CONCLUIDOS, String(DIAS), LOTE],
      );
      podadas += removidas.length;
      console.log(`  ${alvo.provider}: ${elegiveis} elegivel(is), ${removidas.length} podado(s)`);
    } else {
      console.log(`  ${alvo.provider}: ${elegiveis} elegivel(is)${APLICAR ? "" : " — nada removido (dry-run)"}`);
      podadas += APLICAR ? 0 : 0;
    }
    processados += 1;
  } catch (erro) {
    // Um inquilino que falha não cala os outros.
    console.error(`  ${alvo.provider} (${alvo.workspace_id}): FALHOU —`,
      erro instanceof Error ? erro.message.slice(0, 160) : erro);
  }
}

// O RELATÓRIO DIZ AS DUAS: quantos existem e quantos foram processados.
console.log(`\n${processados} de ${inquilinos.length} inquilino(s)/canal processado(s).`);
console.log(APLICAR ? `${podadas} linha(s) removida(s).` : "DRY-RUN: nada foi removido.");
if (!APLICAR) console.log("Para remover de verdade: --aplicar");
process.exit(0);
