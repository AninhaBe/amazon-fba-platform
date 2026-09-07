/**
 * CONTA CORTADA NÃO SINCRONIZA — decidido pela dona do produto em 07/09/2026:
 * "cortou, parou; reativou, retoma e recupera o período parado".
 *
 * ⚠️ SINAL PRÓPRIO, DE PROPÓSITO. O filtro olha `workspace_settings.assinatura`,
 * e não `sync.status`. Marcar a conexão como pausada dentro da própria coluna de
 * status daria dois significados a ela — "onde a varredura está" e "se a conta
 * pode rodar" — que é literalmente a família de defeito que custou 11 horas de
 * varredura parada em 03/09/2026 (`updated_at`) e um vigia cego em 02/09
 * (`last_success_at`). Aqui o estado da assinatura mora onde a assinatura mora.
 *
 * ⚠️ A RETOMADA É DE GRAÇA, e é por isso que o desenho é um filtro e não uma
 * escrita: nada é marcado quando corta, nada precisa ser desmarcado quando
 * reativa. No ciclo seguinte a conexão volta a ser eleita com o `covered_from`
 * intocado, e o scheduler recupera a janela parada pelo mesmo caminho que já usa
 * para qualquer conexão que ficou para trás. Uma coluna `pausada` exigiria
 * lembrar de limpá-la — e o dia em que alguém esquecer, a conta paga fica muda.
 *
 * ⚠️ O QUE ESTE FILTRO NÃO COBRE: conta com **avaliação vencida** (sem
 * assinatura nenhuma) continua sincronizando. Isso é intencional e é o mundo de
 * hoje — a ordem foi sobre conta cortada. Se a decisão mudar, é só trocar a
 * condição do `->>'status'` por uma que também alcance o trial; o lugar é este,
 * e é um só.
 */
export function filtroDeAssinaturaAtiva(alias: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) {
    throw new Error(`Alias inválido para o filtro de assinatura: ${alias}`);
  }
  // ⚠️ NÃO começa com `AND`: quem chama escreve o conector. A primeira versão
  // embutia o `AND` e produzia `WHERE AND NOT EXISTS (...)` no eleitor do
  // TikTok, cujo WHERE começa por este filtro — SQL inválido que o TypeScript
  // não vê, porque para ele é só uma string.
  return `NOT EXISTS (
          SELECT 1 FROM workspace_settings assinatura_do_workspace
           WHERE assinatura_do_workspace.workspace_id = ${alias}.workspace_id
             AND assinatura_do_workspace.key = 'assinatura'
             AND assinatura_do_workspace.value->>'status' = 'cortada'
        )`;
}
