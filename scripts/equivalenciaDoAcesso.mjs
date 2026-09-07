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
// ⚠️ E DADO REAL NAO EXERCITA A FRONTEIRA. Hoje nenhuma conta tem assinatura
// gravada — um teste que so olhasse o banco de hoje ficaria verde com a regra
// errada nos dois lados. Por isso os casos sao FABRICADOS, e cobrem os quatro
// da fronteira mais os tres que ja morderam.

const dia = 86_400_000;

export function casosDaFronteira(agora = Date.now()) {
  const ontem = new Date(agora - dia).toISOString();
  const amanha = new Date(agora + dia).toISOString();
  return [
    { nome: "cortada, sem trial", linhas: [["assinatura", { status: "cortada" }]], ts: { assinatura: { status: "cortada" }, trial: null }, esperado: false },
    { nome: "cortada + trial ativo", linhas: [["assinatura", { status: "cortada" }], ["trial", { endsAt: amanha }]], ts: { assinatura: { status: "cortada" }, trial: { expired: false } }, esperado: false },
    { nome: "ativa + trial vencido", linhas: [["assinatura", { status: "ativa" }], ["trial", { endsAt: ontem }]], ts: { assinatura: { status: "ativa" }, trial: { expired: true } }, esperado: true },
    { nome: "sem assinatura, trial vencido", linhas: [["trial", { endsAt: ontem }]], ts: { assinatura: null, trial: { expired: true } }, esperado: false },
    { nome: "sem assinatura, trial ativo", linhas: [["trial", { endsAt: amanha }]], ts: { assinatura: null, trial: { expired: false } }, esperado: true },
    { nome: "sem registro nenhum", linhas: [], ts: { assinatura: null, trial: null }, esperado: true },
    // Sem esta linha, uma conta com dado torto derrubaria a consulta e pararia
    // o canal inteiro para todo mundo.
    { nome: "trial com endsAt malformado", linhas: [["trial", { endsAt: "sei la" }]], ts: { assinatura: null, trial: null }, esperado: true },
  ];
}

/** Roda um caso no Postgres e devolve o que o SQL do scheduler decide. */
export async function decidirNoSql(consultar, caso) {
  const valores = caso.linhas.length
    ? caso.linhas.map(([k, v]) => `('W','${k}','${JSON.stringify(v)}'::jsonb, now())`).join(", ")
    : `('OUTRO','x','{}'::jsonb, now())`;
  const sql = `WITH workspace_settings(workspace_id, key, value, updated_at) AS (VALUES ${valores}),
      alvo(workspace_id) AS (VALUES ('W'))
      SELECT ${filtroDeAcessoLiberado("alvo")} AS liberado FROM alvo`;
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
