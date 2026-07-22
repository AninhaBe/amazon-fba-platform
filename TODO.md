# TODO — SellerCore

Pendências combinadas da migração multicanal e melhorias. Atualize os checkboxes
conforme for concluindo.

## Ação manual (precisa de você)

- [ ] **Agendar o cron da Amazon.** "Cron" é só um despertador: um serviço
  externo chama uma URL do app de tempos em tempos, e essa chamada empurra a
  sincronização — sem depender de alguém abrir o dashboard.
  1. Se ainda não existir, crie a variável `CRON_SECRET` no ambiente do Render
     (Environment → Add) com um valor longo e aleatório. O cron do Mercado
     Livre usa a mesma variável.
  2. Num serviço gratuito de agendamento (ex.: [cron-job.org](https://cron-job.org)),
     crie um job a cada **10 minutos** chamando:
     `GET https://SEU-APP.onrender.com/api/cron/amazon-sync`
     com o header `Authorization: Bearer <valor do CRON_SECRET>`.
  3. Confira que o job do Mercado Livre também está agendado (mesmo formato,
     URL `/api/cron/mercado-livre-sync`, a cada 5 minutos).
  4. Teste: a resposta deve ser `{"ok":true,...}`. Sem o header correto, 401.

## Fase 5 — Amazon no modelo canônico (em andamento)

- [x] Ingestão de pedidos (headers via `getOrders`, itens conciliados em background)
- [x] Cron para avançar histórico e itens sem visitas ao dashboard
- [x] **Fees via Finances API** — comissão, tarifa FBA, frete e estornos viram
  fees canônicas por pedido, conciliadas em background junto do sync
- [ ] **Trocar as rotas do dashboard Amazon** (`/api/orders`, `/api/sales`,
  `/api/profit`, `/api/top-products`) para ler do SQL canônico — é o que
  torna a Amazon rápida como o Mercado Livre ficou. Antes, validar os números
  do canônico contra o dashboard atual (mesma conferência feita no ML)
- [ ] TikTok Shop: implementar pedidos já direto no canônico (sem tabela legada)
- [ ] Shopee: entra como adaptador novo quando a conta existir

## Limpeza (depois que o overview SQL do ML estiver estável no Render)

- [ ] Remover o código dormente de snapshots/materializer do ML
  (`mercadoLivreOverviewCache.ts`, `mercadoLivreOverviewMaterializer.ts`,
  chamadas a `invalidateMercadoLivreOverviewSnapshots` e o caminho de payloads
  do `loadMercadoLivreSource` que só o comparador usou)
- [ ] Dropar as tabelas `workspace_marketplace_overview_snapshots` e
  `workspace_marketplace_materialization_leases` (migração própria)
- [ ] Tirar o DDL legado do `ensureSchema` (mover para migração versionada,
  como já foi feito com as tabelas canônicas)

## Infra / performance

- [ ] **Aproximar app e banco**: Render está em Oregon e o Supabase em
  São Paulo (~180ms por query). Opções: mover o serviço do Render, ou testar o
  deploy Vercel que já está configurado para `gru1` (São Paulo) com os crons no
  `vercel.json`
- [ ] Pinger externo em `/api/health` a cada 5–10 min para a instância free do
  Render não hibernar (pode ser no mesmo cron-job.org)

## UI (opcional, sem urgência)

- [ ] Dark mode — todas as cores já são tokens OKLCH no `globals.css`; é
  redefinir as variáveis do `:root` sob `prefers-color-scheme: dark`
- [ ] Sidebar: decidir se as descrições dos itens de navegação ficam, saem ou
  aparecem só no hover

## Segurança

- [ ] Rotacionar `MELI_CLIENT_SECRET` e `OAUTH_CLIENT_SECRET` (foram expostos
  em uma conversa de suporte; trocar nos painéis do Mercado Livre/Amazon e
  atualizar no Render)
