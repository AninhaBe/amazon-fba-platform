// SEED DO ACESSO DAS CONTAS DE DEMONSTRACAO.
//
// POR QUE ISTO EXISTE. No modelo v3 (07/09/2026) so entra quem tem assinatura
// ativa ou e admin. As contas de demonstracao — a vitrine de vendas — nao sao
// nem uma coisa nem outra, e morreriam junto. A dona pediu o caminho coerente
// com a doutrina: resolver por DADO, nao por excecao no codigo.
//
// ⚠️ ASSINATURA, E NAO TRIAL, e a mudanca em relacao a primeira versao deste
// script (do mesmo dia): o modelo v3 tirou o trial da decisao, entao uma linha
// de trial nao concede mais nada. Sobrou a assinatura.
//
// ⚠️ O PRECO DISSO, dito por escrito porque e uma divida real: a palavra "ativa"
// passa a significar duas coisas — "pagou" e "e nossa". E a familia de defeito
// que ja custou caro aqui (last_success_at, updated_at, fee_type). O antidoto
// possivel hoje e o campo `origem: "interna"`, que deixa a diferenca LEGIVEL: se
// um dia existir contagem de assinantes ou receita, ela filtra por ele em vez de
// contar demo como cliente. Se isso doer mais, a conversa e sobre um estado
// proprio — nunca sobre voltar a inventar excecao no codigo.
//
// ⚠️ E O ALVO SAI DE UMA CONSULTA, nao de uma constante. Doutrina de 01/09/2026:
// script que cura dado varre inquilinos. O criterio e medivel — workspace cujas
// conexoes sao TODAS de demonstracao — entao a conta de demo que alguem criar
// amanha entra sozinha, em vez de ficar de fora por esquecimento.
//
// ⚠️ E o `stripeCustomerId`/`stripeSubscriptionId` ficam NULOS de proposito:
// `buscarWorkspacePorStripe` so casa valor nao-nulo, entao nenhum evento real da
// Stripe consegue acertar uma conta semeada por engano.
//
// Uso:
//   node --experimental-strip-types --import ./scripts/ts-resolver.mjs \
//        --env-file=.env.local scripts/semear-acesso-demo.mjs [--aplicar]
import pg from "pg";

const APLICAR = process.argv.includes("--aplicar");

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows: candidatos } = await c.query(`
  SELECT s.workspace_id,
         count(*)::int AS conexoes
    FROM workspace_marketplace_syncs s
   GROUP BY 1
  HAVING count(*) > 0 AND count(*) = count(*) FILTER (WHERE s.connection_id LIKE '%demo%')
   ORDER BY 1`);

console.log(`workspaces com conexoes 100% de demonstracao: ${candidatos.length}`);

for (const { workspace_id, conexoes } of candidatos) {
  const { rows: atual } = await c.query(
    `SELECT value FROM workspace_settings WHERE workspace_id = $1 AND key = 'assinatura'`,
    [workspace_id]
  );
  const antes = atual[0]?.value ?? null;
  const jaOk = antes?.status === "ativa" && antes?.origem === "interna";
  console.log(
    `  ${workspace_id.slice(0, 8)}  conexoes=${conexoes}  assinatura=${antes ? `${antes.status}${antes.origem ? `/${antes.origem}` : ""}` : "(nenhuma)"}  -> ${jaOk ? "ja ok, nao mexe" : antes ? "SOBRESCREVE" : "cria"}`
  );

  // ⚠️ NAO sobrescreve assinatura de pagante. Uma conta de demonstracao nao
  // deveria ter uma, mas se tiver, quem manda e o dado da Stripe — carimbar por
  // cima apagaria o vinculo com o cliente real.
  if (antes && antes.origem !== "interna") {
    console.log("     PULADO: existe assinatura sem origem interna. Olhe antes de mexer.");
    continue;
  }
  if (!APLICAR || jaOk) continue;

  await c.query(
    `INSERT INTO workspace_settings (workspace_id, key, value, updated_at)
          VALUES ($1, 'assinatura', $2::jsonb, now())
     ON CONFLICT (workspace_id, key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [
      workspace_id,
      JSON.stringify({
        status: "ativa",
        origem: "interna",
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        email: null,
        atualizadoEm: new Date().toISOString(),
        ultimoEventoId: "seed-demo",
        ultimoEventoTipo: "seed.demonstracao",
        nota: "Conta de demonstracao do NEXO, mantida pela equipe. Nao ha pagamento associado.",
      }),
    ]
  );
  console.log("     gravado: assinatura ativa, origem interna");
}

console.log(APLICAR ? "\nAPLICADO." : "\nSIMULACAO — nada foi gravado. Rode com --aplicar para valer.");
await c.end();
