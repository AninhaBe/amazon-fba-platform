# ADR-003: Cron via GitHub Actions

- **Status:** Aceito
- **Data:** 2026-07 (retroativo)

## Contexto

O sync (backfill/conciliação) e o aquecimento de cache precisam rodar **sem depender
de uma visita** ao dashboard. Os crons declarados em `vercel.json` **só funcionam na
Vercel** — e o SellerCore roda no **Render**, que ignora esse arquivo. Sem um
agendador externo, nada dispara em background.

## Decisão

Um workflow do **GitHub Actions** (`.github/workflows/cron.yml`) que bate a cada
~5 min nos endpoints `/api/cron/*-sync` que já existem, autenticado por
`Authorization: Bearer ${CRON_SECRET}`. Os endpoints se protegem sozinhos com esse
segredo; `/api/cron/*` fica nas `publicPaths` do proxy justamente para que o segredo
seja checado no handler (o proxy os barraria antes).

## Alternativas consideradas

- **Render Cron Jobs.** Viável, mas exige serviço/infra adicional; o GitHub Actions
  reaproveita o que já temos e não custa nada no plano atual.
- **Disparar só nas visitas (`after()`).** Já existe como complemento, mas sozinho
  deixa contas sem tráfego paradas — o cron garante progresso independente de visita.

## Consequências

- ➕ Simples, sem infra extra, secrets no Render + GitHub.
- ➖ **Agendamento é best-effort:** o GitHub afunila o `*/5` de repo privado para
  ~1×/hora sob carga (observado em produção). Para backfill/aquecimento é suficiente.
- ➖ Depende de dois secrets sincronizados: `CRON_SECRET` (Render **e** GitHub) e
  `APP_BASE_URL` (GitHub). Falha transitória de startup do runner é possível e se
  recupera sozinha no ciclo seguinte.
- 🔭 Se um dia precisar de sync **frequente e garantido**, migrar para Render Cron ou
  um pinger externo (cron-job.org).

Detalhe: [`../architecture/sync-engine.md`](../architecture/sync-engine.md#2-agendamento--o-cron).
