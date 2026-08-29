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

import { lerResultadoDoCron } from "./lib/schedulerResult";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.INTERNAL_SCHEDULER !== "1") return;

  const port = process.env.PORT || "3000";
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[scheduler] INTERNAL_SCHEDULER=1 mas CRON_SECRET ausente; agendador NÃO armado.");
    return;
  }

  // 5 → 2 minutos em 21/08/2026 (ADR-023). Sem push da Amazon — ela só entrega em
  // SQS/EventBridge, e a conta AWS foi recusada —, o intervalo do agendador VIRA o
  // teto do frescor. Com 5 minutos, baixar a janela do sync para 2 não adiantava
  // nada: as duas travas são em série, e a maior manda.
  //
  // Fica registrado que isto é polling, não tempo real. O desenho de push está em
  // ADR-023, pronto para o dia em que o atraso incomodar mais que a infra nova.
  const SYNC_INTERVAL_MS = Number(process.env.SCHEDULER_SYNC_INTERVAL_MS || 2 * 60_000);
  const TODOS_OS_SYNCS = ["amazon-sync", "mercado-livre-sync", "shopee-sync", "tiktok-sync"];
  /**
   * Freio POR CANAL — `SCHEDULER_CANAIS=shopee-sync,amazon-sync`.
   *
   * ⚠️ Existe por causa do incidente de 29/08/2026: para parar a fonte de
   * demanda foi preciso desligar o agendador INTEIRO (`INTERNAL_SCHEDULER=0`),
   * e para religar não havia como subir um canal de cada vez. Voltar os quatro
   * juntos depois de um incidente é subir a variável e o controle no mesmo
   * movimento: se der ruim, não se sabe se foi o canal suspeito ou o religamento.
   *
   * Vazio ou ausente = todos, que é o comportamento normal. Nome desconhecido é
   * ignorado com aviso, em vez de derrubar o agendador por um erro de digitação.
   */
  const pedidos = (process.env.SCHEDULER_CANAIS ?? "")
    .split(",").map((nome) => nome.trim()).filter(Boolean);
  const desconhecidos = pedidos.filter((nome) => !TODOS_OS_SYNCS.includes(nome));
  if (desconhecidos.length) {
    console.error(`[scheduler] SCHEDULER_CANAIS ignora nome desconhecido: ${desconhecidos.join(", ")}`);
  }
  const SYNCS = pedidos.length ? TODOS_OS_SYNCS.filter((nome) => pedidos.includes(nome)) : TODOS_OS_SYNCS;
  if (SYNCS.length !== TODOS_OS_SYNCS.length) {
    console.log(`[scheduler] rodando SO os canais: ${SYNCS.join(", ") || "(nenhum)"}`);
  }
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
      const segundos = Math.round((Date.now() - inicio) / 1000);
      // Status NÃO basta: a rota responde 200 com `ok:false` + `falhas{}` quando
      // um passo best-effort quebra. Ver `lerResultadoDoCron`.
      const corpo = await res.json().catch(() => null);
      const { falhou, detalhe } = lerResultadoDoCron(res.status, corpo);
      if (falhou) {
        console.error(`[scheduler] ${rota}: HTTP ${res.status} em ${segundos}s — ${detalhe}`);
      } else {
        console.log(`[scheduler] ${rota}: HTTP ${res.status} em ${segundos}s`);
      }
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

  // ---------------------------------------------------------------- métricas
  // Servidor HTTP mínimo numa porta INTERNA, só para o coletor do Fly (ADR-019).
  //
  // Por que não uma rota do app: a porta pública passa pelo proxy de sessão, e
  // liberar `/api/metrics` no `publicPaths` colocaria contagem de pedidos e
  // tamanho de banco na internet aberta. O coletor do Fly alcança a máquina pela
  // rede privada (6PN), então a porta 9091 nunca é publicada — está fora do
  // `[http_service]` do fly.toml de propósito.
  const METRICS_PORT = Number(process.env.METRICS_PORT || 9091);
  try {
    const { createServer } = await import("node:http");
    const { coletarMetricas } = await import("./lib/metricas");
    createServer(async (req, res) => {
      if (req.url?.split("?")[0] !== "/metrics") {
        res.writeHead(404).end();
        return;
      }
      try {
        const corpo = await coletarMetricas();
        res.writeHead(200, { "content-type": "text/plain; version=0.0.4" }).end(corpo);
      } catch {
        res.writeHead(200, { "content-type": "text/plain; version=0.0.4" }).end("nexo_metricas_ok 0" + String.fromCharCode(10));
      }
    }).listen(METRICS_PORT, "::", () => {
      console.log(`[metricas] servindo /metrics na porta interna ${METRICS_PORT}`);
    });
  } catch (error) {
    console.error("[metricas] nao subiu:", error instanceof Error ? error.message : error);
  }
}
