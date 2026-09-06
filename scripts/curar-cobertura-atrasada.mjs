/**
 * CURA DO MARCADOR DE COBERTURA — covered_from atrasado em relação ao dado.
 *
 * ⚠️ POR QUE ELE EXISTE (06/09/2026): a loja UTILEIRA exibia "os números cobrem
 * a partir de 13/07" com **5.103 pedidos (20% da base) já no banco desde
 * 28/06**. Aviso de cobertura mentindo é defeito, não estética.
 *
 * 📌 A CAUSA foi corrigida no GERADOR, e este script só cura o dado que ela
 * produziu: o caminho 'complete' de três canais escrevia
 * `covered_from = COALESCE(covered_from, target_from)` — sem LEAST, ele NUNCA
 * abaixa depois de definido. O backfill de 28/08 caminhou para trás e o
 * marcador congelou onde a caminhada fechou pela primeira vez.
 * Guarda que impede a volta: `tests/coberturaNuncaEncolhe`.
 *
 * ⚠️ ITERA TODOS OS INQUILINOS POR CONSULTA, nunca por constante — o defeito
 * apareceu numa conta, a causa morava no código, e o dado errado pode estar em
 * qualquer uma. Conta de demonstração fica de fora POR NOME.
 *
 * ⚠️ E NÃO TOCA EM NADA DO FATURAMENTO. O único campo escrito é `covered_from`;
 * o ponto seguro da Shopee (v270) não passa por ele e é para continuar assim.
 *
 * Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/ts-resolver.mjs \
 *        scripts/curar-cobertura-atrasada.mjs            # DRY-RUN (padrão)
 *        scripts/curar-cobertura-atrasada.mjs --aplicar  # corrige
 */
process.env.DB_POOL_MAX = "3";
import { dbQuery } from "../src/lib/db.ts";

const APLICAR = process.argv.includes("--aplicar");

console.log(`\n=== CURA DO covered_from — ${APLICAR ? "APLICANDO" : "DRY-RUN"}\n`);

// O ALVO SAI DE UMA CONSULTA. Demo fora por nome.
const linhas = await dbQuery(
  `SELECT s.workspace_id::text AS workspace_id, s.provider, s.connection_id,
          to_char(s.covered_from, 'YYYY-MM-DD HH24:MI') AS marcador,
          to_char(min(o.occurred_at), 'YYYY-MM-DD HH24:MI') AS real_min,
          count(*) FILTER (WHERE o.occurred_at < s.covered_from)::int AS antes
     FROM workspace_marketplace_syncs s
     JOIN workspace_channel_orders o
       ON o.workspace_id = s.workspace_id AND o.provider = s.provider
      AND o.connection_id = s.connection_id
    WHERE s.connection_id NOT LIKE '%demo%' AND s.covered_from IS NOT NULL
    GROUP BY 1, 2, 3, 4
    ORDER BY 2, 3`,
  [],
);

const atrasadas = linhas.filter((l) => l.antes > 0);
console.log(`conexoes com pedidos e marcador definido: ${linhas.length}`);
console.log(`ATRASADAS (pedido anterior ao marcador): ${atrasadas.length}\n`);
for (const l of linhas) {
  const marca = l.antes > 0 ? `⚠️  ${l.antes} pedido(s) ANTES` : "ok";
  console.log(`  ${l.connection_id.padEnd(32)} marcador=${l.marcador} | 1o real=${l.real_min} | ${marca}`);
}

let corrigidas = 0;
if (APLICAR) {
  console.log("");
  for (const l of atrasadas) {
    try {
      // Recua para o mínimo real DESTA conexão. LEAST protege contra corrida:
      // se outra passada já baixou mais, a dela vale.
      const r = await dbQuery(
        `UPDATE workspace_marketplace_syncs s
            SET covered_from = LEAST(s.covered_from, (
                  SELECT min(o.occurred_at) FROM workspace_channel_orders o
                   WHERE o.workspace_id = s.workspace_id AND o.provider = s.provider
                     AND o.connection_id = s.connection_id)),
                updated_at = now()
          WHERE s.workspace_id = $1 AND s.provider = $2 AND s.connection_id = $3
          RETURNING to_char(covered_from, 'YYYY-MM-DD HH24:MI') AS novo`,
        [l.workspace_id, l.provider, l.connection_id],
      );
      console.log(`  ${l.connection_id}: ${l.marcador} -> ${r[0]?.novo}`);
      corrigidas += 1;
    } catch (erro) {
      // Uma conexão que falha não cala as outras.
      console.error(`  ${l.connection_id}: FALHOU —`, erro instanceof Error ? erro.message.slice(0, 160) : erro);
    }
  }
}

// O RELATÓRIO DIZ AS DUAS: quantas existem e quantas foram tocadas.
console.log(`\n${linhas.length} conexao(oes) conferida(s), ${atrasadas.length} atrasada(s), ${corrigidas} corrigida(s).`);
if (!APLICAR) console.log("DRY-RUN: nada foi alterado. Para corrigir: --aplicar");
process.exit(0);
