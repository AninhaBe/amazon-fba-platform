import { CHAVE_ASSINATURA } from "../billing/runtime";
import { idsDeAdmin } from "../adminWorkspaces";

/**
 * SÓ SINCRONIZA QUEM TEM ASSINATURA ATIVA — ou é admin.
 *
 * Modelo v3, decidido pela dona do produto em 07/09/2026: *"nao tem mais trial,
 * todos os planos passam a valer com o pagamento"*. Não há período de avaliação
 * que conceda sync, e não há classe "sem registro passa".
 *
 * | admin | assinatura | sync      | por quê                        |
 * |-------|------------|-----------|--------------------------------|
 * | sim   | qualquer   | continua  | chave-mestra, por definição    |
 * | não   | `ativa`    | continua  | pagou                          |
 * | não   | `cortada`  | **pausa** | cortou, parou                  |
 * | não   | outro      | **pausa** | desconhecido para tudo         |
 * | não   | ausente    | **pausa** | nunca assinou                  |
 *
 * ⚠️ UMA REGRA, UMA FONTE. Este filtro é a tradução para SQL da MESMA decisão de
 * `src/lib/billing/acesso.ts`, e não uma segunda lógica parecida. Duas regras
 * que hoje coincidem é como uma fica para trás. A equivalência não é promessa:
 * `tests-integracao/acessoPausaSyncEquivale.test.mjs` roda todos os casos da
 * fronteira no Postgres e compara, um a um, com o que `decidirAcesso` devolve.
 *
 * ⚠️ A RETOMADA É DE GRAÇA, e é por isso que isto é um FILTRO e não uma escrita:
 * nada é marcado ao cortar, nada precisa ser desmarcado ao reativar. No ciclo
 * seguinte a conexão volta a ser eleita com o `covered_from` intocado e o
 * scheduler recupera a janela parada pelo caminho que já usa. Uma coluna
 * `pausada` exigiria lembrar de limpá-la — e o dia em que alguém esquecesse, a
 * conta paga ficaria muda.
 *
 * ⚠️ E NÃO OLHA `sync.status`. Reusar a coluna de status daria dois significados
 * a ela — "onde a varredura está" e "se a conta pode rodar" —, que é a família
 * que custou 11 horas de varredura parada em 03/09/2026 (`updated_at`) e um
 * vigia cego em 02/09 (`last_success_at`).
 */
export async function filtroDeAcessoLiberado(alias: string, idsAdmin?: string[]): Promise<string> {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) {
    throw new Error(`Alias inválido para o filtro de acesso: ${alias}`);
  }
  // Os ids vêm da allowlist, resolvidos em tempo de execução. O parâmetro existe
  // para o teste de equivalência poder rodar em qualquer banco — o schema
  // `auth` é do Supabase e não existe no Postgres descartável.
  const admins = idsAdmin ?? (await idsDeAdmin());
  const listaAdmin = admins.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ");

  // ⚠️ NÃO começa com `AND`: quem chama escreve o conector. A primeira versão
  // embutia o `AND` e produzia `WHERE AND NOT EXISTS (...)` no eleitor do
  // TikTok, cujo WHERE começa por este filtro — SQL inválido que o TypeScript
  // não vê, porque para ele é só uma string.

  const ehAdminSql = listaAdmin
    ? `${alias}.workspace_id IN (${listaAdmin})`
    : // Sem allowlist, ninguém é admin — falha fechada, igual a `adminAllowlist.ts`.
      `false`;

  return `(
          ${ehAdminSql}
          OR EXISTS (
            SELECT 1 FROM workspace_settings assinatura_ativa
             WHERE assinatura_ativa.workspace_id = ${alias}.workspace_id
               AND assinatura_ativa.key = '${CHAVE_ASSINATURA}'
               AND assinatura_ativa.value->>'status' = 'ativa'
          )
        )`;
}
