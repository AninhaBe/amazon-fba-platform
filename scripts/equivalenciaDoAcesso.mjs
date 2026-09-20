import { filtroDeAcessoLiberado } from "../src/lib/integrations/assinaturaPausaSync.ts";
import { decidirAcesso } from "../src/lib/billing/acesso.ts";

// A EQUIVALENCIA ENTRE AS DUAS METADES DA MESMA REGRA.
//
// A tranca decide em TypeScript (decidirAcesso); o scheduler decide em SQL
// (filtroDeAcessoLiberado). A ordem da dona em 07/09/2026 foi explicita: "uma
// regra, uma fonte; nada de segunda logica que possa divergir". Como SQL nao
// roda em JavaScript, a unica prova possivel e a equivalencia MEDIDA — os
// mesmos casos, nos dois motores, comparados um a um.
//
// ⚠️ ISTO NAO E EXCESSO DE ZELO: a primeira versao do SQL passou na leitura e
// ERROU na execucao. A RegExp que protegia o cast estava dentro de template
// literal, "\d" virou "d", e a conta de trial vencido continuava sincronizando.
// Nenhuma revisao pegou; a medicao pegou na primeira rodada.
//
// ⚠️ E DADO REAL NAO EXERCITA A FRONTEIRA. Um teste que so olhasse o banco de
// hoje ficaria verde com a regra errada dos dois lados. Por isso os casos sao
// FABRICADOS — inclusive os do trial dormente, que existem para reprovar quem
// religar aquela leitura por engano.

export function casosDaFronteira() {
  return [
    // Admin e chave-mestra: entra inclusive cortado, porque um corte acidental
    // trancaria justamente quem precisa entrar para consertar.
    { nome: "admin sem registro nenhum", admin: true, linhas: [], ts: { admin: true, assinatura: null }, esperado: true },
    { nome: "admin com assinatura cortada", admin: true, linhas: [["assinatura", { status: "cortada" }]], ts: { admin: true, assinatura: { status: "cortada" } }, esperado: true },
    { nome: "assinatura ativa", admin: false, linhas: [["assinatura", { status: "ativa" }]], ts: { admin: false, assinatura: { status: "ativa" } }, esperado: true },
    { nome: "assinatura cortada", admin: false, linhas: [["assinatura", { status: "cortada" }]], ts: { admin: false, assinatura: { status: "cortada" } }, esperado: false },
    { nome: "sem assinatura nenhuma", admin: false, linhas: [], ts: { admin: false, assinatura: null }, esperado: false },
    // ⚠️ O TRIAL FICOU DORMENTE no modelo v3: as linhas continuam no banco e nao
    // concedem nada. Se alguem religar a leitura "porque estava la", contas
    // antigas voltam a entrar sem pagar — por isso os dois casos ficam aqui.
    { nome: "trial ativo, sem assinatura", admin: false, linhas: [["trial", { endsAt: "2099-01-01T00:00:00.000Z" }]], ts: { admin: false, assinatura: null }, esperado: false },
    { nome: "trial vencido, sem assinatura", admin: false, linhas: [["trial", { endsAt: "2020-01-01T00:00:00.000Z" }]], ts: { admin: false, assinatura: null }, esperado: false },
    // ⚠️ ESTE CASO SUMIU NO REFACTOR DO V3 (8d15357) e o teste que o exigia so
    // avermelhou na ESTREIA do CI, 13 dias depois (20/09/2026) — a divida do
    // WSL adiou o vermelho. Ele guarda DOIS perigos do dia em que alguem
    // religar a leitura do trial: o cast de endsAt malformado estourando a
    // consulta do canal INTEIRO, e a comparacao ingenua concedendo acesso
    // ("sei la" > qualquer ISO). Enquanto o trial esta dormente, ele prova que
    // linha torta no banco nao muda nada.
    { nome: "trial com endsAt malformado", admin: false, linhas: [["trial", { endsAt: "sei la" }]], ts: { admin: false, assinatura: null }, esperado: false },
    // Status que o tipo nao admite, mas o JSON permite: desconhecido para tudo.
    { nome: "status desconhecido", admin: false, linhas: [["assinatura", { status: "pausada" }]], ts: { admin: false, assinatura: { status: "pausada" } }, esperado: false },
  ];
}

/** Roda um caso no Postgres e devolve o que o SQL do scheduler decide. */
export async function decidirNoSql(consultar, caso) {
  const valores = caso.linhas.length
    ? caso.linhas.map(([k, v]) => `('W','${k}','${JSON.stringify(v)}'::jsonb, now())`).join(", ")
    : `('OUTRO','x','{}'::jsonb, now())`;
  // O alvo se chama "W"; quando o caso e de admin, "W" entra na lista de ids.
  const filtro = await filtroDeAcessoLiberado("alvo", caso.admin ? ["W"] : []);
  const sql = `WITH workspace_settings(workspace_id, key, value, updated_at) AS (VALUES ${valores}),
      alvo(workspace_id) AS (VALUES ('W'))
      SELECT ${filtro} AS liberado FROM alvo`;
  const { rows } = await consultar(sql);
  return rows[0].liberado;
}

/** Devolve a lista de divergencias entre o SQL e a decisao em TypeScript. */
export async function conferirEquivalencia(consultar) {
  const divergencias = [];
  for (const caso of casosDaFronteira()) {
    const noSql = await decidirNoSql(consultar, caso);
    const noTs = decidirAcesso(caso.ts).liberado;
    if (noSql !== noTs || noSql !== caso.esperado) {
      divergencias.push({ caso: caso.nome, noSql, noTs, esperado: caso.esperado });
    }
  }
  return divergencias;
}
