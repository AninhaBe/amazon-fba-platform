// Formatação de data/hora sempre no fuso do Brasil (America/Sao_Paulo),
// independente do fuso do navegador ou do servidor. Sem isso, um navegador em
// UTC (ou o SSR no Render) mostra horários 3h adiantados.

const BR_TZ = "America/Sao_Paulo";

export function brTime(value: Date | string, withSeconds = false): string {
  return new Date(value).toLocaleTimeString("pt-BR", {
    timeZone: BR_TZ,
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
  });
}

// Data SEM hora ("2026-08-25") é parseada como meia-noite UTC — que em Brasília
// é 21h do dia ANTERIOR. A tela mostrava um dia a menos, e ninguém percebia
// porque timestamp completo (com offset) passa correto.
//
// Não é caso raro: `amazonOverviewCanonical`, `mercadoLivreOverviewCanonical` e
// `shopeeOverviewCanonical` projetam
// `to_char(occurred_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')` — data
// já convertida para o fuso certo, que o parse de UTC empurrava de volta.
//
// Ancoramos em -03:00 e não no fuso da máquina: o servidor roda em UTC, então
// "T00:00:00" sem offset reintroduziria exatamente o mesmo erro. O Brasil não
// tem horário de verão desde 2019, então o offset é fixo.
const SOMENTE_DATA = /^\d{4}-\d{2}-\d{2}$/;

export function brDate(value: Date | string): string {
  const ancorado =
    typeof value === "string" && SOMENTE_DATA.test(value) ? `${value}T00:00:00-03:00` : value;
  return new Date(ancorado).toLocaleDateString("pt-BR", { timeZone: BR_TZ });
}
