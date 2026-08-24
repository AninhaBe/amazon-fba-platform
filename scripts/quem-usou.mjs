// Quem andou usando o NEXO, e o que — a partir do que JÁ existe no banco.
//
//   node --env-file=.env.local scripts/quem-usou.mjs
//
// Somente leitura. Não escreve nada, não toca em dado de negócio.
//
// Por que existe: não há tabela de eventos de uso (a fase 2 da tela de admin
// está pendente e, quando existir, começa do zero). Mas várias tabelas guardam
// `updated_at` de coisas que só mudam quando ALGUÉM MEXE — e isso responde boa
// parte da pergunta sem instrumentar nada nem esperar dado novo acumular.
//
// ⚠️ O que isto NÃO responde: quantas vezes cada tela foi aberta, ou o que a
// pessoa olhou sem mexer. Para isso não tem jeito senão registrar navegação —
// e aí a política de privacidade precisa ser atualizada junto.
//
// ⚠️ Identifica por `workspace_id`, nunca por nome ao lado de faturamento
// (ADR-024). O e-mail aparece porque é a única forma de você saber de quem é o
// workspace — mas não é exibido junto de dinheiro.

import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const tabela = (titulo, linhas) => {
  console.log(`\n${titulo}`);
  if (!linhas.length) return console.log("  (nada)");
  console.table(linhas);
};

const quando = (d) =>
  d == null ? "—" : new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

const haQuanto = (d) => {
  if (d == null) return "—";
  const h = (Date.now() - new Date(d).getTime()) / 3_600_000;
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} dias`;
};

await client.connect();

// ---------- QUEM ----------
// `auth.users` é do Supabase. Pode não estar acessível conforme o papel da
// conexão — por isso a consulta é tolerante e diz quando não deu.
let quem = [];
try {
  const r = await client.query(
    `SELECT id::text            AS workspace,
            email,
            last_sign_in_at,
            created_at
       FROM auth.users
      ORDER BY last_sign_in_at DESC NULLS LAST`
  );
  quem = r.rows.map((u) => ({
    workspace: u.workspace.slice(0, 8),
    email: u.email,
    "último acesso": quando(u.last_sign_in_at),
    "há": haQuanto(u.last_sign_in_at),
    "conta criada": quando(u.created_at),
  }));
  tabela("👤 QUEM ENTROU (auth.users do Supabase)", quem);
} catch (erro) {
  console.log("\n👤 QUEM ENTROU");
  console.log(`  Sem acesso ao schema de autenticação: ${erro.message}`);
  console.log("  O último acesso fica no painel do Supabase → Authentication → Users.");
}

// ---------- O QUE ----------
// Cada linha aqui só existe porque alguém fez alguma coisa na tela.
const sinais = await client.query(
  `WITH canais AS (
     SELECT workspace_id, provider,
            MAX(last_success_at) AS ultima_sync,
            COUNT(*)             AS conexoes
       FROM workspace_marketplace_syncs
      WHERE connection_id NOT LIKE '%demo%'
      GROUP BY workspace_id, provider
   ), custos AS (
     SELECT workspace_id, COUNT(*) AS skus_com_custo, MAX(updated_at) AS ultimo_custo
       FROM workspace_product_costs GROUP BY workspace_id
   ), telas AS (
     SELECT workspace_id,
            COUNT(*) FILTER (WHERE key LIKE 'dashboard-layout:%') AS telas_personalizadas,
            MAX(updated_at)                                       AS ultimo_ajuste
       FROM workspace_settings GROUP BY workspace_id
   ), pesquisa AS (
     SELECT workspace_id, COUNT(*) AS itens_na_watchlist
       FROM workspace_watchlist GROUP BY workspace_id
   )
   SELECT c.workspace_id::text AS workspace,
          string_agg(DISTINCT c.provider, ', ' ORDER BY c.provider) AS canais,
          MAX(c.ultima_sync)                                        AS ultima_sync,
          MAX(cu.skus_com_custo)                                    AS skus_com_custo,
          MAX(cu.ultimo_custo)                                      AS ultimo_custo,
          MAX(t.telas_personalizadas)                               AS telas_personalizadas,
          MAX(t.ultimo_ajuste)                                      AS ultimo_ajuste,
          MAX(p.itens_na_watchlist)                                 AS watchlist
     FROM canais c
     LEFT JOIN custos   cu ON cu.workspace_id = c.workspace_id
     LEFT JOIN telas    t  ON t.workspace_id  = c.workspace_id
     LEFT JOIN pesquisa p  ON p.workspace_id  = c.workspace_id
    GROUP BY c.workspace_id
    ORDER BY MAX(c.ultima_sync) DESC NULLS LAST`
);

tabela(
  "🧭 O QUE ANDARAM USANDO (derivado do que só muda quando alguém mexe)",
  sinais.rows.map((r) => ({
    workspace: r.workspace.slice(0, 8),
    canais: r.canais,
    "sync há": haQuanto(r.ultima_sync),
    "SKUs c/ custo": Number(r.skus_com_custo ?? 0),
    "último custo": haQuanto(r.ultimo_custo),
    "telas ajustadas": Number(r.telas_personalizadas ?? 0),
    "último ajuste": haQuanto(r.ultimo_ajuste),
    watchlist: Number(r.watchlist ?? 0),
  }))
);

// ---------- QUAIS TELAS ----------
const telas = await client.query(
  `SELECT replace(key, 'dashboard-layout:', '') AS tela,
          COUNT(DISTINCT workspace_id)          AS workspaces,
          MAX(updated_at)                       AS ultimo_ajuste
     FROM workspace_settings
    WHERE key LIKE 'dashboard-layout:%'
    GROUP BY 1
    ORDER BY 2 DESC, 3 DESC`
);

tabela(
  "🖥️  TELAS QUE ALGUÉM PERSONALIZOU (o sinal mais direto de uso que temos hoje)",
  telas.rows.map((r) => ({
    tela: r.tela,
    workspaces: Number(r.workspaces),
    "último ajuste": haQuanto(r.ultimo_ajuste),
  }))
);

console.log(
  "\n📌 Isto mostra o que foi MEXIDO, não o que foi OLHADO. Contagem de tela\n" +
  "   aberta exige registrar navegação (fase 2 da tela de admin) — e aí o dado\n" +
  "   começa do zero e a política de privacidade precisa listar a coleta.\n"
);

await client.end();
