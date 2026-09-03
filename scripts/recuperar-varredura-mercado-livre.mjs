/**
 * RECUPERACAO DA VARREDURA DO MERCADO LIVRE — a janela unica.
 *
 * ⚠️ POR QUE ELE EXISTE (03/09/2026): a conexao `mercado_livre:1191100170` ficou
 * 11 HORAS sem varredura (causa em `AGENTS.md` → "coluna que dois escritores
 * tocam"). Depois do conserto ela volta a ser eleita — mas a varredura **caminha
 * no mesmo passo do relogio**: janelas de 5 minutos, uma por ciclo de 5 minutos.
 * Recuperar 11 horas assim levaria 11 horas.
 *
 * 📌 Este script NAO briga com o agendador: ele nao mexe em cursor, target nem
 * lease. Ele le a janela perdida direto da API e grava pelo MESMO caminho
 * canonico da varredura (`saveCanonicalOrders`), de forma idempotente. O
 * agendador continua o trabalho normal em paralelo.
 *
 * ⚠️ ITERA TODAS AS CONEXOES POR CONSULTA, nunca por constante — regra da casa
 * (o defeito aparece numa conta, a causa mora no codigo). Conta de demonstracao
 * fica de fora POR NOME: ela nao tem token e falharia no meio do laco.
 *
 * Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/ts-resolver.mjs \
 *        scripts/recuperar-varredura-mercado-livre.mjs [--horas 12] [--conexao <id>]
 */
process.env.DB_POOL_MAX = "3";
import { dbQuery } from "../src/lib/db.ts";
import { runWithWorkspace } from "../src/lib/workspaceScope.ts";

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(nome);
  return i === -1 ? padrao : process.argv[i + 1];
};
const HORAS = Number(arg("--horas", "12"));
const SO_CONEXAO = arg("--conexao", null);
const PAGINA = 50;

const { getIntegration } = await import("../src/lib/integrations/integrationStore.ts");
const { mercadoLivreFetch } = await import("../src/lib/integrations/mercadoLivre.ts");
const { normalizeMercadoLivreOrder } = await import("../src/lib/integrations/mercadoLivreCanonical.ts");
const { saveCanonicalOrders } = await import("../src/lib/integrations/canonicalStore.ts");

// O ALVO SAI DE UMA CONSULTA. Demo fora por nome.
const conexoes = await dbQuery(
  `SELECT workspace_id::text AS workspace_id, id AS connection_id
     FROM workspace_integrations
    WHERE provider = 'mercado_livre' AND status = 'connected'
      AND metadata->'demo' IS DISTINCT FROM 'true'::jsonb
    ORDER BY id`,
  [],
);
const alvo = SO_CONEXAO ? conexoes.filter((c) => c.connection_id === SO_CONEXAO) : conexoes;

console.log(`\n=== RECUPERACAO DA VARREDURA DO ML — ultimas ${HORAS}h ===`);
console.log(`conexoes conectadas (sem demo): ${conexoes.length} | nesta execucao: ${alvo.length}`);
if (SO_CONEXAO) console.log(`⚠️  --conexao ${SO_CONEXAO}: execucao PARCIAL por escolha explicita.\n`);

const ate = new Date();
const de = new Date(ate.getTime() - HORAS * 3_600_000);
let processadas = 0;

for (const c of alvo) {
  try {
    await runWithWorkspace(c.workspace_id, async () => {
      const conn = await getIntegration(c.connection_id);
      if (!conn) throw new Error("conexao sumiu entre a consulta e o uso");
      let offset = 0;
      let vistos = 0;
      let gravados = 0;
      for (;;) {
        const pagina = await mercadoLivreFetch(
          conn,
          `/orders/search?seller=${encodeURIComponent(conn.externalAccountId)}`
            + `&order.date_created.from=${encodeURIComponent(de.toISOString())}`
            + `&order.date_created.to=${encodeURIComponent(ate.toISOString())}`
            + `&sort=date_asc&limit=${PAGINA}&offset=${offset}`,
        );
        const pedidos = pagina?.results ?? [];
        if (!pedidos.length) break;
        vistos += pedidos.length;
        // O sellerId e obrigatorio na normalizacao — sem ele o canonico nasce
        // sem dono e a mesma funcao da varredura produziria outra coisa.
        const canonicos = pedidos.map((p) => normalizeMercadoLivreOrder(p, { sellerId: conn.externalAccountId }));
        // Idempotente: mesmo caminho da varredura, upsert por external_order_id.
        await saveCanonicalOrders({ provider: "mercado_livre", connectionId: c.connection_id }, canonicos);
        gravados += canonicos.length;
        const total = pagina?.paging?.total ?? vistos;
        offset += PAGINA;
        if (offset >= total) break;
        // Respiro entre paginas: o rate limit do ML foi o gatilho do incidente,
        // e um script de cura correndo solto seria a segunda causa.
        await new Promise((r) => setTimeout(r, 400));
      }
      console.log(`  ${c.connection_id}: ${vistos} pedido(s) na janela, ${gravados} gravado(s)`);
    });
    processadas += 1;
  } catch (erro) {
    // Uma conexao que falha nao cala as outras — mesmo principio do cron.
    console.error(`  ${c.connection_id}: FALHOU —`, erro instanceof Error ? erro.message.slice(0, 160) : erro);
  }
}

// O RELATORIO DIZ AS DUAS: quantas existem e quantas foram processadas. Cobrir
// uma de tres tem de ser visivel, e nao "concluido".
console.log(`\n${processadas} de ${alvo.length} conexao(oes) processada(s); ${conexoes.length} conectada(s) no total.`);
process.exit(0);
