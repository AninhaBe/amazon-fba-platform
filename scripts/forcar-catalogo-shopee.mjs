// Uso: node --env-file=.env.local --experimental-strip-types \
//        --import ./scripts/ts-resolver.mjs scripts/forcar-catalogo-shopee.mjs
//
// ⚠️ REGRA DE HIGIENE: script local contra producao nao abre pool de 10 (ADR-028).
process.env.DB_POOL_MAX = "3";

// Forca UM sweep completo do catalogo da Shopee, na janela do lote do ADR-029.
//
// POR QUE FORCAR: depois que o catalogo passa a gravar UMA LINHA POR VARIACAO,
// existe uma janela em que os itens de pedido antigos (id base) nao casam com o
// catalogo novo (id composto). A janela e inevitavel em qualquer ordem; o que da
// para fazer e ENCURTA-LA. Esperar o cron deixaria a duracao fora do nosso
// controle — foi o argumento do cerebro para aprovar esta ordem.
//
// O QUE ESCREVE NO CONTROLE (nao e dado de negocio): products_complete=false e
// cursor_token=NULL na linha de sync da conexao, que e o que faz a proxima etapa
// comecar um sweep novo em vez de continuar de onde parou.
import { runWithWorkspace } from "../src/lib/workspaceScope.ts";
import { dbQuery } from "../src/lib/db.ts";
import { runShopeeSyncStep } from "../src/lib/integrations/shopeeSync.ts";
import { getIntegrations } from "../src/lib/integrations/integrationStore.ts";
import { escolherConexaoPadrao } from "../src/lib/integrations/conexaoPadrao.ts";

const WORKSPACE = process.env.PROBE_WORKSPACE_ID;
if (!WORKSPACE) throw new Error("PROBE_WORKSPACE_ID ausente.");
const MAX_ETAPAS = Number(process.env.MAX_ETAPAS ?? 12);

const agora = () => new Date().toISOString().slice(11, 19);

await runWithWorkspace(WORKSPACE, async () => {
  const conexao = escolherConexaoPadrao((await getIntegrations("shopee")).filter((c) => c.provider === "shopee"));
  if (!conexao) throw new Error("Sem conexao Shopee conectada neste workspace.");
  console.log(`${agora()} conexao: ${conexao.id}`);

  const [antes] = await dbQuery(
    `SELECT products_total, active_products, products_complete, products_synced_at
       FROM workspace_marketplace_syncs WHERE workspace_id=$1 AND provider='shopee' AND connection_id=$2`,
    [WORKSPACE, conexao.id]
  );
  console.log(`${agora()} ANTES: ${JSON.stringify(antes)}`);
  const [produtosAntes] = await dbQuery(
    `SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE external_product_id LIKE '%::sku:%')::int compostos
       FROM workspace_channel_products WHERE workspace_id=$1 AND provider='shopee' AND connection_id=$2`,
    [WORKSPACE, conexao.id]
  );
  console.log(`${agora()} catalogo ANTES: ${JSON.stringify(produtosAntes)}`);

  // Zera o checkpoint para o proximo passo comecar um sweep novo. Nao mexe em
  // lease: se o cron do servidor estiver com a etapa, ele termina e este script
  // pega a proxima — o lease e que protege os dois de rodar junto.
  const zerado = await dbQuery(
    `UPDATE workspace_marketplace_syncs
        SET products_complete=false, cursor_token=NULL, updated_at=now()
      WHERE workspace_id=$1 AND provider='shopee' AND connection_id=$2
      RETURNING connection_id`,
    [WORKSPACE, conexao.id]
  );
  if (!zerado[0]) throw new Error("Nao consegui zerar o checkpoint do catalogo.");
  console.log(`${agora()} checkpoint zerado — o proximo passo comeca sweep novo`);

  for (let etapa = 1; etapa <= MAX_ETAPAS; etapa += 1) {
    const t = Date.now();
    try {
      await runShopeeSyncStep(conexao, false);
    } catch (erro) {
      console.log(`${agora()} etapa ${etapa} FALHOU: ${erro instanceof Error ? erro.message : erro}`);
      console.log("PARE e reporte — nao siga para o backfill com o catalogo pela metade.");
      process.exit(2);
    }
    const [estado] = await dbQuery(
      `SELECT products_complete, products_total, active_products, last_error
         FROM workspace_marketplace_syncs WHERE workspace_id=$1 AND provider='shopee' AND connection_id=$2`,
      [WORKSPACE, conexao.id]
    );
    const [produtos] = await dbQuery(
      `SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE external_product_id LIKE '%::sku:%')::int compostos
         FROM workspace_channel_products WHERE workspace_id=$1 AND provider='shopee' AND connection_id=$2`,
      [WORKSPACE, conexao.id]
    );
    console.log(`${agora()} etapa ${etapa} (${Date.now() - t}ms): completo=${estado?.products_complete} catalogo=${produtos.total} compostos=${produtos.compostos}${estado?.last_error ? ` ERRO=${String(estado.last_error).slice(0, 60)}` : ""}`);
    if (estado?.products_complete) {
      console.log(`\n${agora()} CATALOGO COMPLETO: ${produtos.total} linhas, ${produtos.compostos} por variacao.`);
      process.exit(0);
    }
  }
  console.log(`\n${agora()} ATINGIU O LIMITE DE ${MAX_ETAPAS} ETAPAS sem completar. PARE e reporte.`);
  process.exit(3);
});
