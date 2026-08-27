/**
 * Lê o RESULTADO de uma rota de cron — não só o status HTTP.
 *
 * ⚠️ HTTP 200 não é sinal de sucesso aqui. As rotas de cron rodam passos
 * best-effort: uma falha não derruba o ciclo, e a rota responde 200 com
 * `ok: false` e `falhas: { passo: motivo }` no corpo
 * (`src/app/api/cron/amazon-sync/route.ts`). O agendador só olhava
 * `res.status` e logava `HTTP 200 em 14s`, então dois passos da Amazon
 * (`warm` e `insights`) ficaram quebrados de 27/07 a 27/08/2026 sem nunca
 * virar alarme — o mesmo defeito de fundo do contador do ledger do TikTok:
 * falha que vira número silencioso não existe para ninguém.
 *
 * Puro e sem rede de propósito: é o que o teste consegue exercitar sem subir
 * servidor.
 */
export interface ResultadoDoCron {
  falhou: boolean;
  /** O que dizer no log. `null` quando correu tudo bem. */
  detalhe: string | null;
}

export function lerResultadoDoCron(status: number, corpo: unknown): ResultadoDoCron {
  if (status < 200 || status >= 300) {
    return { falhou: true, detalhe: `HTTP ${status}` };
  }
  const dados = (corpo ?? {}) as { ok?: unknown; falhas?: unknown; error?: unknown };
  const falhas =
    dados.falhas && typeof dados.falhas === "object" && !Array.isArray(dados.falhas)
      ? Object.entries(dados.falhas as Record<string, unknown>)
      : [];
  // `ok` ausente = rota que ainda não reporta passos (ML, Shopee, TikTok,
  // retenção). Sem afirmação de falha, não inventamos uma.
  if (dados.ok !== false && falhas.length === 0) return { falhou: false, detalhe: null };
  const passos = falhas.length
    ? falhas.map(([passo, motivo]) => `${passo}: ${String(motivo)}`).join(" | ")
    : String(dados.error ?? "a rota reportou ok:false sem detalhar");
  return { falhou: true, detalhe: `passo(s) com falha — ${passos}` };
}
