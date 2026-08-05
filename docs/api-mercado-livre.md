# Mercado Livre API — endpoints usados e lições aprendidas

Referência interna do SellerCore. Base: `https://api.mercadolibre.com` (`src/lib/integrations/mercadoLivre.ts`). Atualize sempre que um endpoint novo entrar ou uma pegadinha nova for descoberta.

## Auth

- `POST /oauth/token` — `grant_type=refresh_token` com `MELI_CLIENT_ID` / `MELI_CLIENT_SECRET`. ⚠️ O refresh token do ML é **rotativo**: cada refresh devolve um token novo que INVALIDA o anterior — sempre persistir o novo imediatamente (o legado já faz isso).

## Pedidos (a base do faturamento)

| Endpoint | Uso | Observações |
|---|---|---|
| `GET /orders/search?seller={id}&order.date_created.from=...&order.date_created.to=...&sort=date_desc&limit&offset` | Ingestão de pedidos (`mercadoLivreSync.ts`, overview legado) | Paginação por `offset` (máx. 51 pedidos/página na prática com limit=51). Datas em ISO com offset. |
| `GET /shipments/{id}/costs` | Custo real de frete do vendedor | Usado no sync e webhook. `senders[].cost` = frete pago pelo vendedor; `receiver.cost` = frete do comprador. |

### ⚠️ A regra do faturamento (validada ao centavo — Mercado Turbo, conta 648425194)

```
Faturamento ML = vendas APROVADAS + CANCELADAS (paid_amount dos itens, SEM frete do comprador)
```

- No canônico: `GROSS_STATUSES = [paid, shipped, delivered, cancelled]` somando `gross` (produto, sem `buyer_shipping`). Implementado em `mercadoLivreOverviewCanonical.ts`.
- `REVENUE_STATUSES = [paid, shipped, delivered]` = só aprovadas (exibida como métrica separada).
- **Não** somar frete do comprador no faturamento. **Não** excluir canceladas do faturamento bruto — o painel do ML conta as duas.
- Painel do ML opera no fuso `America/Sao_Paulo` — todo agrupamento por dia usa `AT TIME ZONE 'America/Sao_Paulo'` no SQL; exibição usa `brTime`/`brDate` (`src/lib/datetime.ts`).
- **"Últimos N dias" = dia-calendário, não janela rolante** (validado 2026-07-22, diferença de R$ 46,99): o painel conta desde **00:00 de N dias atrás** (fuso SP), não `now − N×24h`. Janela rolante descarta o começo do dia-limite e o valor "para de bater". Corrigido em `overview/route.ts`, `mercadoLivreOverviewMaterializer.ts` e no fallback de `mercadoLivre.ts`.

## Anúncios / itens

| Endpoint | Uso | Observações |
|---|---|---|
| `GET /users/{id}/items/search?limit=200` | IDs dos anúncios do vendedor | Também com `status=active&limit=1` para contagem rápida. Paginação `scan` para catálogos grandes. |
| `GET /items?ids=ID1,ID2,...` | Multiget de itens (lote de até 20) | Muito mais eficiente que 1 a 1. |
| `GET /items/{id}` | Detalhe de um item | — |
| `PUT /items/{id}` | Atualizar item (preço, estoque, status) | — |
| `GET /items/{id}/sale_price?context=channel_marketplace` | Preço promocional real | O `price` do item não reflete promoção ativa; este endpoint sim. |
| `GET /users/{id}/shipping_options/free?...` | Custo de frete grátis por item | Estimativa do custo do vendedor para item com frete grátis. |

## Catálogo (user products)

| Endpoint | Uso | Observações |
|---|---|---|
| `GET /products/{id}` | Produto de catálogo | — |
| `GET /products/{id}/items?limit=100` | Concorrentes no mesmo catálogo | Quem disputa o buy box do catálogo. |
| `GET /catalog_domains/{domain}/categories` | Categorias do domínio | — |
| `GET /users/{id}/items/search?user_product_id={id}` | Meus itens ligados a um user product | — |

## Endpoints bloqueados pelo ML (verificado em 2026-07-23)

Testado com o token da conexão **e** anonimamente. O ML fechou a busca e a
consulta a itens de terceiros. Apps **certificadas/parceiras** (ex.: Mercado
Turbo) têm acesso elevado que nós não temos. **Não reintroduzir esses caminhos.**

> Evidência de como o Mercado Turbo faz o "sua posição no termo X" (print de
> 03/08/2026): a ferramenta declara varrer "as primeiras 20 páginas (1000
> anúncios)" — 20×50, o teto de paginação do `/sites/MLB/search` — e avisa que "a
> busca direta pelo site pode variar a ordenação (buscas recentes, localização)",
> ou seja, usa a **ordenação canônica da API**, não scraping do site. A feature é
> trivial; o valor está na **certificação**. Destrave: programa de parceiros do ML
> (análogo à candidatura Solution Provider da Amazon, também pendente).

| Endpoint | Resultado |
|---|---|
| `GET /sites/{site}/search?q=...` | ❌ `403 forbidden` |
| `GET /sites/{site}/search?category=...` | ❌ `403 forbidden` |
| `GET /sites/{site}/search?seller_id=...` | ❌ `403 forbidden` |
| `GET /users/{OUTRO_id}/items/search` | ❌ `Searching another user items is restricted.` |
| `GET /items/{id}` de item de **TERCEIRO** | ❌ `403 forbidden` (**apertou em 2026-08-03** — em 23/07 ainda funcionava; para itens **próprios** segue OK) |
| Qualquer chamada **anônima** (sem token) | ❌ `403` — `blocked_by: PolicyAgent` |

Consequências: (1) não dá para descobrir o anúncio de **outro** vendedor a partir
de um `user_product` (MLBU) — `getMercadoLivrePublicListing` devolve título, foto
e categoria (pelo domínio) com **preço em branco**, e a calculadora deixa o campo
editável; (2) inviabiliza ranqueamento por termo de busca; (3) todo fallback
"tenta público sem token" virou código morto — foram removidos.

Continuam funcionando (com token, reverificado em 2026-08-03):
`/users/{me}/items/search`, `/items/{id}` **só de itens próprios**,
`/items/{id}/sale_price`, `/sites/{site}/listing_prices`,
`/catalog_domains/{domain}/categories`, `/users/{id}` (dados públicos de
terceiro), `/highlights/{site}/category/{id}` (top 20 da categoria, com
`position` e ids `PRODUCT`/`ITEM`), `/trends/{site}` (50 termos mais buscados) e
`/products/search?q=` (produtos de catálogo; devolve identidade, sem preço).

**Pesquisa de mercado — o que sobrou de útil (sondado em 2026-08-03):**

- `/products/{id}` → `buy_box_winner` (item, preço, seller, tipo de envio) — pode
  vir `null` mesmo em produto ativo.
- `/products/{id}/items` → **concorrentes do catálogo com preço**, seller_id,
  listing_type, official_store e shipping. **Sem** `sold_quantity` e **sem**
  `available_quantity`.
- Consequência: no ML **não existe** equivalente ao BSR por anúncio nem venda de
  terceiro (`sold_quantity` ficou inacessível). Posição só existe no **top 20 por
  categoria** (highlights). Em compensação, **preço da concorrência de catálogo**
  e **termos mais buscados** são dados que a Amazon não dá.

## Webhooks (`mercadoLivreWebhook.ts`)

- Tópicos aceitos: `orders_v2`, `items`, `items_prices`, `shipments` (`SUPPORTED_TOPICS`).
- Notificação traz só `resource` (ex.: `/orders/123`) — sempre re-buscar o recurso na API; dedupe por `_id`/chave composta antes de processar.
- Responder 200 rápido e processar depois (fila em banco) — o ML re-tenta e pode desconectar o webhook se demorar.

## Fees e impostos

- Comissão (`sale_fee`) vem em `order_items[].sale_fee` no pedido — por unidade; multiplicar pela quantidade.
- Frete do vendedor via `/shipments/{id}/costs` (não confundir com o do comprador).
- Imposto: percentual configurável do vendedor (`mercadoLivreTaxRate` — não vem da API).
- Taxonomia canônica: `commission`, `shipping_seller`, `fulfillment`, `payment`, `ads`, `taxes_withheld`, `refund`, `other`.

## Changelog observado (mais recente primeiro)

O ML muda regra **sem aviso e sem changelog público** — já aconteceu duas vezes em duas
semanas. Toda mudança de comportamento observada na API entra aqui, com data; o detalhe
fica nas seções acima.

- **2026-08-03** — `GET /items/{id}` de item de **terceiro** passou a retornar `403`
  (em 23/07 ainda funcionava). Itens próprios seguem OK. Na mesma data: re-verificados
  os endpoints que continuam abertos e sondados os `/products/*` (ver seção de pesquisa
  de mercado).
- **2026-07-23** — Verificado o bloqueio de `/sites/{site}/search` (todas as variantes:
  `q`, `category`, `seller_id`), de `/users/{outro}/items/search` e de qualquer chamada
  anônima (`blocked_by: PolicyAgent`). Fallbacks "tenta público sem token" viraram código
  morto e foram removidos.
- **2026-07-22** — Validada a regra **"últimos N dias = dia-calendário"** (fuso SP), não
  janela rolante — diferença de R$ 46,99 contra o painel até corrigir.

## Pegadinhas gerais

- **Status canônicos**: `paid` ← paid/payment_required(pago), `cancelled` ← cancelled, etc. Mapeamento em `mercadoLivreNormalizer`. O ML muda status do pedido sem notificar em alguns fluxos — o sync por janela de datas cobre isso.
- **Rate limit**: multiget e paginação com parcimônia; erro 429 pede backoff.
- **IDs**: seller/account id é numérico; anúncios são `MLB...`; pedidos numéricos; shipments numéricos.
