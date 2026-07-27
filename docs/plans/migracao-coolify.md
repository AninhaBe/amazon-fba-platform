# Plano de implementação — Migração self-hosted (Coolify)

Deriva do [ADR-006](../adr/ADR-006-migracao-self-hosted-coolify.md). Ordem pensada para
ser **reversível até o cutover** (Render + Supabase de pé o tempo todo).

Legenda: 🤖 = código/tarefa do Claude (dá para fazer/local, sem depender da VPS) ·
👤 = ação de infra/conta da usuária · ✅ = critério de verificação.

> **Paralelismo:** a Fase D (Better Auth) é a maior peça de código e **não depende da
> VPS** — dá para desenvolver e testar local contra um Postgres local enquanto a usuária
> provisiona a infra (Fases A–B). É o melhor ponto de partida do lado do código.

---

## Fase 0 — Inventário do estado atual (🤖 + 👤)
Antes de tocar em infra, documentar o que existe hoje — evita "qual era mesmo aquela
variável?" meses depois.
- [ ] 0.1. 🤖 Inventariar: variáveis de ambiente, segredos em uso, integrações/OAuth
      (Amazon SP-API, Mercado Livre), webhooks, cron atual (GitHub Actions), domínios/DNS,
      provedor de e-mail (hoje Supabase), buckets.
- [ ] 0.2. 🤖 Registrar num doc versionado (`docs/plans/inventario-migracao.md`).
- ✅ Inventário completo e atualizado do que precisa migrar.

## Fase A — Infra base (👤, guiado por mim)
- [ ] A1. 👤 Provisionar VPS (Hetzner recomendado). **CX32** (4 vCPU, 8 GB, 80 GB,
      €6,80/mês) para conforto com build + Postgres; **CX22** (2 vCPU, 4 GB, €3,79/mês)
      só se o build for feito fora do box. Ubuntu LTS.
- [ ] A2. 👤 Instalar Coolify (script oficial). Proteger o painel (senha forte, e
      idealmente restringir a porta do painel).
- [ ] A3. 👤 Subdomínio de **staging** (ex.: `staging.seudominio`) apontando para a VPS,
      para validar tudo antes do cutover.
- ✅ Coolify acessível via HTTPS no subdomínio; painel protegido.

## Fase B — Postgres + backups (👤 + 🤖 scripts)
- [ ] B1. 👤 Criar PostgreSQL no Coolify (não expor a porta publicamente).
- [ ] B2. 👤 Criar bucket S3-compatible (Backblaze B2 / Cloudflare R2 / Hetzner) + chaves.
- [ ] B3. 👤 Configurar backup no Coolify: **diário**, destino S3, **retenção** definida,
      **notificação de falha** ligada.
- [ ] B4. 🤖 Script/checklist de **restore drill** (subir um Postgres temporário e
      restaurar o último dump) — documentar o passo a passo.
- [ ] B5. 👤 Executar o restore drill **uma vez** e confirmar que os dados voltam.
- ✅ Backup roda, aparece no S3, e um restore de teste funcionou.

## Fase C — App no Coolify mantendo Supabase Auth (intermediário, baixo risco)
Objetivo: validar deploy + Postgres novo + cron **sem** tocar no auth ainda.
- [ ] C1. 🤖 Confirmar build (Nixpacks vs Dockerfile) e variáveis de ambiente
      necessárias; documentar. Preferir **build fora do box** (CI/registry) para não
      estourar RAM da VPS.
- [ ] C2. 👤 Criar a aplicação no Coolify a partir do GitHub; setar env (inclui, por ora,
      as chaves do Supabase Auth ainda vigentes) e `DATABASE_URL` → Postgres do Coolify.
- [ ] C3. 🤖/👤 Copiar dados atuais: `pg_dump` do Postgres do Supabase → restore no
      Postgres do Coolify (só para o teste intermediário; será substituído no recomeço
      limpo da Fase D).
- [ ] C4. 🤖 **Endurecer o endpoint de sync** (pré-requisito do cron): só autenticado,
      idempotente, **dedupe por conta** reaproveitando `workspace_marketplace_materialization_leases`,
      registro início/fim/status em `workspace_marketplace_syncs`, timeout, seguro a retry.
- [ ] C5. 👤 Criar **Scheduled Task** no Coolify chamando o sync com `CRON_SECRET`
      (substitui o GitHub Actions). Manter o Actions desligado, não removido.
- [ ] C6. 👤/🤖 Smoke test no staging: app sobe, lê/escreve no Postgres novo, um ciclo de
      sync roda pela scheduled task.
- ✅ App funcional no Coolify + Postgres novo + sync pela task, com Supabase Auth ainda.

## Fase C.5 — Observabilidade (👤 + 🤖) — logo após o deploy, antes de mexer no auth
Se algo quebrar na troca de auth, a visibilidade já está pronta.
- [ ] C.5.1. 👤 Ligar **notificações do Coolify** (falha de backup, de task, queda do servidor).
- [ ] C.5.2. 🤖/👤 Métricas básicas visíveis: RAM, CPU, disco, tamanho de logs, conexões do
      Postgres, duração dos syncs, tempo de resposta.
- [ ] C.5.3. 🤖 Logs estruturados de início/fim/erro do sync (via `sync_run`).
- ✅ Logs, métricas e alertas no ar **antes** da Fase D.

## Fase D — Troca de Auth para Better Auth (🤖, a maior peça de código)
Desenho completo em **[ADR-007](../adr/ADR-007-arquitetura-de-auth.md)**. Pode começar
**agora, local**. Introduz identidade + tenancy correta + autorização.
- [ ] D1. 🤖 Adicionar Better Auth + plugin de **organizations**; criar schema
      `users` / `workspaces` / `workspace_members(role)` no `db.ts`. Business tables
      seguem em `workspace_id`.
- [ ] D2. 🤖 Substituir a camada de sessão: `proxy.ts` (middleware), `workspaceContext.ts`
      (resolver workspace **da sessão** + validar membership), `login/actions.ts`,
      `auth/confirm`. Remover `@supabase/ssr`.
- [ ] D3. 🤖 **Autorização server-side** (a parte crítica — auth ≠ isolamento):
      auditar TODAS as rotas para garantir que o `workspace_id` vem da sessão, que o
      usuário pertence ao workspace, e que **nada** confia em `workspace_id` do browser.
      Preservar a garantia atual do `withAuthenticatedWorkspace`/`runWithWorkspace`.
- [ ] D4. 🤖 Integrar **e-mail transacional** (provedor) para confirmação/reset.
- [ ] D5. 🤖 **Teste de isolamento cruzado** (obrigatório): com dois usuários/workspaces,
      provar que um não acessa dados do outro em nenhuma rota. Vira teste automatizado.
- [ ] D6. 🤖/👤 **Recomeço limpo** de dados: limpar tabelas workspace-scoped, recriar o
      login da dona (owner) e **reconectar as contas de marketplace** (re-OAuth).
- ✅ Login/confirmação/sessão via Better Auth; teste de isolamento cruzado passa; contas
  reconectadas; sync roda no novo modelo.

## Fase E — Rotação de segredos (👤 + 🤖)
- [ ] E1. 🤖 Listar todos os segredos usados (env) e gerar os novos onde aplicável.
- [ ] E2. 👤 Setar no Coolify: `DATABASE_URL`, `CRON_SECRET` (novo), `BETTER_AUTH_SECRET`,
      credenciais do provedor de e-mail, SP-API/ML. **Aposentar** as chaves do Supabase.
- ✅ Nenhum segredo antigo/vazado em uso; tudo no env do Coolify.

## Fase E.5 — Smoke tests (gate go/no-go, antes do DNS) (👤 + 🤖)
O DNS é a única mudança visível ao usuário — antes dele, **tudo** tem que passar:
- [ ] Login · logout · reset de senha
- [ ] OAuth Amazon · OAuth Mercado Livre
- [ ] Sync Amazon · Sync ML (pela scheduled task)
- [ ] Dashboard · Monitor · Produtos · Radar · Curva ABC
- [ ] Cron · e-mail transacional · backup · **restore**
- [ ] **Isolamento cruzado entre workspaces**
- [ ] Build · performance · mobile · desktop
- ✅ Todos verdes. Um item vermelho **bloqueia** o cutover.

## Fase F — Cutover (👤)
- [ ] F1. 👤 Apontar o **domínio de produção** para o app no Coolify (DNS).
- [ ] F2. 👤/🤖 Período de **soak**: monitorar erros, sync, tempo de resposta por alguns
      dias com o Render/Supabase ainda vivos.
- [ ] F3. 👤 Desligar Render + Supabase só após o soak sem problemas.
- ✅ Produção 100% no Coolify, estável por N dias; origem antiga desligada.

## Fase G — Acompanhamento contínuo (👤 + 🤖)
A observabilidade foi montada na **Fase C.5**; aqui é o hábito depois do cutover.
- [ ] G1. 🤖/👤 Acompanhar RAM/CPU/disco/logs/conexões/duração dos syncs e agir nos
      limites da tabela de capacidade (ADR-006).
- ✅ Recursos sob observação; decisão de escalar baseada em métrica, não achismo.

---

## Sugestão de arranque
0. **Eu:** Fase 0 (inventário) — rápido, sem custo.
1. **Você:** Fase A (VPS + Coolify) e começar a Fase B (Postgres + bucket S3).
2. **Eu, em paralelo:** começar a **Fase D** (Better Auth + modelo users/workspaces +
   autorização) numa branch, testando local — é o maior bloco de código e independe da VPS.
3. Quando a infra estiver de pé, juntamos nas Fases C / C.5 / E / E.5 / F.

Nada de irreversível acontece até a Fase F (cutover). Render + Supabase ficam de pé o
tempo todo como rollback.
