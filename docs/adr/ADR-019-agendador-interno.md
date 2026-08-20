# ADR-019: Agendador interno — o cron sai do GitHub Actions

- **Status:** Aceito
- **Data:** 2026-08-20

## Contexto

O [ADR-003](./ADR-003-cron-github-actions.md) pôs o cron no GitHub Actions por um motivo
que era verdadeiro: *"o Render ignora os crons do vercel.json"*. Duas coisas mataram a
premissa:

1. **A migração para o Fly** ([ADR-015](./ADR-015-compute-em-sao-paulo-com-banco-gerenciado.md)):
   a máquina fica de pé 24/7 de propósito (cache em memória, ADR-002) — o processo pode
   se agendar sozinho.
2. **A cota estourou**: 1.801 dos 2.000 minutos/mês consumidos com 13 dias de ciclo pela
   frente. O intervalo teve de subir de 5 para 15 minutos **por cota, não por técnica** —
   e a lentidão de conciliação da conta grande em 20/08 foi em parte consequência disso.

O GitHub Actions ainda paga três custos permanentes: cota de terceiro, a volta pela
internet pública (Actions → domínio → Fly) e um `CRON_SECRET` viajando por fora.

## Decisão

**Agendador interno no processo do app** (`src/instrumentation.ts`, gancho `register` do
Next.js), armado por `INTERNAL_SCHEDULER=1`:

- Chama **as próprias rotas de cron via localhost** — reusa timeout, idempotência e
  best-effort que as rotas já têm, sem duplicar semântica.
- Syncs a cada **5 minutos** (configurável por `SCHEDULER_SYNC_INTERVAL_MS`), canais
  escalonados 30s entre si; retenção (ADR-016) uma vez por dia.
- Uma execução por rota por vez no processo; entre processos, os **leases no banco**
  (`workspace_marketplace_syncs`) seguem sendo a proteção — o desenho queue-shaped do
  ADR-006 continua intacto.

### Fallback deliberado

O workflow do GitHub Actions **fica ligado a 15 minutos** por um período de observação:
os leases tornam a coexistência inofensiva, e ele cobre restart/travamento da máquina.
Quando o agendador interno se provar (uma semana), o workflow passa a `workflow_dispatch`
apenas (gatilho manual de emergência).

## Alternativas consideradas

- **Máquina agendada do Fly** (`--schedule`): rejeitada — só aceita `hourly/daily/weekly/
  monthly`, sem expressão cron; nosso intervalo é minutos.
- **Importar os módulos de sync direto no agendador** (sem HTTP): rejeitado por ora —
  duplicaria a semântica de erro/timeout das rotas; o loop via localhost custa
  microssegundos e mantém uma só porta de entrada. Reavaliar se as rotas um dia saírem
  do processo web (ADR-013).
- **Ficar no GitHub Actions pagando cota**: rejeitado — paga-se dinheiro para manter
  latência e dependência que o processo resolve de graça.

## Consequências

- ➕ Intervalo volta a ser escolha nossa (5 min hoje; dá para baixar sem custo).
- ➕ Zero cota externa; zero tráfego público de cron; `CRON_SECRET` não viaja mais.
- ➕ A conciliação da conta grande converge ~3× mais rápido (5 min × 15 min).
- ➖ Sync roda no processo web — pressão de memória compartilhada com a tela. Já era
  assim no Render (foi o que derrubou o Free em 15/08); a máquina do Fly tem 1 GB e o
  [ADR-013](./ADR-013-worker-de-sync-separado-do-web.md) continua sendo o caminho quando
  doer.
- ➖ Se a máquina cair, o cron cai junto — mitigado pelo fallback do Actions e pelo
  restart automático do Fly.
- 📌 O **ADR-003 fica Substituído por este** quando o fallback for desligado; até lá os
  dois coexistem de propósito.

Relacionado: [ADR-003](./ADR-003-cron-github-actions.md) ·
[ADR-015](./ADR-015-compute-em-sao-paulo-com-banco-gerenciado.md) ·
[ADR-016](./ADR-016-ciclo-de-vida-do-dado.md) ·
[ADR-013](./ADR-013-worker-de-sync-separado-do-web.md)
