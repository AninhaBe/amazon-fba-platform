# SellerCore — Inteligência para operações multicanal

Plataforma em **Next.js 16 / React 19** para centralizar Amazon, Mercado Livre e futuros
canais, com lucro, pedidos, estoque, custos e desempenho isolados por *workspace* e um
**modelo canônico único** para o qual todos os marketplaces convergem.

> 📐 **Como os dados fluem** (modelo canônico, sync, cache, cron): comece por
> **[ARCHITECTURE.md](./ARCHITECTURE.md)**, que aponta para os docs focados em
> [`docs/architecture/`](./docs/architecture/).
>
> 🧭 **Por que cada decisão foi tomada:** [`docs/adr/`](./docs/adr/) — 11 ADRs.
> Antes de implementar algo que toque dados, sync, cache, auth ou um canal, leia o ADR
> correspondente (ver [`AGENTS.md`](./AGENTS.md)).

## Funcionalidades

### Central (todos os canais)

| Página | O que faz |
|---|---|
| **Visão geral** (`/`) | Faturamento e lucro do período somando os canais, KPIs, gráfico de receita e atalhos. Filtro por preset ou intervalo personalizado. |
| **Integrações** (`/integracoes`) | Conecta e gerencia as contas de cada marketplace. |

### Amazon (`/amazon/*`)

| Página | O que faz |
|---|---|
| **Dashboard** | Visão do canal: faturamento, lucro e margem do período. |
| **Briefing** | Prioridades do dia geradas por detectores (ruptura, velocidade, margem) — Seller Intelligence, [ADR-008](./docs/adr/ADR-008-seller-intelligence.md). |
| **Monitor da conta** | Pedidos recentes (Orders API) e lucro real (Finances API). |
| **Anúncios** | Catálogo publicado: preço, estoque, logística (FBA/FBM) e status. |
| **Produtos** | Produtos puxados da conta já com preço de venda; você cadastra o **custo**, com **histórico de vigência** para não distorcer o lucro passado ([ADR-004](./docs/adr/ADR-004-custo-por-vigencia.md)). |
| **Radar de estoque** | Cruza o FBA Inventory com a velocidade de vendas para estimar dias de cobertura. Ignora SKU fantasma (anúncio excluído que sobrou no inventário). |
| **Pesquisa** | Pesquisa de mercado por termo: idade da linha, BSR e subcategoria, preço, nº de vendedores, e **variação de ranking** (↑/↓) a partir do histórico próprio. |
| **Pesquisa → Histórico** | Tudo que já foi pesquisado continua sendo fotografado todo dia: posição atual, variação de 7 e 30 dias, curva e ações de fixar/remover ([ADR-011](./docs/adr/ADR-011-watchlist-de-pesquisa.md)). |
| **Curva ABC** | Classificação por lucro, a partir do canônico. |
| **Calculadora** | Taxas reais (Product Fees API), lucro líquido, margem e ROI, comparando **FBA / FBM / DBA**. |

### Mercado Livre (`/mercado-livre/*`)

| Página | O que faz |
|---|---|
| **Dashboard** | Visão do canal, alinhada à da Amazon. |
| **Monitor da conta** | Pedidos e financeiro. A regra de faturamento do ML (aprovadas + canceladas, sem frete) está em [`docs/api-mercado-livre.md`](./docs/api-mercado-livre.md). |
| **Anúncios** | Catálogo publicado, com filtros de status, tipo e logística. |
| **Produtos** | Cadastro de custo e impostos por anúncio. |
| **Radar de estoque** | Cobertura e ruptura. |
| **Curva ABC** | Classificação por lucro. |
| **Calculadora** | Preço e margem. |

## Como rodar

1. Copie `.env.local.example` para `.env.local`. Comece pela autenticação e pelo banco:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://SEU_PROJETO.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   DATABASE_URL=postgresql://...
   INTEGRATION_TOKEN_KEY=uma-chave-longa-e-estável
   APP_BASE_URL=https://SEU_DOMINIO
   ```

   **Amazon (SP-API)** — nunca comite este arquivo, ele já está no `.gitignore`:

   ```
   LWA_CLIENT_ID=...
   LWA_CLIENT_SECRET=...
   LWA_REFRESH_TOKEN=...
   SPAPI_REGION=NA                       # Brasil fica na região NA
   DEFAULT_MARKETPLACE_ID=A2Q3Y263D00KWC # Brasil
   SPAPI_USE_SANDBOX=false
   ```

   Para permitir que outra pessoa conecte a **própria** conta Amazon via OAuth, preencha
   também `SPAPI_APP_ID`, `OAUTH_CLIENT_ID/SECRET` e `APP_BASE_URL`.

   **Mercado Livre** — crie o app em [developers.mercadolivre.com.br](https://developers.mercadolivre.com.br)
   e cadastre `https://SEU_DOMINIO/api/integrations/mercado-livre/callback` como Redirect URI:

   ```
   MELI_CLIENT_ID=...
   MELI_CLIENT_SECRET=...
   ```

   O refresh token do ML **rotaciona a cada uso** — o SellerCore persiste o novo token a
   cada renovação. Webhooks chegam em `/api/webhooks/mercado-livre`.

   **TikTok Shop Brasil** (opcional) — app no Partner Center, com
   `https://SEU_DOMINIO/api/tiktok/callback` como Redirect URL:

   ```
   TIKTOK_APP_KEY=...
   TIKTOK_APP_SECRET=...
   TIKTOK_SERVICE_ID=...
   ```

   **Shopee** está *engatilhada, não implementada* — ver [`docs/api-shopee.md`](./docs/api-shopee.md).

   Em todos os fluxos OAuth o SellerCore gera e valida um `state` de uso único. Tokens e
   contas autorizadas ficam criptografados e isolados por workspace.

2. Instale e rode:

   ```bash
   npm install
   npm run dev
   ```

3. Acesse http://localhost:3000

## Autenticação e isolamento

- Cada pessoa cria uma conta pelo Supabase Auth e recebe um workspace próprio.
- Contas, integrações, custos, histórico e caches são **sempre** escopados pelo usuário
  autenticado — o bloqueio existe nas páginas, nas rotas e junto aos stores.
  O *porquê* está em [ADR-007](./docs/adr/ADR-007-arquitetura-de-auth.md).
- Registros das tabelas legadas permanecem em quarentena e não são listados.
- No Supabase, cadastre `https://SEU_DOMINIO/auth/confirm` entre as Redirect URLs.

## Estrutura

| Camada | Arquivos |
|---|---|
| **Cliente SP-API** | `src/lib/spapi.ts` (token LWA + chamadas autenticadas + erros tipados `SpApiError`) |
| **Auth / workspace** | `supabase/*`, `workspaceContext.ts`, `workspaceScope.ts`, `proxy.ts` (sessão SSR + isolamento via AsyncLocalStorage) |
| **Contexto Amazon** | `accountContext.ts`, `accountStore.ts`, `withAccount.ts`, `sellers.ts` |
| **Integrações e canônico** | `src/lib/integrations/` — `canonical.ts`, `canonicalStore.ts`, `registry.ts`, `secrets.ts`, `workspaces.ts`; por canal: `amazonSync/Scheduler/Warm/Canonical/Abc`, `mercadoLivre*` (sync, orders, webhook, materializer, ABC), `shopee.ts` |
| **Histórico (séries temporais)** | `rankHistory.ts` + `amazonRankSnapshot.ts` ([ADR-009](./docs/adr/ADR-009-historico-de-ranking.md)), `amazonOfferSnapshot.ts` ([ADR-010](./docs/adr/ADR-010-historico-de-oferta.md)), `watchlist.ts` ([ADR-011](./docs/adr/ADR-011-watchlist-de-pesquisa.md)) |
| **Seller Intelligence** | `src/lib/insights/` — `run.ts`, `registry.ts`, `store.ts` e `detectors/{ruptura,velocidade,margem}.ts` ([ADR-008](./docs/adr/ADR-008-seller-intelligence.md)) |
| **Cache** | `cache.ts` (dedupe em memória), `swr.ts` + `persistentCache.ts` (stale-while-revalidate no PostgreSQL; arquivo apenas no dev), `dataDir.ts` |
| **Domínio** | `fees.ts`, `pricing.ts`, `catalog.ts`, `storage.ts`, `orders.ts`, `finances.ts`, `sales.ts`, `inventory.ts`, `radar.ts`, `profit.ts`, `profitability.ts`, `topProducts.ts`, `search.ts`, `reports.ts`, `listings.ts`, `products.ts`, `costStore.ts`, `transactions.ts`, `traffic.ts`, `marketplaceCalculator.ts`, `financialMath.ts` |
| **Banco** | `db.ts` — schema idempotente (`CREATE TABLE IF NOT EXISTS`) criado na primeira query |
| **Rotas** | `src/app/api/*` — dados (`orders`, `finances`, `sales`, `radar`, `products`, `profit`, `search`, `watchlist`, `briefing`, `costs`…), integrações (`integrations/mercado-livre/*`, `tiktok/*`), cron (`cron/amazon-sync`, `cron/mercado-livre-sync`) e webhooks |
| **UI** | `src/app/{amazon,mercado-livre}/*`, páginas da central e `components/` |
| **Erros da API** | `apiError.ts` — traduz erro de marketplace em mensagem amigável + log com `requestId` no servidor |

## Documentação

| Onde | O quê |
|---|---|
| [`docs/architecture/`](./docs/architecture/) | Visão geral, modelo canônico, motor de sync, leitura e cache |
| [`docs/adr/`](./docs/adr/) | As 11 decisões arquiteturais e seus trade-offs |
| [`docs/api-amazon-sp-api.md`](./docs/api-amazon-sp-api.md) | Endpoints da SP-API e pegadinhas já pagas caro (PATCH com selectors, FNSKU/FBA) |
| [`docs/api-mercado-livre.md`](./docs/api-mercado-livre.md) | Endpoints do ML, regra de faturamento, webhooks |
| [`docs/api-shopee.md`](./docs/api-shopee.md) | Shopee — engatilhada, ainda não implementada |
| [`docs/amazon-politicas.md`](./docs/amazon-politicas.md) | Políticas de oferta, imagem, FBA e envio (extraído do Seller Central) |
| [`docs/amazon-ads.md`](./docs/amazon-ads.md) | O que se aplica à conta em Amazon Ads e roteiro de campanha |

## Notas sobre a SP-API

- A Amazon **descontinuou** a exigência de assinatura AWS SigV4 / role IAM. Hoje basta o
  token LWA no header `x-amz-access-token`.
- O `access_token` expira em ~1h; o cliente renova automaticamente e mantém cache em memória.
- Erros viram `SpApiError` (código + mensagem amigável + `retryable`). O servidor loga o
  detalhe técnico com `requestId` — **sem nunca registrar tokens ou secrets**.
- Rate limit (429) tem retry automático com backoff. Respostas de leitura ficam em cache
  que sobrevive a restart, servindo dados enquanto revalida em segundo plano.
- Para testar sem afetar produção, use `SPAPI_USE_SANDBOX=true`.

## Deploy

- **Render (produção):** web service + disco persistente definidos no `render.yaml`
  (New → Blueprint). Requer as env vars de segredo no painel, incluindo `CRON_SECRET`.
- **Agendamento:** como o Render **ignora** os crons do `vercel.json`, quem dispara sync,
  aquecimento, fotos diárias e detecção de insights é o workflow
  `.github/workflows/cron.yml` (**GitHub Actions**) batendo em `/api/cron/*` com
  `CRON_SECRET`. Segredos no GitHub: `APP_BASE_URL` e `CRON_SECRET`.
  O porquê está em [ADR-003](./docs/adr/ADR-003-cron-github-actions.md).
- **Vercel (alternativo):** o `vercel.json` mantém os crons nativos caso o deploy migre —
  ver [guia](./docs/vercel-deploy.md).
- **Self-hosted (avaliado):** [ADR-006](./docs/adr/ADR-006-migracao-self-hosted-coolify.md)
  discute a migração para Coolify.
