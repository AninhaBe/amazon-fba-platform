# ADR-006: Migração para stack self-hosted open source (Coolify)

- **Status:** Proposto
- **Data:** 2026-07

## Contexto

Objetivo do produto: **máximo de open source e self-hosted**, com custo baixo e sem
lock-in. O momento é ideal porque **ainda não há usuários reais** — o único dado no
banco é de teste + as contas de marketplace da própria dona (recuperáveis por
re-OAuth). Migrar depois, com clientes e dados em produção, seria caro e arriscado.

Stack atual: Next.js 16 no **Render**; **Supabase** para Auth; **Postgres** acessado
por `pg`/`DATABASE_URL` (conexão pura, **não** o client do Supabase); cron de sync no
**GitHub Actions**.

Levantamento do acoplamento (feito no código):
- **Storage do Supabase não é usado** — imagens de produto são URLs externas dos
  marketplaces. Nada a migrar.
- **Banco é Postgres puro** (`dbQuery` → `pg`). Migrar = apontar `DATABASE_URL` +
  `pg_dump`/restore. Sem mudança de código.
- **Auth é a única amarra real** com o Supabase (`@supabase/ssr` + `getClaims`), e está
  centralizado em ~6 arquivos (`proxy.ts`, `workspaceContext.ts`, `login/actions.ts`,
  `auth/confirm`, `supabase/{server,client,proxy}`).

## Decisão

Migrar para **Coolify numa VPS** (ex.: Hetzner), com o banco e o auth self-hosted.

### Topologia — Fase 0: single-server (assumida, não ideal)

> **Isto é uma arquitetura simples e econômica, NÃO resiliente.** Coolify, proxy,
> Next.js, Postgres e a task de sync ficam na mesma máquina: se ela cair/encher/falhar,
> **site, banco e painel caem juntos**. O backup externo evita *perder* dados, não a
> *indisponibilidade* (é preciso subir VPS nova e restaurar). Aceitável na fase sem
> clientes. A fronteira para a fase seguinte está em "Evolução" abaixo.

```
VPS (Coolify)
├── Coolify (control plane)
├── reverse proxy / TLS (Let's Encrypt)
├── SellerCore (Next.js)
├── PostgreSQL  (dados do app + auth, fonte única)
└── scheduled task do sync

Serviços externos
├── S3-compatible (backups do Postgres)   — Backblaze B2 / Cloudflare R2 / Hetzner
├── e-mail transacional (provedor)
├── GitHub (deploy)
└── APIs dos marketplaces (SP-API / ML)
```

### Compute e build
- Deploy do Next.js via Git push (Coolify). Render mantido em paralelo até o cutover.
- **Não assumir folga de RAM numa VPS pequena.** Build do Next.js é pesado e disputa
  recursos com o Postgres. Preferir **build fora do box de produção** (imagem via CI /
  registry) ou dimensionar a VPS com margem. Tamanho é ponto de partida, não garantia.

### Capacidade (estimativa inicial — revisar com métrica real)
Ordem de grandeza para dimensionar, **não** número fixo (validar com uso real):

| Workspaces ativos | Alvo |
|---|---|
| até ~5 | CX22 (2 vCPU, 4 GB) — com build fora do box |
| até ~50 | CX32 (4 vCPU, 8 GB) |
| ~300+ | servidor dedicado / **separar banco e app** (ver "Evolução") |

Gatilho de revisão: uso de RAM/CPU, conexões do Postgres e duração dos syncs (ver
"Monitoramento"). O número real substitui a estimativa assim que houver medição.

### Banco
- Postgres gerenciado pelo Coolify, **fonte única** de dados do app e do auth.

### Backup (requisito duro — não basta "diário para S3")
- Backup **diário**, **fora da VPS** (S3-compatible), **retenção definida**,
  **notificação de falha** (Coolify notifica falha de backup/task/servidor) e
  **restore testado periodicamente** (drill), obrigatoriamente **antes do cutover**.
- Lembrar: o backup da instância do Coolify **não** cobre automaticamente os dados/volumes
  das aplicações — o backup do Postgres é o que protege os dados de negócio.

### Auth: Better Auth (detalhado em ADR-007)
- **Better Auth** roda como biblioteca no próprio app, tabelas no mesmo Postgres.
  Substitui `@supabase/ssr`/GoTrue — sem container extra, sem Kong, sem Supabase.
- **Autenticação ≠ autorização:** Better Auth resolve *quem é o usuário*; o isolamento
  por workspace continua responsabilidade do SellerCore, **auditado rota a rota**.
- Modelo **desacoplado** `users` / `workspaces` / `workspace_members(role)`; tabelas de
  negócio em `workspace_id`. v1 cria 1 workspace por cadastro (owner), sem UI de time.
- E-mail de confirmação/reset via **provedor transacional externo** (ver "E-mail").
- Decisão completa (modelo, sessão, autorização, teste de isolamento cruzado):
  **[ADR-007](./ADR-007-arquitetura-de-auth.md)**.

### Cron / sync (agendar ≠ processar de forma confiável)
- GitHub Actions → **Scheduled Task do Coolify** batendo no endpoint de sync com
  `CRON_SECRET`.
- Endpoint endurecido: **só autenticado**, **idempotente**, **dedupe por conta**
  (reaproveitar `workspace_marketplace_materialization_leases`, que já existe), registro
  de **início/fim/status** (via `workspace_marketplace_syncs`), timeout controlado,
  seguro a retry, sem rodar duas syncs da mesma conta ao mesmo tempo.
- **Contrato queue-shaped desde já, sem infra nova:** a Scheduled Task **cria um
  `sync_run`** (fila **no próprio Postgres** — `workspace_marketplace_syncs`); um worker o
  processa e atualiza status. Na v1 o worker roda inline (mesmo processo, disparado por
  HTTP), mas o formato já é de fila — dá para extrair um worker/fila dedicada depois **sem
  redesenhar** e **sem Redis agora** (coerente com "não instalar serviço extra à toa").
  Jobs longos não devem depender de uma requisição HTTP ficar aberta.

### E-mail transacional
- Provedor externo (com free tier no início). **Única concessão** ao "100% OSS": SMTP
  self-hosted tem entregabilidade ruim (SPF/DKIM/reputação de IP). Escolho confiabilidade.

### Segredos
- Migrados para o env do Coolify. **Rotacionar de uma vez** os que vazaram em chat:
  chaves do Supabase se aposentam; novo `CRON_SECRET`, credenciais do banco,
  `BETTER_AUTH_SECRET`, credenciais SP-API/ML.

### Monitoramento (mínimo)
- RAM, CPU, disco, tamanho de logs, conexões do Postgres, duração dos syncs, tempo de
  resposta e **falhas de backup** (notificações do Coolify).
- **Não instalar serviços extras "porque cabem"** (n8n, Redis, MinIO): cada um aumenta
  responsabilidade e consumo.

### Dados (recomeço limpo)
- Sem usuários reais → **começar do zero**: recriar o login e reconectar as contas de
  marketplace (re-OAuth). Sem gambiarra de mapeamento de IDs antigos.

## Sequência de migração (reversível até o cutover)
1. VPS + Coolify no ar.
2. Postgres no Coolify + backup S3 + **teste de restore**.
3. Deploy do Next.js no Coolify (Render segue em paralelo).
4. Better Auth: implementar auth **e** reautorização por workspace (branch), incluindo o
   modelo users/workspaces/members e o fluxo de e-mail.
5. Cron → Scheduled Task do Coolify (endpoint endurecido).
6. E-mail transacional configurado.
7. Rotacionar todos os segredos.
8. **Cutover de DNS** → período de soak → desligar Render + Supabase.

**Rollback:** Render + Supabase de pé até validar; se falhar, DNS volta. Risco de *dados*
baixo (backups + sem clientes); risco de *disponibilidade* existe (single-server).

## Alternativas consideradas
- **Self-hostear o Supabase inteiro** (GoTrue+PostgREST+Storage+Realtime+Kong+Studio):
  rejeitado — muitos serviços para manter só por causa do auth, que hoje é a única amarra.
- **Manter Supabase Cloud só para Auth:** rejeitado — deixa uma dependência SaaS, contra o
  objetivo de self-hosted/OSS. (Continua como plano B de baixo esforço se o Better Auth
  travar.)
- **Outro PaaS gerenciado (Railway/Fly):** rejeitado — não atende custo/OSS/controle.

## Consequências
- ➕ ~100% open source e self-hosted; custo baixo; menos peças que o Supabase completo.
- ➕ Dados + auth no mesmo Postgres (mais simples, transacional).
- ➕ Modelo de tenancy correto desde já (users/workspaces/members), pronto para times.
- ➖ **Ponto único de falha** na Fase 0 (single-server) — mitigado por backup + soak, não
  eliminado.
- ➖ Você assume **ops de infra** (patch, backup, uptime, monitoramento) — mitigado pela
  automação do Coolify, mas é compromisso contínuo.
- ➖ Rework de auth **e autorização** (não é "trocar 6 arquivos"): identidade + sessão +
  workspace + middleware + recuperação de senha + e-mail. Escopo real, feito na melhor
  janela (sem usuários).
- ➖ E-mail depende de provedor externo (concessão consciente por entregabilidade).

## Evolução (quando sair da Fase 0)
Ao ter **clientes pagantes** ou exigência de disponibilidade:
- **Separar banco e aplicação** (Postgres em host próprio / gerenciado).
- Avaliar réplica/PITR e redundância do app.
Este ADR cobre a Fase 0; a separação é um ADR futuro.

Relacionado: escopo por workspace em [`../architecture/read-and-cache.md`](../architecture/read-and-cache.md);
segurança/segredos em [`AGENTS.md`](../../AGENTS.md).
