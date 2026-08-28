// Regra de histórico para conta nova (decisão da Ana, 27/08/2026): a primeira
// importação cobre O MÊS VIGENTE — quem conecta no dia 17 vê os 17 dias do mês
// até ali, e daí em diante o histórico cresce para frente com a loja
// sincronizando. Não há aprofundamento retroativo em background; volumetria
// baixa para quem conecta no começo do mês é o comportamento esperado.
// Conexões existentes não são afetadas (o alvo delas já está gravado).

/**
 * Início do mês vigente no fuso de Brasília. O Brasil não tem horário de verão
 * desde 2019, então o deslocamento é fixo em -03:00.
 */
export function inicioDoMesVigente(agora: Date): Date {
  const brasilia = new Date(agora.getTime() - 3 * 3_600_000);
  const ano = brasilia.getUTCFullYear();
  const mes = String(brasilia.getUTCMonth() + 1).padStart(2, "0");
  return new Date(`${ano}-${mes}-01T00:00:00-03:00`);
}
