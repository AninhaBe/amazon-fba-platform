/**
 * A CADÊNCIA DE SINCRONIZAÇÃO DE CADA CANAL — uma fonte só.
 *
 * ⚠️ POR QUE ISTO SAIU DE DENTRO DO AGENDADOR (02/09/2026): o vigia de defasagem
 * precisa saber de quanto em quanto tempo cada canal DEVERIA sincronizar para
 * decidir se ele parou. Copiar os números para o vigia criaria duas listas que
 * coincidem hoje — e a regra da casa, escrita depois do imposto que ficou na
 * base errada, é que **os dois leiam a mesma variável, em vez de duas variáveis
 * que por acaso coincidem hoje**. Se alguém mudar a cadência da Shopee de 3 para
 * 10 minutos, o alarme muda junto, sem ninguém lembrar.
 *
 * Os intervalos são MEDIDOS, não arbitrados (29/08/2026). O ritmo real de
 * chegada de pedido, em 7 dias de contas reais:
 *
 * | canal | pedidos/hora | mediana entre pedidos | intervalo |
 * |---|---:|---:|---:|
 * | Shopee | 14,1 | 2,3 min | 3 min |
 * | Mercado Livre | 6,5 | 4,9 min | 5 min |
 * | TikTok | 2,8 | 11,3 min | 10 min |
 * | Amazon | 1,8 | 18,3 min | 10 min |
 *
 * O ML leva 5 e não 10 porque tem webhook: o urgente chega por lá.
 */

/** Rota de cron de cada provider canônico. */
export const ROTA_DE_SYNC: Record<string, string> = {
  shopee: "shopee-sync",
  mercado_livre: "mercado-livre-sync",
  tiktok_shop: "tiktok-sync",
  amazon: "amazon-sync",
};

export const INTERVALO_PADRAO_MS = Number(process.env.SCHEDULER_SYNC_INTERVAL_MS || 2 * 60_000);

export const INTERVALO_POR_CANAL: Record<string, number> = {
  "shopee-sync": Number(process.env.SCHEDULER_INTERVALO_SHOPEE_MS || 3 * 60_000),
  "mercado-livre-sync": Number(process.env.SCHEDULER_INTERVALO_ML_MS || 5 * 60_000),
  "tiktok-sync": Number(process.env.SCHEDULER_INTERVALO_TIKTOK_MS || 10 * 60_000),
  "amazon-sync": Number(process.env.SCHEDULER_INTERVALO_AMAZON_MS || 10 * 60_000),
};

export function intervaloDaRota(rota: string) {
  return process.env.SCHEDULER_SYNC_INTERVAL_MS
    ? INTERVALO_PADRAO_MS
    : (INTERVALO_POR_CANAL[rota] ?? INTERVALO_PADRAO_MS);
}

/**
 * Quantos ciclos perdidos até o vigia gritar.
 *
 * ⚠️ CINCO, e o número tem razão medida. Um ciclo perdido é rotina: o agendador
 * pula quando a execução anterior ainda roda, e o sync tem orçamento de até 4
 * minutos. Dois ou três é um deploy, uma reinicialização de máquina, um pico.
 * Cinco ciclos seguidos sem sucesso não é ruído — é o canal parado.
 *
 * 📌 E o preço de errar é assimétrico, por isso o número é generoso: alarme que
 * dispara à toa é ignorado em uma semana, e aí o alarme de verdade também passa
 * despercebido. Vigia que grita sem motivo não é vigia, é ruído com autoridade.
 */
export const CICLOS_ATE_ALARMAR = 5;

/**
 * SILÊNCIO DO PUSH — o limite, e a razão de ele ser tão diferente do da varredura.
 *
 * MEDIDO em 22,7 horas de push real da Shopee (02–03/09/2026), 3.104 intervalos:
 *
 * | métrica | intervalo entre pushes |
 * |---|---:|
 * | mediana | 0,1 min (6 s) |
 * | p95 | 1,9 min |
 * | p99 | 5,1 min |
 * | **maior silêncio observado** | **21,3 min** |
 *
 * E por hora do dia (BRT), a madrugada é o vale: 25–30 pushes/hora entre 4h e 6h,
 * ou seja **um push a cada ~2,4 minutos mesmo no pior horário**.
 *
 * O limite é **60 minutos** — cerca de 3× o maior silêncio já visto. Generoso de
 * propósito, e por dois motivos:
 *
 * 1. 22,7 horas não contêm um domingo de madrugada, que é o vale que ainda não
 *    medimos. Apertar agora seria calibrar num pedaço da semana;
 * 2. alarme que dispara à toa é desligado, e aí o alarme de verdade morre junto.
 *
 * ⚠️ QUANDO HOUVER UMA SEMANA DE DADO, RECALIBRAR — e o jeito certo é refazer
 * esta tabela, não chutar para baixo porque "parece muito".
 */
export const LIMITE_PUSH_MUDO_MS = Number(process.env.LIMITE_PUSH_MUDO_MS || 60 * 60_000);

/** Canais que entregam push hoje. Quem não está aqui não tem silêncio a vigiar. */
export const CANAIS_COM_PUSH = new Set(["shopee", "mercado_livre"]);

/** Limite de silêncio de um canal, derivado da própria cadência dele. */
export function limiteDeSilencioMs(provider: string) {
  const rota = ROTA_DE_SYNC[provider];
  return intervaloDaRota(rota ?? "") * CICLOS_ATE_ALARMAR;
}
