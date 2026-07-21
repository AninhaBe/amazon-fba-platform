# SellerCore — Inteligência para operações multicanal

Plataforma em **Next.js** para centralizar Amazon, Mercado Livre e futuros canais,
com lucro, pedidos, estoque, custos e desempenho separados por workspace.

## Funcionalidades

| Página | O que faz |
|---|---|
| **Dashboard** (`/`) | Visão geral: faturamento e lucro do período, KPIs, gráfico de receita e atalhos. Filtro de período (presets ou intervalo personalizado). |
| **Calculadora** (`/calculadora`) | Estima as taxas reais da Amazon (Product Fees API) e calcula lucro líquido, margem e ROI. Compara **FBA / FBM / DBA** lado a lado. Puxa o preço de venda pelo ASIN. |
| **Monitor** (`/monitor`) | Pedidos recentes (Orders API) e lucro real (Finances API) com faturamento, pedidos FBA e itens a enviar. |
| **Estoque** (`/estoque`) | Radar de estoque: cruza o FBA Inventory com a velocidade de vendas para estimar dias de cobertura. |
| **Produtos** (`/produtos`) | Produtos puxados automaticamente da conta (anúncios + estoque FBA) já com o preço de venda. Você só cadastra o **custo** — com **histórico de vigência** para não distorcer o lucro passado. |
| **Pesquisa** (`/pesquisa`) | Pesquisa de mercado de qualquer ASIN: data de lançamento ("idade da linha"), BSR, preço e nº de vendedores. Manda o ASIN direto para a calculadora. |

## Como rodar

1. Copie `.env.local.example` para `.env.local` e configure primeiro a autenticação:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://SEU_PROJETO.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   DATABASE_URL=postgresql://...
   INTEGRATION_TOKEN_KEY=uma-chave-longa-e-estável
   ```

   Depois preencha as credenciais LWA
   (**nunca comite esse arquivo** — ele já está no `.gitignore`):

   ```
   LWA_CLIENT_ID=...
   LWA_CLIENT_SECRET=...
   LWA_REFRESH_TOKEN=...
   SPAPI_REGION=NA                       # Brasil fica na região NA
   DEFAULT_MARKETPLACE_ID=A2Q3Y263D00KWC # Brasil
   SPAPI_USE_SANDBOX=false
   ```

   Para permitir que um colega conecte a **própria** conta via OAuth, preencha também
   `SPAPI_APP_ID`, `OAUTH_CLIENT_ID/SECRET` e `APP_BASE_URL` (veja o `.env.local.example`).

   Para habilitar a conexão com a **TikTok Shop Brasil**, crie o app no Partner Center,
   cadastre `https://SEU_DOMINIO/api/tiktok/callback` como Redirect URL e configure:

   ```
   TIKTOK_APP_KEY=...
   TIKTOK_APP_SECRET=...
   TIKTOK_SERVICE_ID=...
   ```

   O SellerCore gera e valida um `state` de uso único no fluxo de autorização. Tokens
   e lojas autorizadas permanecem criptografados e isolados por workspace.

2. Instale e rode:

   ```bash
   npm install
   npm run dev
   ```

3. Acesse http://localhost:3000

## Autenticação e isolamento

- Cada pessoa cria uma conta pelo Supabase Auth e recebe um workspace próprio.
- Contas Amazon, integrações, custos, lojas TikTok e caches são sempre escopados pelo
  usuário autenticado. O bloqueio existe nas páginas, nas rotas e junto aos stores.
- Registros das tabelas legadas permanecem em quarentena e não são listados. Após a
  atualização, reconecte cada marketplace dentro do usuário correto.
- No Supabase, cadastre `https://SEU_DOMINIO/auth/confirm` entre as Redirect URLs.

## Onde pegar as credenciais

No **Developer Central / Seller Central → Apps** você registra um app SP-API e obtém
`client_id` e `client_secret`. O `refresh_token` da conta dona vem da self-authorization.

## Estrutura

| Camada | Arquivos |
|---|---|
| **Cliente SP-API** | `src/lib/spapi.ts` (token LWA + chamadas autenticadas + **erros tipados** `SpApiError`) |
| **Autenticação/workspace** | `supabase/*`, `workspaceContext.ts`, `proxy.ts` (sessão SSR + isolamento via ALS) |
| **Contexto Amazon** | `accountContext.ts`, `accountStore.ts`, `withAccount.ts` |
| **Cache** | `cache.ts` (dedupe em memória), `swr.ts` + `persistentCache.ts` (stale-while-revalidate no PostgreSQL; arquivo apenas no dev), `dataDir.ts` |
| **Domínio** | `fees.ts`, `pricing.ts`, `catalog.ts`, `storage.ts`, `orders.ts`, `finances.ts`, `sales.ts`, `inventory.ts`, `radar.ts`, `profit.ts`, `topProducts.ts`, `search.ts`, `reports.ts`, `listings.ts`, `products.ts`, `costStore.ts` |
| **Período** | `period.ts` (presets vs. intervalo custom) |
| **Rotas** | `src/app/api/*` (fees, price, orders, finances, sales, radar, products, top-products, profit, search, costs, auth) |
| **UI** | `src/app/{page,calculadora,monitor,estoque,produtos,pesquisa}` + `components/` |
| **Erros da API** | `src/lib/apiError.ts` — traduz erros da SP-API em mensagem amigável para a equipe + log com `requestId` no servidor |

## Notas sobre a SP-API

- A Amazon **descontinuou** a exigência de assinatura AWS SigV4 / role IAM. Hoje basta o
  token LWA no header `x-amz-access-token`.
- O `access_token` expira em ~1h; o cliente renova automaticamente e mantém cache em memória.
- Chamadas com erro viram `SpApiError` (código + mensagem amigável + `retryable`); a UI
  recebe a mensagem tratada e o servidor loga o detalhe técnico com `requestId` —
  **sem nunca registrar tokens ou secrets**.
- Rate limit (429) tem retry automático com backoff. Respostas de leitura ficam em cache
  em disco (sobrevive a restart), servindo dados enquanto revalida em segundo plano.
- Para testar sem afetar produção, use `SPAPI_USE_SANDBOX=true`.

## Deploy

- **Vercel:** veja o [guia de deploy e migração](./docs/vercel-deploy.md). As funções
  rodam em São Paulo e um cron continua a sincronização incremental do Mercado Livre.
- **Render (legado/rollback):** o `render.yaml` mantém o serviço atual e seu disco.

## Roadmap / ideias

Planos futuros (arquitetura, sincronização incremental para PostgreSQL, e a camada de
**AI Agent Harness / copiloto**) estão documentados em [`docs/`](./docs).
