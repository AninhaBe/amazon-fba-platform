# Schema canônico de pedidos, taxas e produtos

Detalha o modelo de dados que materializa a visão do
[`integrations-architecture.md`](./integrations-architecture.md): cada canal é um
adaptador que **normaliza na ingestão**; tudo rio abaixo (lucro, radar de estoque,
dashboards, período personalizado) é SQL provider-agnóstico sobre estas tabelas.

Validado campo a campo contra o que o código consome hoje:
`MercadoLivreOrder`/`MercadoLivreShipmentCosts`/`MercadoLivreProduct`
(`src/lib/integrations/mercadoLivre.ts`), `OrderSummary` da Amazon
(`src/lib/amazonOrder.ts`) e respostas da API 2023-09 da TikTok Shop observadas
na loja real (`src/lib/integrations/tiktokCanonical.ts`). Pedidos e produtos
TikTok já nascem no canônico; a validação financeira real ainda é parcial.

## Princípios

1. **Fato vs. estimativa.** As tabelas guardam apenas o que o canal informou
   (valores cobrados de verdade). Estimativas — imposto via
   `metadata.taxRate`, custo do produto por vigência — são resolvidas na
   consulta, nunca congeladas na ingestão.
2. **Payload cru ao lado.** Cada linha guarda `raw JSONB` para debug e
   reprocessamento. Nenhuma consulta de dashboard lê `raw`.
3. **Dinheiro em `NUMERIC(14,2)` + `currency` por linha.** Nada de float, nada
   de moeda implícita.
4. **Chave composta sempre** `(workspace_id, provider, connection_id, external_id)`,
   como já convencionado no doc de arquitetura.

## Taxonomia canônica de taxas (`fee_type`)

Fechada e pequena de propósito — todo código novo do canal mapeia para uma
destas; o código original fica em `provider_fee_code`.

| `fee_type` | Significado | Exemplos por canal |
|---|---|---|
| `commission` | Comissão/tarifa de venda do canal | ML `sale_fee` · Amazon `Commission` (referral) · TikTok `platform_commission` · Shopee `commission_fee` |
| `shipping_seller` | Frete pago pelo vendedor | ML `senders[].cost` do shipment · Amazon `ShippingChargeback` · TikTok `shipping_fee` (parcela do seller) · Shopee `actual_shipping_fee` − subsídio |
| `fulfillment` | Logística do canal (armazenagem/expedição) | Amazon `FBAPerUnitFulfillmentFee` · ML Full · Shopee FBS |
| `payment` | Taxa de processamento de pagamento | TikTok `transaction_fee` · Shopee `service_fee`/`transaction_fee` |
| `ads` | Publicidade **descontada no repasse** | TikTok ads no statement. ⚠️ **A Amazon NÃO usa este caminho** — ver abaixo |
| `taxes_withheld` | Imposto retido na fonte **pelo canal** | Amazon `MarketplaceFacilitatorTax` · TikTok withholding |
| `refund` | Estorno/devolução debitada do vendedor | Amazon refund events · ML claims |
| `other` | Qualquer outra linha do repasse | sempre com `provider_fee_code` preenchido |

Sinal: `amount` positivo = valor **debitado** do vendedor. Crédito (ex.:
reembolso de tarifa) entra negativo no mesmo `fee_type`.

### ⚠️ Gasto com anúncio da Amazon NÃO é tarifa de pedido

Verificado em 25/08/2026 — os únicos `fee_type` gravados em
`workspace_channel_order_fees` para a Amazon são:

```
commission · refund · fulfillment
```

Publicidade é **cobrança de conta**, não linha de pedido: não existe
`external_order_id` para pendurá-la. Um card do dashboard procurou anúncio aqui
por semanas e exibiu `R$ 0,00 · "Nenhuma despesa com anúncios no período"` numa
conta gastando R$ 312,98 — ausência virando zero afirmativo, o oposto do
`null ≠ 0`.

**Onde o anúncio mora:** `workspace_ad_metrics`, tabela própria fora do canônico
([ADR-025](adr/ADR-025-anuncio-entra-no-lucro.md)). O `fee_type` `ads` continua
válido para canal que **realmente** desconta publicidade no repasse — hoje só o
TikTok. Se um dia a Amazon passar a postar assim, o valor já entra em `fees` e já
sai do lucro; o código detecta e **não** desconta a Ads API por cima.

## Status canônico de pedido

`pending → paid → shipped → delivered` · terminais alternativos: `cancelled`, `refunded`.

| Canônico | Mercado Livre | Amazon | TikTok Shop | Shopee |
|---|---|---|---|---|
| `pending` | `confirmed`, `payment_required`, `payment_in_process` | `Pending`, `Unshipped`* | `UNPAID`, `ON_HOLD` | `UNPAID` |
| `paid` | `paid` | `Unshipped`* (pago, não enviado) | `AWAITING_SHIPMENT`, `AWAITING_COLLECTION` | `READY_TO_SHIP`, `PROCESSED` |
| `shipped` | — (derivar do shipment) | `Shipped`, `PartiallyShipped` | `IN_TRANSIT` | `SHIPPED` |
| `delivered` | — (derivar do shipment) | — | `DELIVERED`, `COMPLETED` | `COMPLETED` |
| `cancelled` | `cancelled` | `Canceled` | `CANCELLED` | `CANCELLED`, `IN_CANCEL` |
| `refunded` | via claims/mediations | via Finances refund | via return/refund API | `TO_RETURN` |

\* Amazon não separa "pago" de "não enviado" no Orders API; tratar `Unshipped`
como `paid` (é o que o faturamento espera) e `Pending` como `pending`.
`provider_status` sempre preserva o original — o canônico serve ao dashboard,
o original serve ao suporte.

Regra de faturamento (a mesma que `getMercadoLivreOverview` aplica hoje):
**receita = pedidos com status canônico `paid`+`shipped`+`delivered`**;
`cancelled`/`refunded` fora, `pending` fora.

## DDL

O DDL vigente vive em `migrations/0001_canonical_tables.sql` e é aplicado por
`npm run migrate` (controle em `schema_migrations`) — fora do `ensureSchema`
do app, para não engordar o cold start. Em particular, `cursor_token` pertence à migration
`0002_sync_cursor_token.sql`: o bootstrap local não cria essa coluna. O runner
faz preflight contra `information_schema` e recusa um histórico que marque 0002
como aplicada quando a coluna estiver ausente. O esboço abaixo é ilustrativo; em caso
de divergência, a migração é a fonte da verdade. Diferenças relevantes:
`raw` é **nulo** durante a transição do Mercado Livre (o payload segue apenas
em `workspace_marketplace_*`; duplicá-lo dobraria tráfego e memória — canais
sem tabela legada gravam o raw aqui) e as fees têm `external_ref` com a origem
do valor (ex.: id do shipment que gerou o frete), permitindo auditar e corrigir
se o pedido trocar de shipment.

```sql
CREATE TABLE IF NOT EXISTS workspace_channel_orders (
  workspace_id      TEXT NOT NULL,
  provider          TEXT NOT NULL,
  connection_id     TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  status            TEXT NOT NULL,             -- canônico (tabela acima)
  provider_status   TEXT NOT NULL,             -- original do canal
  occurred_at       TIMESTAMPTZ NOT NULL,      -- criação do pedido no canal
  closed_at         TIMESTAMPTZ,
  currency          TEXT NOT NULL,
  gross             NUMERIC(14,2) NOT NULL,    -- soma dos itens (sem frete do comprador)
  buyer_shipping    NUMERIC(14,2) NOT NULL DEFAULT 0,  -- frete pago pelo comprador (exibido à parte)
  fulfillment       TEXT,                      -- 'platform' (FBA/Full/FBT) | 'seller' | NULL
  pack_id           TEXT,                      -- carrinho/pacote (ML pack_id, TikTok package)
  raw               JSONB NOT NULL,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider, connection_id, external_order_id)
);

CREATE TABLE IF NOT EXISTS workspace_channel_order_items (
  workspace_id      TEXT NOT NULL,
  provider          TEXT NOT NULL,
  connection_id     TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  line_no           SMALLINT NOT NULL,
  external_product_id TEXT NOT NULL,           -- MLB…, ASIN, product_id/sku_id
  sku               TEXT,                      -- seller_sku; NUNCA assumir único entre canais
  title             TEXT NOT NULL,
  qty               INTEGER NOT NULL,
  unit_price        NUMERIC(14,2) NOT NULL,
  PRIMARY KEY (workspace_id, provider, connection_id, external_order_id, line_no)
);

CREATE TABLE IF NOT EXISTS workspace_channel_order_fees (
  workspace_id      TEXT NOT NULL,
  provider          TEXT NOT NULL,
  connection_id     TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  fee_type          TEXT NOT NULL,             -- taxonomia acima
  provider_fee_code TEXT NOT NULL DEFAULT '',  -- 'sale_fee', 'FBAPerUnitFulfillmentFee', …
  amount            NUMERIC(14,2) NOT NULL,    -- positivo = debitado do vendedor
  currency          TEXT NOT NULL,
  PRIMARY KEY (workspace_id, provider, connection_id, external_order_id, fee_type, provider_fee_code)
);

CREATE TABLE IF NOT EXISTS workspace_channel_products (
  workspace_id      TEXT NOT NULL,
  provider          TEXT NOT NULL,
  connection_id     TEXT NOT NULL,
  external_product_id TEXT NOT NULL,
  sku               TEXT,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL,             -- canônico: active | paused | closed
  provider_status   TEXT NOT NULL,
  price             NUMERIC(14,2) NOT NULL,
  currency          TEXT NOT NULL,
  available_qty     INTEGER NOT NULL DEFAULT 0,
  fulfillment       TEXT,                      -- 'platform' | 'seller' | NULL
  thumbnail         TEXT,
  permalink         TEXT,
  cost_id           TEXT,                      -- vínculo com workspace_product_costs (histórico)
  raw               JSONB NOT NULL,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider, connection_id, external_product_id)
);

CREATE INDEX IF NOT EXISTS channel_orders_period_idx
  ON workspace_channel_orders (workspace_id, provider, connection_id, occurred_at DESC)
  INCLUDE (status, gross, currency);
CREATE INDEX IF NOT EXISTS channel_orders_workspace_period_idx
  ON workspace_channel_orders (workspace_id, occurred_at DESC);   -- dashboard consolidado
CREATE INDEX IF NOT EXISTS channel_order_items_product_idx
  ON workspace_channel_order_items (workspace_id, provider, connection_id, external_product_id);
CREATE INDEX IF NOT EXISTS channel_products_status_idx
  ON workspace_channel_products (workspace_id, provider, connection_id, status);
```

## Tipos canônicos (contrato dos adaptadores)

```ts
export type CanonicalOrderStatus =
  | "pending" | "paid" | "shipped" | "delivered" | "cancelled" | "refunded";

export type CanonicalFeeType =
  | "commission" | "shipping_seller" | "fulfillment" | "payment"
  | "ads" | "taxes_withheld" | "refund" | "other";

export interface CanonicalOrderItem {
  externalProductId: string;
  sku: string | null;
  title: string;
  qty: number;
  unitPrice: number;
}

export interface CanonicalFee {
  feeType: CanonicalFeeType;
  providerFeeCode: string;   // código original do canal
  amount: number;            // positivo = debitado do vendedor
  currency: string;
}

export interface CanonicalOrder {
  externalOrderId: string;
  status: CanonicalOrderStatus;
  providerStatus: string;
  occurredAt: string;        // ISO 8601
  closedAt: string | null;
  currency: string;
  gross: number;             // soma dos itens, sem frete do comprador
  buyerShipping: number;
  fulfillment: "platform" | "seller" | null;
  packId: string | null;
  items: CanonicalOrderItem[];
  fees: CanonicalFee[];      // pode chegar vazio e ser completado depois (ver "fees tardias")
  raw: unknown;
}

export interface CanonicalProduct {
  externalProductId: string;
  sku: string | null;
  title: string;
  status: "active" | "paused" | "closed";
  providerStatus: string;
  price: number;
  currency: string;
  availableQty: number;
  fulfillment: "platform" | "seller" | null;
  thumbnail: string | null;
  permalink: string | null;
  raw: unknown;
}

export interface MarketplaceConnector {
  provider: IntegrationProvider;
  fetchOrders(conn: IntegrationConnection, since: Date, cursor?: string):
    Promise<{ orders: CanonicalOrder[]; nextCursor: string | null }>;
  fetchOrderFees(conn: IntegrationConnection, orderIds: string[]):
    Promise<Map<string, CanonicalFee[]>>;   // canais em que a taxa vem de outra API
  fetchProducts(conn: IntegrationConnection, cursor?: string):
    Promise<{ products: CanonicalProduct[]; nextCursor: string | null }>;
  parseWebhook(body: unknown): { topic: string; resource: string } | null;
}
```

## Mapeamento campo a campo

### Mercado Livre → canônico

| Canônico | Origem | Nota |
|---|---|---|
| `externalOrderId` | `order.id` | stringificar |
| `occurredAt` | `order.date_created` | |
| `closedAt` | `order.date_closed` | |
| `providerStatus` / `status` | `order.status` | tabela de status |
| `currency` | `order.currency_id` | |
| `gross` | `Σ order_items[].unit_price × quantity` | **não** usar `total_amount` (pode incluir frete) |
| `buyerShipping` | shipment `receiver.cost` | busca separada em `/shipments/:id/costs` |
| `packId` | `order.pack_id` | |
| item `externalProductId` | `order_items[].item.id` | |
| item `sku` | `order_items[].item.seller_sku` | |
| fee `commission` | `order_items[].sale_fee × quantity` | `provider_fee_code = 'sale_fee'` |
| fee `shipping_seller` | shipment `senders[].cost` (do seller) | mesma busca do `receiver.cost` |
| `fulfillment` | produto `logistic_type === 'fulfillment'` → `platform` | vem do produto, não do pedido |

### Amazon → canônico

| Canônico | Origem | Nota |
|---|---|---|
| `externalOrderId` | `AmazonOrderId` | |
| `occurredAt` | `PurchaseDate` | |
| `providerStatus` / `status` | `OrderStatus` | `Unshipped` → `paid` |
| `gross` | `OrderTotal.Amount` | ⚠️ inclui frete+impostos do comprador; o valor limpo por item vem do Finances (`Principal`); na fase 1 aceitar `OrderTotal` como aproximação e refinar quando o evento financeiro chegar |
| `currency` | `OrderTotal.CurrencyCode` | |
| `fulfillment` | `FulfillmentChannel` `AFN` → `platform`, `MFN` → `seller` | |
| itens | `getOrderItems` (SP-API) | `ASIN` → `externalProductId`, `SellerSKU` → `sku` |
| fees | Finances API `ShipmentEventList[].ItemFeeList` | `Commission` → `commission`, `FBAPerUnitFulfillmentFee`/`FBAPerOrderFulfillmentFee` → `fulfillment`, `ShippingChargeback` → `shipping_seller`, `MarketplaceFacilitatorTax*` → `taxes_withheld`, refund events → `refund` |

### TikTok Shop → canônico (API 2023-09; implementado e confrontado com amostras reais)

| Canônico | Origem | Nota |
|---|---|---|
| `externalOrderId` | `orders[].id` | `GET /order/202309/orders/search` |
| `occurredAt` | `create_time` | epoch → ISO (`epochToIso` já existe em `tiktok.ts`) |
| `providerStatus` / `status` | `orders[].status` | tabela de status |
| `currency` | `payment.currency` | |
| `gross` | `Σ line_items[].sale_price` | `payment.total_amount` inclui frete do comprador |
| `buyerShipping` | `payment.original_shipping_fee` − descontos de frete | |
| item `externalProductId` | `line_items[].sku_id` (guardar `product_id` no raw) | |
| item `sku` | `line_items[].seller_sku` | |
| fees | Finance API `GET /finance/202309/orders/:id/statement_transactions` | `platform_commission_amount` → `commission`, `transaction_fee_amount` → `payment`, parcela de frete do seller → `shipping_seller` |
| `fulfillment` | `fulfillment_type` | `FULFILLMENT_BY_TIKTOK` → `platform` |

### Shopee → canônico (implementado e testado em sandbox)

`get_order_list`/`get_order_detail` → pedido e itens (`item_sku`, `model_sku`);
`get_escrow_detail` → fees (`commission_fee` → `commission`, `service_fee` →
`payment`, frete real − subsídio → `shipping_seller`). Mesma forma dos outros:
tudo particular da Shopee (assinatura de request, epoch, escrow) morre no adaptador.
O normalizador, a persistência e a leitura canônica estão implementados e cobertos
por testes. Os nomes e a semântica dos campos ainda precisam ser confrontados com
respostas Live: essa validação está bloqueada até o Go Live fornecer credenciais de
produção e uma loja real ser autorizada.

## Decisões de projeto que merecem registro

**Custo do produto resolve na consulta, não na ingestão.** O fluxo do produto é
"venda primeiro, cadastre o custo depois" (`productsWithoutCost` existe por
isso). Congelar `unit_cost` no item na hora da ingestão deixaria o lucro
permanentemente errado para pedidos anteriores ao cadastro. O lucro junta
`workspace_channel_order_items` com o histórico de vigência de
`workspace_product_costs` (via `cost_id`/`sku`) escolhendo o custo vigente em
`occurred_at` — exatamente a semântica que o histórico de vigência já promete.

**Fees tardias são normais.** Amazon e TikTok publicam a taxa real dias depois
do pedido (Finances/Statements). O pedido entra com `fees` parciais e o worker
completa depois via `fetchOrderFees` — por isso fees são tabela própria com
upsert idempotente. A cobertura de lucro é avaliada por componente
(`commission`/`payment`, frete do vendedor, `ads`, `taxes_withheld`, `refund`,
imposto configurado e COGS), além da cobertura do período. Uma linha ausente
não prova valor zero, nem mesmo quando escrow/statement está liquidado; zero só
é conhecido quando a normalização registra evidência explícita do campo. Linhas
anteriores a essa evidência permanecem parciais com segurança.

**Fees são o agregado corrente por pedido, não um ledger.** A chave
`(pedido, fee_type, provider_fee_code)` guarda o último valor conhecido de cada
cobrança — suficiente para lucro e dashboards, que é o que esta fase serve.
Histórico de ajustes, estornos parciais linha a linha e eventos financeiros sem
pedido (ex.: tarifas de armazenagem da Amazon) pedem um **ledger financeiro
separado**, que será desenhado na fase Amazon/Finances — não antes, para não
especular schema sem um consumidor real.

**Status único é o estágio dominante do pedido, por escolha.** Separar
pagamento/entrega/reembolso em três eixos é mais fiel, mas nenhum consumidor
atual precisa disso, e `provider_status` preserva o original para quando
precisar. Reembolso **parcial** não muda o status: entra como fee `refund`
(negativa na receita líquida), mantendo o pedido `paid`/`delivered`. `refunded`
fica reservado para estorno integral. Se a Shopee/Amazon exigirem os eixos
separados, é uma coluna nova por eixo — migração aditiva.

**A escrita canônica nunca derruba o fluxo atual.** Sync e webhook gravam no
canônico via `canonicalBestEffort` (loga e segue); cada gravação de pedido é um
único statement SQL (CTEs) — pedido, linhas e fees entram atomicamente, sem
janela entre delete e insert mesmo com webhook e sync concorrentes.

## O payoff: dashboard vira uma query

Faturamento, vendas e taxas de **qualquer** período, **qualquer** canal — sem
snapshot, sem materializer, sem caso especial para período personalizado:

```sql
SELECT o.provider,
       COUNT(*)                       AS paid_orders,
       SUM(o.gross)                   AS revenue,
       SUM(f.commission)              AS commission,
       SUM(f.shipping_seller)         AS seller_shipping
  FROM workspace_channel_orders o
  LEFT JOIN LATERAL (
       SELECT SUM(amount) FILTER (WHERE fee_type = 'commission')      AS commission,
              SUM(amount) FILTER (WHERE fee_type = 'shipping_seller') AS shipping_seller
         FROM workspace_channel_order_fees f
        WHERE (f.workspace_id, f.provider, f.connection_id, f.external_order_id)
            = (o.workspace_id, o.provider, o.connection_id, o.external_order_id)
  ) f ON true
 WHERE o.workspace_id = $1
   AND o.occurred_at BETWEEN $2 AND $3
   AND o.status IN ('paid', 'shipped', 'delivered')
 GROUP BY o.provider;
```

## Migração sem quebrar o que existe

1. Criar as tabelas novas ao lado das atuais com `npm run migrate`
   (`workspace_marketplace_*` ficam intocadas servindo o fluxo atual).
2. No sync do ML, passar a gravar **nas duas** (o normalizador é função pura
   `MercadoLivreOrder → CanonicalOrder`, testável com as fixtures que já
   existem em `tests/`).
3. Backfill: reprocessar `workspace_marketplace_orders.payload` existente pelo
   mesmo normalizador (é só um `SELECT` + upsert — nenhuma chamada ao ML).
4. Reescrever o overview do ML como SQL sobre o canônico; comparar contra o
   snapshot atual por alguns dias; então desligar materializer/snapshots.
5. TikTok implementa pedidos já no canônico; Shopee nasce nele; Amazon migra
   por último (Orders primeiro, Finances → fees depois).
