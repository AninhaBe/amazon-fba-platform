// Roda o estimador de tarifa da Amazon nas conexões reais, gravando na tabela
// própria da ADR-027 Emenda II (`workspace_channel_order_fee_estimates`).
//
// Uso:
//   node --env-file=.env.local --experimental-strip-types \
//        --import ./scripts/ts-resolver.mjs scripts/rodar-estimador-amazon.mjs
//
// ⚠️ POR QUE ESTE SCRIPT EXISTE, e não é conveniência: logo depois do apply da
// 0022 a tabela nova nasce VAZIA (a migration apaga as 552 linhas antigas), e
// até o estimador passar a tela mostra "Tarifas não postadas" no pendente. Esse
// é o modo de falha CORRETO da ADR-027 — mas ele é visível para a vendedora, e
// curto é o que se quer. O cron levaria até o próximo ciclo; isto fecha a janela
// agora.
//
// ⚠️ SOMENTE LEITURA NA SP-API. A Product Fees API é consulta de preço; nada é
// escrito no marketplace. A escrita é só no nosso banco.
process.env.DB_POOL_MAX = "3";

import { dbQuery } from "../src/lib/db.ts";
import { runWithWorkspace } from "../src/lib/workspaceScope.ts";
import { runWithAccount } from "../src/lib/accountContext.ts";
import {
  estimarTarifaDosPedidosSemTarifa,
  carimbarEstimativasSubstituidas,
} from "../src/lib/integrations/amazonTarifaEstimada.ts";

const contas = await dbQuery(
  `SELECT workspace_id::text AS workspace_id, seller_id, refresh_token
     FROM workspace_accounts ORDER BY connected_at`,
  [],
);

const LIMITE = Number(process.env.LIMITE ?? 400);
const SO = process.env.SO_SELLER;

for (const conta of contas) {
  if (SO && conta.seller_id !== SO) continue;
  const connectionId = `amazon:${conta.seller_id}`;
  try {
    // ⚠️ `PELO_LWA_DO_ENV` EXISTE PORQUE OS TOKENS ARMAZENADOS ESTÃO REVOGADOS
    // (01/09/2026: as três contas devolvem "A conexão com a Amazon precisa ser
    // renovada"). Sem conta no contexto, `spapiFetch` cai no `LWA_REFRESH_TOKEN`
    // do `.env`.
    //
    // ⚠️ E ELE SÓ VALE PARA A CONTA DONA DESSE TOKEN. A Product Fees API responde
    // POR VENDEDOR — medido em 31/08/2026: os mesmos ASINs devolvem 12% + FBA
    // para um vendedor e ZERO para outro. Usar o token de uma conta para estimar
    // a tarifa de outra gravaria a isenção de uma como se fosse da outra, que é
    // corromper o lucro alheio em silêncio. Por isso o `seller_id` é conferido.
    const donoDoTokenDoEnv = process.env.LWA_SELLER_ID;
    const pelolLwaDoEnv = donoDoTokenDoEnv != null && donoDoTokenDoEnv === conta.seller_id;
    const comConta = (fn) =>
      pelolLwaDoEnv
        ? fn()
        : runWithAccount(
            { workspaceId: conta.workspace_id, sellerId: conta.seller_id, refreshToken: conta.refresh_token },
            fn,
          );
    const resultado = await runWithWorkspace(conta.workspace_id, () =>
      comConta(
        async () => {
          // Carimbar ANTES de estimar: uma estimativa cujo tipo já foi postado
          // sai da tela por `superseded_at`, e não por ausência de linha.
          const carimbadas = await carimbarEstimativasSubstituidas(connectionId);
          const gravadas = await estimarTarifaDosPedidosSemTarifa(connectionId, LIMITE);
          return { carimbadas, ...gravadas };
        },
      ),
    );
    console.log(`${conta.seller_id}: ${resultado.linhas} linha(s) em ${resultado.pedidos} pedido(s), ` +
      `${resultado.chaves} chave(s) (ASIN,preço), ${resultado.carimbadas} substituída(s) carimbada(s)`);
  } catch (erro) {
    // Uma conta que falha não pode calar as outras — mesmo princípio do cron.
    console.error(`${conta.seller_id}: FALHOU —`, erro instanceof Error ? erro.message.slice(0, 200) : erro);
  }
}

// A conferência que importa: quantas linhas entraram, e quantas são ZERO da
// fonte. Zero é fato; ausência de linha é que seria o bug.
const resumo = await dbQuery(
  `SELECT workspace_id::text AS workspace_id, connection_id,
          COUNT(*)::int AS linhas,
          COUNT(*) FILTER (WHERE amount = 0)::int AS zeradas,
          COUNT(DISTINCT external_order_id)::int AS pedidos,
          SUM(amount)::text AS total
     FROM workspace_channel_order_fee_estimates
    GROUP BY 1, 2 ORDER BY 3 DESC`,
  [],
);
console.log("\ntabela nova:", JSON.stringify(resumo, null, 1));
process.exit(0);
