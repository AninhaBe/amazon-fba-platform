/**
 * Saturação do sync — a régua que diz se o cron PAROU (Monitor Unificado, E0).
 *
 * O monitor mostra número que depende do cron estar girando. Quando o ciclo
 * trava (lease presa, token caído, worker morto), a tela continua bonita com
 * dado velho — e a pessoa decide em cima dele. Esta régua compara o
 * `last_success_at` da conexão com o ciclo esperado do canal e acusa atraso
 * quando a defasagem passa de 3× o ciclo.
 *
 * ⚠️ SILÊNCIO NA PRIMEIRA SINCRONIZAÇÃO É OBRIGATÓRIO (decisão do plano
 * aprovado em 28/08/2026): conta recém-conectada ainda não tem `covered_from`
 * nem `last_success_at` — alarme aqui seria falso por construção, gritando
 * "atrasado" para quem acabou de conectar. Sem os dois campos, o estado é
 * `silencio` e a tela não mostra NADA (nem "sincronizado": afirmar sincronismo
 * sem um sucesso registrado seria inventar dado).
 */

export type ProviderComCiclo = "amazon" | "mercado_livre" | "shopee" | "tiktok_shop";

/**
 * Ciclo esperado por canal, em minutos — espelha o agendamento real do cron
 * (ML/Amazon a cada tick de 2min; Shopee/TikTok em ticks mais espaçados).
 * Mudou o cron? Muda AQUI, senão o alerta mente para os quatro canais.
 */
export const CICLO_ESPERADO_MIN: Record<ProviderComCiclo, number> = {
  amazon: 2,
  mercado_livre: 2,
  shopee: 10,
  tiktok_shop: 10,
};

/**
 * 3× o ciclo antes de acusar atraso: um ciclo perdido acontece (deploy,
 * rate-limit, fila cheia) e não é notícia; três seguidos é máquina parada.
 */
export const FATOR_DE_ALERTA = 3;

export type EstadoDeSaturacao =
  | { estado: "silencio" }
  | { estado: "sincronizado" | "atrasado"; minutosAtras: number; cicloEsperadoMin: number };

export function saturacaoDoSync(entrada: {
  coveredFrom: string | null;
  lastSuccessAt: string | null;
  cicloEsperadoMin: number;
  agoraMs: number;
}): EstadoDeSaturacao {
  if (entrada.coveredFrom == null || entrada.lastSuccessAt == null) return { estado: "silencio" };
  const ultimoMs = Date.parse(entrada.lastSuccessAt);
  if (!Number.isFinite(ultimoMs)) return { estado: "silencio" };
  const minutosAtras = Math.max(0, Math.floor((entrada.agoraMs - ultimoMs) / 60_000));
  return {
    estado: minutosAtras > entrada.cicloEsperadoMin * FATOR_DE_ALERTA ? "atrasado" : "sincronizado",
    minutosAtras,
    cicloEsperadoMin: entrada.cicloEsperadoMin,
  };
}

/**
 * Com mais de uma conexão no canal, a tela mostra UMA linha: a pior. Atrasado
 * ganha de sincronizado; entre iguais, ganha o mais defasado. Só é silêncio se
 * TODAS estiverem em primeira sincronização.
 */
export function piorSaturacao(estados: EstadoDeSaturacao[]): EstadoDeSaturacao {
  let pior: EstadoDeSaturacao = { estado: "silencio" };
  for (const atual of estados) {
    if (atual.estado === "silencio") continue;
    if (pior.estado === "silencio") {
      pior = atual;
      continue;
    }
    if (atual.estado === "atrasado" && pior.estado !== "atrasado") {
      pior = atual;
      continue;
    }
    if (atual.estado === pior.estado && atual.minutosAtras > pior.minutosAtras) pior = atual;
  }
  return pior;
}

/** "há menos de 1 min", "há 7 min", "há 3 h" — sem falsa precisão acima de 2 h. */
export function formatarDefasagem(minutos: number): string {
  if (minutos < 1) return "menos de 1 min";
  if (minutos < 120) return `${minutos} min`;
  return `${Math.floor(minutos / 60)} h`;
}
