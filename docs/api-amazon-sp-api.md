# Amazon SP-API — endpoints usados e lições aprendidas

Referência interna do SellerCore. Tudo aqui foi validado em produção (conta BR, marketplace `A2Q3Y263D00KWC`). Atualize este arquivo sempre que um endpoint novo entrar ou uma pegadinha nova for descoberta.

## Infra (`src/lib/spapi.ts`)

- Hosts: `https://sellingpartnerapi-na.amazon.com` (Brasil fica na região **NA**), `-eu`, `-fe`; sandbox em `https://sandbox.sellingpartnerapi-*.amazon.com`.
- Auth LWA: `POST https://api.amazon.com/auth/o2/token` com `grant_type=refresh_token`. O refresh token é emitido pelo app OAuth de produção — scripts locais precisam do `OAUTH_CLIENT_ID/SECRET` e `INTEGRATION_TOKEN_KEY` **de produção** no `.env.local`, senão o decrypt do token falha.
- `spapiFetch(path, { query, method, body })` cuida de token, host e erros (`SpApiError` com `technicalDetail` e `amazonRequestId` — sempre logar esses dois ao debugar).
- Scripts de sondagem: `node --experimental-transform-types --import ./scripts/ts-resolver.mjs --env-file=.env.local <script>` + `runWithWorkspace`/`runWithAccount`.

## Vendas e pedidos

| Endpoint | Uso no projeto | Observações |
|---|---|---|
| `GET /sales/v1/orderMetrics` | **Faturamento oficial** (`src/lib/sales.ts`) | É o número que bate com o Seller Central ("vendas de produtos pedidos"). Granularidade via `granularity` + `granularityTimeZone`. **Fonte da verdade para faturamento — não trocar.** |
| `GET /orders/v0/orders` | Lista de pedidos (`src/lib/orders.ts`) | Paginação por `NextToken`. Filtros `CreatedAfter/Before`, `OrderStatuses`. |
| `GET /orders/v0/orders/{id}/orderItems` | Itens do pedido | — |

## Financeiro

| Endpoint | Uso no projeto | Observações |
|---|---|---|
| `GET /finances/2024-06-19/transactions` | **Fees e lucro** (`src/lib/transactions.ts`) | API atual (Transactions). Estrutura em árvore: `Sales → ProductCharges`, `Expenses → AmazonFees → {Commission, FBAPerUnitFulfillmentFee, …} → {Base, Tax}` (somar só as FOLHAS Base/Tax, senão duplica). |
| `GET /finances/v0/financialEvents` | Legado (`src/lib/finances.ts`) | ⚠️ **Retorna valores ZERADOS nesta conta** (comportamento deprecado). Não confiar; migrar tudo para Transactions (item no TODO.md). |

### Pegadinhas do Transactions (aprendidas na prática)

- **Não usar como faturamento**: soma por *posted date* e inclui eventos não-venda → dá até 49% acima do Seller Central. Faturamento é `orderMetrics`.
- **Status**: `RELEASED`, `DEFERRED`, `DEFERRED_RELEASED`. Excluir `DEFERRED_RELEASED` das somas (é a re-postagem do DEFERRED — contar os dois duplica).
- **`transactionType: "Transfer"`** = repasse bancário, não é venda/fee. Excluir sempre.

## Listings (a saga do FBA — 2026-07-22)

| Endpoint | Uso | Observações |
|---|---|---|
| `GET /listings/2021-08-01/items/{sellerId}/{sku}` | Ler anúncio | `includedData=attributes,issues,offers,fulfillmentAvailability,summaries`. |
| `PATCH /listings/2021-08-01/items/{sellerId}/{sku}` | Editar anúncio | Body: `{ productType, patches: [...] }`. Ver semântica de selectors abaixo. |
| `PUT /listings/2021-08-01/items/...` | Criar anúncio (`src/lib/amazonListingBuilder.ts`) | — |
| `GET /listings/2021-08-01/restrictions` | Restrições de venda por ASIN | — |
| `GET /definitions/2020-09-01/productTypes[/{type}]` | Schema do product type | É aqui que os **selectors** de cada atributo são definidos. |

### ⚠️ Semântica de PATCH com selectors (a lição mais cara)

Atributos-lista (ex.: `fulfillment_availability`) têm um **selector** — para fulfillment é `fulfillment_channel_code`. Consequências:

1. **`replace` NÃO sobrescreve o array.** Só atualiza/cria a entrada com o MESMO selector. `replace` com `[{AMAZON_NA}]` deixa uma entrada `DEFAULT` existente **intocada** (retorna ACCEPTED e "nada muda").
2. **Remover uma entrada = `delete` com o selector no `value`:**
   ```json
   { "op": "delete", "path": "/attributes/fulfillment_availability",
     "value": [{ "fulfillment_channel_code": "DEFAULT" }] }
   ```
3. `delete` sem `value` → erro "Invalid empty value". `delete` por índice (`/attributes/x/1`) → "Invalid path". A API não trabalha com índices.
4. Pode combinar `replace` + `delete` no mesmo PATCH (suportado desde 2022).
5. Fonte: github.com/amzn/selling-partner-api-models issue **#2061** (resposta oficial do time SP-API).

### Caso real: FNSKU travado por offer FBA+FBM duplo

O Seller Central remove FBM quando você ativa FBA — **a API não**. Anúncio criado via API pode ficar com `fulfillment_availability = [{AMAZON_NA}, {DEFAULT, quantity: 0}]`. Esse conflito **impede o registro do FNSKU** e a variação não aparece no "Enviar para a Amazon". Correção: `delete` da entrada `DEFAULT` (receita acima). FNSKU aparece ~1h após a conversão limpa.

## Catálogo, preço, estoque

| Endpoint | Uso | Observações |
|---|---|---|
| `GET /catalog/2022-04-01/items[/{asin}]` | Busca/detalhe de catálogo (`src/lib/catalog.ts`, `search.ts`) | `includedData=attributes,images,salesRanks,summaries`. |
| `GET /products/pricing/v0/competitivePrice` | Preço competitivo (`src/lib/pricing.ts`) | — |
| `GET /products/pricing/v0/items/{asin}/offers` | Ofertas do ASIN | — |
| `GET /products/fees/v0/items/{asin}/feesEstimate` | Estimativa de tarifas (`src/lib/fees.ts`) | POST na prática (body com preço). |
| `GET /fba/inventory/v1/summaries` | Estoque FBA (`src/lib/inventory.ts`) | `details=true` traz **`fnSku`** — é aqui que se verifica se a variação registrou no FBA. |
| `GET /fba/inbound/v1/eligibility/itemPreview` | Elegibilidade FBA por ASIN | `program=INBOUND`. Usado no diagnóstico do caso FNSKU. |

## Relatórios e conta

| Endpoint | Uso | Observações |
|---|---|---|
| `POST /reports/2021-06-30/reports` → `GET .../reports/{id}` → `GET .../documents/{docId}` | Relatórios (`src/lib/reports.ts`) | Fluxo assíncrono: criar, poll até DONE, baixar documento (pode vir gzip). `GET_MERCHANT_LISTINGS_ALL_DATA` lista todos os SKUs. |
| `GET /sellers/v1/marketplaceParticipations` | Marketplaces da conta (`src/lib/sellers.ts`) | Bom "ping" para validar credenciais. |
