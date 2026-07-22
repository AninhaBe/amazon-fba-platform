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

## Webhooks (`mercadoLivreWebhook.ts`)

- Tópicos aceitos: `orders_v2`, `items`, `items_prices`, `shipments` (`SUPPORTED_TOPICS`).
- Notificação traz só `resource` (ex.: `/orders/123`) — sempre re-buscar o recurso na API; dedupe por `_id`/chave composta antes de processar.
- Responder 200 rápido e processar depois (fila em banco) — o ML re-tenta e pode desconectar o webhook se demorar.

## Fees e impostos

- Comissão (`sale_fee`) vem em `order_items[].sale_fee` no pedido — por unidade; multiplicar pela quantidade.
- Frete do vendedor via `/shipments/{id}/costs` (não confundir com o do comprador).
- Imposto: percentual configurável do vendedor (`mercadoLivreTaxRate` — não vem da API).
- Taxonomia canônica: `commission`, `shipping_seller`, `fulfillment`, `payment`, `ads`, `taxes_withheld`, `refund`, `other`.

## Pegadinhas gerais

- **Status canônicos**: `paid` ← paid/payment_required(pago), `cancelled` ← cancelled, etc. Mapeamento em `mercadoLivreNormalizer`. O ML muda status do pedido sem notificar em alguns fluxos — o sync por janela de datas cobre isso.
- **Rate limit**: multiget e paginação com parcimônia; erro 429 pede backoff.
- **IDs**: seller/account id é numérico; anúncios são `MLB...`; pedidos numéricos; shipments numéricos.
