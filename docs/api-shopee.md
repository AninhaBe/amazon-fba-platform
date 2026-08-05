# Shopee Open Platform API v2 — mapa da integração

> **ENGATILHADO, NÃO IMPLEMENTADO.** A usuária ainda não tem loja Shopee — este doc é
> o mapa para quando for construir (com dados reais ou sandbox). Confirmar tudo marcado
> com ⚠️ na doc oficial (open.shopee.com) **no momento de implementar** — a API evolui.
> O canal é agnóstico no schema canônico (ver [`adr/ADR-001-modelo-canonico.md`](./adr/ADR-001-modelo-canonico.md))
> → **não precisa migration**, grava-se com `provider = 'shopee'`.

## Pré-requisito

Ter uma **loja de vendedor na Shopee** (o OAuth conecta uma *loja*, `shop_id`). Sem
loja não há o que autorizar nem sincronizar. Sem loja, só dá para desenvolver contra o
**sandbox** (ambiente de teste com loja/dados fake).

## Credenciais e ambiente

- App criado no **Shopee Open Platform** (open.shopee.com) → `partner_id` (numérico) +
  `partner_key` (string).
- Env (já previstas no plano): `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`.
- Hosts: produção `https://partner.shopeemobile.com`; sandbox
  `https://partner.test-stable.shopeemobile.com`. ⚠️ **Confirmar host/região do Brasil**
  (Shopee usa host global; a região vem da loja — verificar se BR tem host próprio).

## Assinatura (toda chamada é assinada)

- **HMAC-SHA256** com o `partner_key`.
- A *base string* varia por tipo de endpoint:
  - Público (auth): `partner_id + api_path + timestamp`
  - Shop/merchant: `partner_id + api_path + timestamp + access_token + shop_id`
- Query comum: `partner_id`, `timestamp` (epoch em segundos, janela ~5 min), `sign`, e
  (pós-auth) `shop_id`, `access_token`. ⚠️ Confirmar a ordem exata da base string por endpoint.

## OAuth (conecta 1 loja)

1. Redirecionar o vendedor para `/api/v2/shop/auth_partner` (com `partner_id`, `timestamp`,
   `sign`, `redirect` = nosso `.../api/integrations/shopee/callback`).
2. Callback recebe `code` + `shop_id`.
3. Trocar o code por token: `POST /api/v2/auth/token/get` → `access_token` (~4 h) +
   `refresh_token` (~30 dias).
4. Renovar: `POST /api/v2/auth/access_token/get` com o refresh_token.

- ⚠️ **O refresh_token ROTACIONA a cada refresh** (mesma pegadinha do ML — persistir o novo).
- Token é **por loja** → `connection_id = "shopee:<shop_id>"`.

## Pedidos

| Endpoint | Uso | Observações |
|---|---|---|
| `GET /api/v2/order/get_order_list` | lista `order_sn` por janela de tempo + status | paginação por cursor; janela máx ~15 dias por chamada ⚠️ |
| `GET /api/v2/order/get_order_detail` | detalhe de um lote de `order_sn` | máx ~50 `order_sn` por chamada ⚠️; traz itens, valores, status |

## Itens / anúncios

| Endpoint | Uso |
|---|---|
| `GET /api/v2/product/get_item_list` | lista `item_id` da loja |
| `GET /api/v2/product/get_item_base_info` | infos do item (nome, sku, preço) |

## Taxas / repasse (a fonte do lucro real)

| Endpoint | Uso | Observações |
|---|---|---|
| `GET /api/v2/payment/get_escrow_detail` | detalhe de escrow por pedido | **fonte das taxas reais**: comissão, taxa de serviço, taxa de transação, frete real. Só disponível após o pedido pago/concluído ⚠️ |

## Mapeamento canônico (ver [`canonical-schema.md`](./canonical-schema.md))

- **Status** Shopee → canônico (⚠️ confirmar enum): `UNPAID→pending`,
  `READY_TO_SHIP`/`PROCESSED→paid`, `SHIPPED→shipped`, `COMPLETED→delivered`,
  `CANCELLED→cancelled`.
- **Fees** (do escrow) → taxonomia canônica: `commission_fee→commission`,
  `service_fee`/`transaction_fee→commission` (ou `payment`),
  `actual_shipping_fee→shipping_seller`/`fulfillment`. Preservar o código original em
  `provider_fee_code`.

## Webhooks (opcional na v1)

Shopee tem *Push Mechanism* (partner push) para mudanças de pedido — requer configurar a
Push URL no app + verificar assinatura. Dá para começar **só com polling/cron** e adicionar
webhook depois.

## Roteiro de implementação (arquivos — mesmo padrão do Mercado Livre)

**Novos:** `src/lib/integrations/shopee.ts` (adapter: fetch assinado, OAuth, `credentials`,
`shopeeConfigured`), `shopeeCanonical.ts` (normalizer), `shopeeSync.ts`,
`shopeeScheduler.ts`, `shopeeOverviewCanonical.ts`; rotas
`src/app/api/integrations/shopee/{connect,callback,overview}/route.ts`;
`src/app/api/cron/shopee-sync/route.ts`; UI `src/app/shopee/*` + `components/ShopeeWorkspace.tsx`.

**Editar (registro):** `integrations/registry.ts` (`availability: "available"` + `connectHref`),
`api/integrations/route.ts` (`shopeeConfigured()`), `ChannelRail.tsx`, `ChannelSwitcher.tsx`,
`integrations/workspaces.ts` (`WorkspaceId` + rota `/shopee`), `AppShell.tsx`, `app/page.tsx`
(dashboard consolidado), `integracoes/page.tsx`, `.github/workflows/cron.yml` (step do cron).

**Sem mudança (agnósticos):** schema canônico, `canonicalStore.ts`, `canonical.ts`,
`integrationStore.ts`, `secrets.ts` — reaproveitados com `provider: "shopee"`.

**Assets:** conferir `public/brands/shopee.svg` e `public/brands/app/shopee.svg`
(os caminhos já estão referenciados em `MarketplaceIcon.tsx`).

## Changelog observado (mais recente primeiro)

Mesma convenção dos docs da Amazon e do ML: mudanças de comportamento da API observadas
na prática entram aqui, com data. Enquanto o canal não for implementado, a lista fica
vazia — ao implementar, re-validar tudo marcado com ⚠️ e registrar o que divergir.

- *(nenhuma observação ainda — canal não implementado)*

## Referências

- Adapter de referência (mesmo desenho): `src/lib/integrations/mercadoLivre.ts`,
  `mercadoLivreSync.ts`, `mercadoLivreOverviewCanonical.ts`.
- Doc oficial: https://open.shopee.com (Developer Guide / API v2).
