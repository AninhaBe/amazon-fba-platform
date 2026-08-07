# Plano: Integração TikTok Shop

> **Status (07/08/2026):** app **existe** no Partner Center (app "sellercore",
> key `6kl9m4ajdcvpm`) e a **revisão de Data Security & Privacy (DSPR) foi
> APROVADA** em 07/08 — era o que travava desde 04/08. O código da integração
> ainda **não foi escrito**; o que existe é o esqueleto de OAuth (ver "Estado do
> código" abaixo).
>
> Registrado em 2026-07-15, atualizado em 07/08/2026.
> Relacionado: [`estado-atual.md`](./estado-atual.md), [`arquitetura-plano.md`](./arquitetura-plano.md).

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

## ✅ Base construída (2026-07-16)

- Credenciais validadas contra a TikTok (smoke-test no endpoint de token retornou
  "invalid auth code", não erro de app → `app_key`/`app_secret` reconhecidos).
- **Endpoint de token confirmado:** `https://auth.tiktok-shops.com/api/v2/token/get`
  (o host sem hífen não existe).
- `src/lib/tiktok.ts` — assinatura HMAC-SHA256, `exchangeAuthCode`,
  `refreshAccessToken`, `tiktokFetch` (assinado), `getAuthorizedShops`.
- `src/lib/tiktokStore.ts` — persiste lojas+tokens no Postgres (fallback JSON);
  tabela `tiktok_shops` no schema.
- Rotas: `/api/tiktok/login` (redireciona para `TIKTOK_AUTH_URL`) e
  `/api/tiktok/callback` (troca o code → lista lojas → salva).
- Env: `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET`, `TIKTOK_AUTH_URL`.

**Falta para o primeiro dado real:** o vendedor autorizar a loja (gera o
`auth_code`). Depois disso: mapear **pedidos + financeiro** para os shapes comuns.

## Próximo passo

**DSPR aprovada em 07/08/2026.** Checklist **lido no console em 07/08**
(`partner.tiktokshop.com/service/gather?service_id=7662688850348934932`), não
mais suposto:

**Partner onboarding**
1. Partner registration review — revisão de contato e dados de empresa
2. Data security and privacy review — ✅ *"You passed the data security and
   privacy review"*

**Getting ready to publish**
3. **Listing review** — *"We will review listing information that will be shown
   on the TikTok Shop App & Service market for sellers"*
4. **App review** — *"We will review and **test** app functionality"*

Depois disso, o botão **Publish**.

### Estado do app no console (07/08)

| | |
|---|---|
| Nome / ID | `sellercore` / `7662688850348934932` |
| App key | `6kl9m4ajdcvpm` |
| Status | **Draft**, visibilidade **Public**, tipo **Product Listing** |
| Redirect URL | `https://sellercore.onrender.com` — já configurado |
| Target sellers | **Brazil · Local sellers** — marcado **"1 to complete"** ⚠️ |
| Listing pt-BR | existe, atualizado em 16/07 |

⚠️ **IP allowlist também existe aqui** (marcado "New"): *"Manage the IP addresses
permitted to use your app key to retrieve seller data"* — mesmo padrão da Shopee.
O IP de saída do Render é **`74.220.49.18`**, medido em 07/08 (ver
[`api-shopee.md`](./api-shopee.md), entrada de 07/08, para o método). Vale
declarar antes do App review, não depois.

⚠️ O console mede **SLA de suporte** do parceiro (tempo de primeira resposta em
2h, resolução em 48h). Hoje há 0 tickets, então as taxas aparecem como 0%.

### O que a API do Partner Center respondeu (07/08, via TTS Open Toolkit)

CLI `@tts-open-toolkit/cli` 0.1.7, `auth login` OAuth (escopo
`open_toolkit:developer`, região BR), `devapi call partner-service-detail
--query service_id=7662688850348934932`.

**1. Dá para testar com loja real ANTES do Publish.**

```
seller_invitation_link      = true
invitation_link             = https://services.tiktokshop.com/open/authorize
auth_link_list[0].auth_type = 1
custom_beta_authorization_num = 25
```

São **25 autorizações beta**. Um vendedor conhecido autoriza a loja pelo link de
convite e o app já lê dados reais — sem esperar Listing review, App review nem
Publish. É o caminho para validar `tiktokCanonical.ts` contra resposta real
**antes** da revisão funcional, exatamente o que faltou na Shopee.

**2. O "1 to complete" é a ficha em branco.** O registro do listing pt-BR existe,
mas o conteúdo está vazio:

```
language_listing[0].language        = pt
language_listing[0].service_name    = (vazio)
language_listing[0].service_logo    = (vazio)
language_listing[0].service_main_image = (vazio)
language_listing[0].video           = (vazio)
language_listing[0].contact_email   = (vazio)
language_listing[0].contact_phone   = (vazio)
language_listing[0].official_website= (vazio)
```

Trabalho sem código, dá para fazer hoje.

**3. Status dos gates**

| Campo | Valor | Leitura |
|---|---|---|
| `partner_cert_status` | 4 | certificação do parceiro OK |
| `opis_status` | 4 | OPIS OK |
| `need_usds` / `usds_status` | false / 0 | não exigido |
| `app_review_status` | 1 | **App review ainda não feito** |
| `need_app_review` | true | obrigatório |
| `service_status` | 1 | Draft |

**4. Categorias divergem** — vale checar se limita escopo de API (a Shopee tem
regra equivalente: App Type imutável define endpoints):

- Serviço: `Product Listing` (884624)
- Identidade do parceiro: `Order Management (OMS / WMS)` (836880), sob
  `Shipping & Fulfillment`

⚠️ **O que a CLI NÃO entrega:** `authorization-open-api-list` exige `pkg_id`, que
não aparece em nenhuma resposta acima. E as rotas de `developer_center_api`
(`/api/v1/app/list`, `/api/v1/app/detail`) devolvem **não-JSON** para esta conta —
provavelmente por ser conta de Partner Center (ISV) e não de Developer Center.
A lista definitiva de endpoints liberados ainda precisa sair do **"Manage API"**
no console.

O passo 3 é o que exige código: hoje só existe o OAuth. Para uma revisão
funcional passar, a integração precisa ler pedidos e produtos de verdade — o
mesmo trabalho já feito para a Shopee (`shopeeCanonical.ts` + `shopeeSync.ts`
como molde; o banco não muda, grava com `provider = 'tiktok_shop'`).

## Fontes

- TikTok Shop Partner Center — Sign your API request:
  https://partner.tiktokshop.com/docv2/page/sign-your-api-request
- TikTok Shop Partner Center — Call your first API using Postman:
  https://partner.tiktokshop.com/docv2/page/call-your-first-api-using-postman
- TikTok Shop Data API (2026) — EchoTik:
  https://www.echotik.live/blog/tiktok-shop-data-api-access-endpoints-metrics-and-analytics-2026/
- TikTok Shop Brasil — seller.tiktok.com
- TikTok Shop Brasil 2026 — TecNois: https://tecnois.com.br/tiktok-shop-brasil-2026/
