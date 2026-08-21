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

## Desfecho (21/08/2026 — um dia depois, não uma semana)

O plano era manter o Actions como fallback por uma semana. **A cota acabou no dia
seguinte** e o workflow passou a falhar em 3–5 segundos:

```
The job was not started because recent account payments have failed
or your spending limit needs to be increased
```

**E o sync não parou.** Último sucesso do Actions: 21/08 08h59. A conversão de 29 pedidos
`Pending` medida às 14h foi trabalho do agendador interno. O fallback morrer foi o teste
mais honesto possível desta decisão — e ela passou.

Em 21/08 os dois workflows (`cron.yml` e `retencao.yml`) passaram a **`workflow_dispatch`
apenas**: continuam no repo como gatilho manual de emergência, sem agendamento. O
[ADR-003](./ADR-003-cron-github-actions.md) foi marcado como **Substituído**.

📌 **Decisão da dona:** *"assim fica tudo centralizado em um lugar só, no Fly."* Além da
centralização, some o risco de dois agendadores concorrendo — a classe de bug mais difícil
de diagnosticar depois.

### O que agora depende só da máquina do Fly

| | Mitigação |
|---|---|
| Máquina cai → sync para | Fly reinicia sozinho; health check em `/api/health` |
| Agendador não arma (falta `CRON_SECRET`) | loga `INTERNAL_SCHEDULER=1 mas CRON_SECRET ausente` na subida |
| Ninguém percebe que parou | ⚠️ **lacuna real** — não há alerta. Ver "Próximo" |

### ✅ Lacuna fechada em 21/08 — métricas e Grafana

O Fly oferece **Grafana gerenciado de graça** em `fly-metrics.net`, com Prometheus,
coleta a cada 15s e ~15 dias de histórico. Métricas de máquina (CPU, memória, disco,
rede, HTTP, OOM) vêm sem configuração.

Nossas séries de negócio saem de `src/lib/metricas.ts`:

| Métrica | Responde |
|---|---|
| `nexo_sync_idade_segundos{canal}` | **substitui o e-mail de falha do Actions** — parou de cair, parou de sincronizar |
| `nexo_sync_conexoes_com_erro{canal}` | conexão quebrada isolada |
| `nexo_pedidos_pendentes_atrasados{canal}` | pendente há 12h+ — o defeito de 21/08 viraria alarme |
| `nexo_fila_eventos{status}` | a fila que estourou o banco (ADR-016) |
| `nexo_banco_bytes` | o limite de 500 MB do plano |

#### ⚠️ Porta interna, não rota do app

Servidas por um HTTP mínimo na **porta 9091** (`src/instrumentation.ts`), que fica **fora
do `[http_service]`** — o coletor chega pela rede privada do Fly e ninguém de fora
alcança. A primeira versão era `/api/metrics` na porta pública; o proxy de sessão barrou,
e ao ir liberar ficou claro que colocaria **contagem de pedidos e tamanho de banco na
internet aberta**. O bloqueio do proxy fez o papel dele.

#### 🔴 Duas pegadinhas do formato Prometheus, ambas pagas em 21/08

1. **Famílias intercaladas quebram o parser.** Emitir as 3 métricas do amazon, depois as
   3 do tiktok, é inválido: todas as amostras de uma métrica precisam vir **juntas**,
   logo após o `# TYPE`. O coletor não reclama — só entrega série **sem rótulo nenhum**.
   O helper `familia()` existe para essa regra não depender de disciplina.
2. **O coletor do Fly DESCARTA o rótulo `provider`.** Medido: `status` passava, `provider`
   sumia. Renomeado para **`canal`**. 📌 Ao criar métrica nova, conferir no Grafana se o
   rótulo sobreviveu — o sintoma é silencioso.

**Próximo (não feito):** criar o alerta no Grafana sobre `nexo_sync_idade_segundos` (ex.:
disparar acima de 1800s por canal) e um painel com os quatro sinais.

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
