// Agendador interno de sync — ver docs/adr/ADR-019.
//
// Substitui o cron do GitHub Actions (ADR-003) como gatilho principal. A premissa
// do ADR-003 ("o Render ignora os crons do vercel.json") morreu com a migração
// para o Fly (ADR-015): a máquina fica de pé 24/7 por causa do cache em memória
// (ADR-002), então o processo pode se agendar sozinho — sem cota de terceiro,
// sem volta pela internet pública e sem CRON_SECRET viajando.
//
// Desenho de menor risco: em vez de importar os módulos de sync (e duplicar a
// semântica de timeout/erro das rotas), o agendador chama as PRÓPRIAS rotas de
// cron via localhost. Toda a lógica existente — leases no banco, idempotência,
// best-effort — continua valendo. Os leases também impedem trabalho duplicado
// enquanto o GitHub Actions ficar ligado como backup.
//
// Desligado por padrão: só arma com INTERNAL_SCHEDULER=1 (Fly secrets).

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.INTERNAL_SCHEDULER !== "1") return;

  const port = process.env.PORT || "3000";
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[scheduler] INTERNAL_SCHEDULER=1 mas CRON_SECRET ausente; agendador NÃO armado.");
    return;
  }

  const SYNC_INTERVAL_MS = Number(process.env.SCHEDULER_SYNC_INTERVAL_MS || 5 * 60_000);
  const SYNCS = ["amazon-sync", "mercado-livre-sync", "shopee-sync", "tiktok-sync"];
  // Retenção é diária (ADR-016); rodar no intervalo de sync seria 288 expurgos/dia à toa.
  const RETENTION_INTERVAL_MS = 24 * 60 * 60_000;

  const emVoo = new Set<string>();

  async function dispara(rota: string) {
    // Uma execução por rota por vez: se o sync de 5 min atrás ainda roda, pular
    // esta batida é o comportamento certo (o lease no banco faria o mesmo).
    if (emVoo.has(rota)) return;
    emVoo.add(rota);
    const inicio = Date.now();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/cron/${rota}`, {
        headers: { authorization: `Bearer ${secret}` },
        // Syncs têm orçamento de até 4 min nas rotas; folga acima disso.
        signal: AbortSignal.timeout(5 * 60_000),
      });
      console.log(`[scheduler] ${rota}: HTTP ${res.status} em ${Math.round((Date.now() - inicio) / 1000)}s`);
    } catch (error) {
      console.error(`[scheduler] ${rota} falhou:`, error instanceof Error ? error.message : error);
    } finally {
      emVoo.delete(rota);
    }
  }

  // Espera o servidor abrir a porta antes da primeira batida, e escalona os
  // canais (30s entre eles) para não disparar quatro syncs no mesmo segundo.
  SYNCS.forEach((rota, i) => {
    setTimeout(() => {
      void dispara(rota);
      setInterval(() => void dispara(rota), SYNC_INTERVAL_MS);
    }, 15_000 + i * 30_000);
  });
  setTimeout(() => {
    void dispara("retencao");
    setInterval(() => void dispara("retencao"), RETENTION_INTERVAL_MS);
  }, 120_000);

  console.log(`[scheduler] armado: syncs a cada ${SYNC_INTERVAL_MS / 60_000} min, retenção diária.`);
}
