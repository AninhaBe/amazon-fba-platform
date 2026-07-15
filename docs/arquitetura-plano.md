# Plano de arquitetura (faseado)

> **Status:** plano vivo. Marca o que já foi feito e o que fica para quando houver
> volume de pedidos ou mais de um usuário. Filosofia: **arquitetura simples e sólida,
> sem adicionar complexidade (Redis, filas, K8s) antes da necessidade.**
> Atualizado em 2026-07-14.

Arquitetura-alvo para o estado atual: **Next.js + PostgreSQL + sincronização agendada +
autenticação interna**. O destino está certo; o que importa é o *gatilho* de cada fase —
hoje temos praticamente uma conta vazia e um usuário, então não faz sentido construir
infra de SaaS antes de ter SaaS.

---

## ✅ Feito agora (barato, correto, independe de volume)

### Erros tipados da SP-API
- `SpApiError` em `src/lib/spapi.ts` (code, status, retryable, mensagem amigável,
  endpoint, detalhe técnico, `x-amzn-RequestId`).
- `src/lib/apiError.ts` converte qualquer erro numa resposta segura: a UI recebe uma
  mensagem tratada (ex.: *"A Amazon está limitando temporariamente as consultas."*); o
  servidor loga o detalhe técnico com `requestId` de correlação, **sem token/secret**.
- Aplicado em todas as rotas SP-API.

### Histórico de custo (fim do overwrite)
- `costStore` agora guarda `history: [{ cost, from }]` por produto e só registra nova
  vigência quando o custo **muda** (não a cada edição de título/imagem).
- `costAt(entry, dateISO)` retorna o custo vigente numa data — base para calcular lucro
  histórico correto (uma venda de fevereiro usa o custo de fevereiro).
- Arquivos antigos (`costs.json` sem `history`) são normalizados na leitura — nada quebra.
- **Pendente de UX:** por enquanto a data é carimbada automaticamente. Edição manual de
  vigência (escolher "a partir de quando") fica para depois, para não complicar o cadastro.

---

### Persistência de contas + custos no Postgres (Supabase)
- Motivado por um problema real: no Render (free) o disco é **efêmero**, então
  `accounts.json`/`costs.json` sumiam a cada deploy (a conexão OAuth caía).
- `src/lib/db.ts` (pool `pg` lazy + SSL Supabase + criação de schema idempotente).
  `accountStore` e `costStore` gravam no Postgres quando `DATABASE_URL` está
  definido; **fallback para JSON** no dev local (sem banco continua funcionando).
- Tabelas: `accounts` e `product_costs` (custo + `history` em jsonb).
- **Ainda NÃO** é a sincronização de pedidos — isso continua na Fase 1 abaixo.
  Aqui foi só resolver a perda de estado (contas/custos).

## 🔜 Fase 1 — quando houver volume de pedidos real

O maior ganho: **sincronizar para um banco em vez de consultar a Amazon a cada tela.**
Resolve o N+1 (hoje ~100 pedidos = ~101 chamadas via `getOrderItems`), o rate limit e a
lentidão de uma vez. **Inútil numa conta vazia** — daí ficar nesta fase.

- **PostgreSQL gerenciado** (sugestão: **Neon** — free tier persistente; o Postgres free
  do próprio Render é apagado após ~30 dias). Acesso via **Prisma** ou **Drizzle**
  (Drizzle tem cold-start melhor em serverless; Prisma é mais fácil de ler).
- Tabelas: `orders`, `order_items`, `product_costs` (com `valid_from`/`valid_until`),
  `sync_status` — todas com `account_id`.
- **Sincronização incremental:** a cada 15–30 min busca só pedidos criados/atualizados
  desde a última sync; consulta itens uma vez por pedido novo; salva no banco. Dashboard
  passa a ler do banco (zero chamada à Amazon na maior parte do tempo).
  - Cuidados: atualizar pedidos que mudam de status (não só inserir), `amazon_order_id`
    como chave de idempotência, sobreposição de ~2h para não perder atualização atrasada,
    salvar data da última sync por conta.
  - **Gotcha operacional:** "sync a cada 15–30 min" precisa de algo *sempre rodando*. No
    Render free o web service dorme e cron é pago. Alternativas: sync sob demanda
    (no login / ao abrir o dashboard, com trava e "última sync há X min") ou cron externo
    barato (Vercel Cron free / GitHub Action agendada) chamando `/api/sync`.
- **Migração dos custos** para `product_costs` com `valid_from` acontece **junto** com esta
  fase (não vale migrar um `costs.json` sozinho — o valor vem com a sincronização).
- **Reports API** (fluxo assíncrono create → process → download) fica como fase 2, para
  backfill/reconciliação diária em volume maior.

### Gatilho concreto
Quando quiser **faturamento por produto** como métrica permanente no dashboard: agregar
`getOrderItems` ao vivo é caro/lento, mas é trivial sobre um banco sincronizado. Essa é a
primeira feature que "puxa" a Fase 1.

---

## 🔜 Fase 2 — antes de liberar para a equipe

- **Login** dos funcionários (começar simples: e-mail corporativo + lista fechada).
- `account_id` em todas as tabelas (barato) + verificação server-side de que o usuário
  logado tem acesso àquela conta (**nunca** confiar no `account_id` do navegador).
- Modelo `users` / `accounts` / `user_accounts` (permissões admin/editor/leitura).
- **Refresh tokens criptografados** no banco (chave só no ambiente do servidor; nunca no
  navegador, nunca em log; permitir revogar/reconectar). Hoje ficam em `accounts.json`
  gitignored (risco baixo); no banco compartilhado, criptografar deixa de ser opcional.
- Logs com `requestId` (já iniciado) + registro de quem alterou custos.

---

## ⏸️ Pode esperar (não construir antes da necessidade)

Redis (cache compartilhado / locks distribuídos / filas), workers/filas sofisticadas,
microsserviços, Kubernetes, arquitetura completa de SaaS, cobrança/planos, OAuth público
para clientes externos.

**Regra:** mover dados operacionais para o banco resolve a maior parte do problema.
Redis só entra quando houver mais de uma instância ou muita gente simultânea.

| Momento | Solução |
|---|---|
| Agora, uma instância | PostgreSQL + cache em memória/disco |
| Mais de uma instância | PostgreSQL + Redis |
| Volume maior | PostgreSQL + Redis + worker/fila |

---

Relacionado: a ideia do **AI Agent Harness / copiloto** está em
[`ai-agent-harness.md`](./ai-agent-harness.md) — e ganha os dados de graça assim que a
Fase 1 existir, porque o agente fala com as funções `lib/*`, não com as APIs.
