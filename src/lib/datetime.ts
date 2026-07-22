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

export function brDate(value: Date | string): string {
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: BR_TZ });
}
