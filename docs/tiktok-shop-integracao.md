# Plano: Integração TikTok Shop

> **Status:** plano / backlog. Não implementado — registrado para quando houver
> `app_key`/`app_secret` do Partner Center. Registrado em 2026-07-15.
> Relacionado: [`arquitetura-plano.md`](./arquitetura-plano.md), [`ai-agent-harness.md`](./ai-agent-harness.md).

## Por que priorizar (vs. Shopee)

O **TikTok Shop já está aberto no Brasil** (lançou em maio/2025, cadastro de
vendedor liberado em 2026) — diferente da Shopee, que ficou pausada esperando
verificação. Único requisito: **empresa** cadastrada (MEI, EI, SLU, LTDA, S/A);
só CPF não abre loja de vendedor.

## Visão geral — TikTok Shop Partner API v2

- App criado no **TikTok Shop Partner Center** → `app_key` + `app_secret`.
  É uma **integração separada** da Amazon (outro app, outras credenciais — igual
  o Amazon Ads é separado da SP-API).
- **Host da API:** `https://open-api.tiktokglobalshop.com`
- Toda chamada de negócio exige: **assinatura HMAC-SHA256** + `app_key` +
  `timestamp` + **`access_token`** (header `x-tts-access-token`) + **`shop_cipher`**
  (identifica a loja).

## Fluxo de autenticação (OAuth)

1. Vendedor autoriza o app → retorna `auth_code`.
2. Troca o code por tokens no token endpoint
   (`https://auth.tiktok-shops.com/api/v2/token/get`) → `access_token` (curta
   duração) + `refresh_token` (longa).
3. Renova o `access_token` periodicamente via `refresh_token`.
4. `GET /authorization/202309/shops` → lista lojas autorizadas com `shop_id` +
   `shop_cipher`.

> Os endpoints de token **não** usam a assinatura HMAC — vão com
> `app_key` + `app_secret` direto.

## Algoritmo de assinatura (HMAC-SHA256)

⚠️ **Validar na doc oficial / Postman antes de codar** (a página de assinatura não
renderizou na pesquisa; abaixo é do conhecimento geral). Assinatura errada = 401.

1. Pegar todos os query params **exceto** `sign` e `access_token`.
2. Ordenar as chaves em ordem alfabética.
3. Concatenar no formato `{chave}{valor}` (sem separador).
4. **Prefixar o path** da requisição: `path + params`.
5. Se `Content-Type` **não** for `multipart/form-data`, anexar o **corpo JSON** cru.
6. Envolver com o segredo: `app_secret + string + app_secret`.
7. **HMAC-SHA256** com `app_secret` como chave → hex → é o `sign`.
8. Enviar `sign`, `timestamp` (unix segundos) e `app_key` na query;
   `access_token` no header `x-tts-access-token`.

## Endpoints que interessam (versão 202309+)

| Área | Endpoint | Pra quê |
|---|---|---|
| Lojas | `GET /authorization/202309/shops` | shop_id + shop_cipher |
| Produtos | `POST /product/202309/products/search` | catálogo, preço, estoque |
| Pedidos | `POST /order/202309/orders/search` + detalhe | vendas, itens |
| **Financeiro** | `GET /finance/202309/statements` / transactions | **payout real + taxas** |
| Logística | `/logistics/...`, `/fulfillment/...` | envio |
| **Webhooks** | configurados no Partner Center | **push de pedido em tempo real** (ex.: `ORDER_STATUS_CHANGE`) |

Vantagem sobre a Amazon: webhooks empurram o pedido no servidor — não precisa
ficar consultando.

## Como encaixa no SellerCore

Mesma arquitetura já existente:
- **`lib/tiktok.ts`** — assinatura HMAC + gestão de token por loja (guardado no
  Postgres, junto das contas Amazon).
- **Rotas OAuth do TikTok** (login/callback), no padrão do `withAccountContext`.
- **Adapters** mapeando pedido/produto/financeiro do TikTok para os *shapes*
  comuns do app → dashboard, gráfico e o futuro copiloto ganham TikTok Shop de
  graça (para eles, "venda" é uma coisa só, venha da Amazon ou do TikTok).

## Caveats

1. **Integração separada** — app próprio no Partner Center, credenciais distintas.
2. **Precisa de empresa** cadastrada no TikTok Shop BR + app aprovado.
3. **Validar assinatura** na doc oficial/Postman antes de escrever código.
4. **Rate limit por QPS** por app → backoff (reusar o padrão do `spapiFetch`).
5. Credenciais (`app_key`/`app_secret`, tokens) **só em env/Postgres**, nunca no código.

## Próximo passo

Quando houver `app_key`/`app_secret` do Partner Center: construir `lib/tiktok.ts`
(assinatura + tokens) + rotas OAuth, começando por **pedidos + financeiro** (o que
alimenta o dashboard).

## Fontes

- TikTok Shop Partner Center — Sign your API request:
  https://partner.tiktokshop.com/docv2/page/sign-your-api-request
- TikTok Shop Partner Center — Call your first API using Postman:
  https://partner.tiktokshop.com/docv2/page/call-your-first-api-using-postman
- TikTok Shop Data API (2026) — EchoTik:
  https://www.echotik.live/blog/tiktok-shop-data-api-access-endpoints-metrics-and-analytics-2026/
- TikTok Shop Brasil — seller.tiktok.com
- TikTok Shop Brasil 2026 — TecNois: https://tecnois.com.br/tiktok-shop-brasil-2026/
