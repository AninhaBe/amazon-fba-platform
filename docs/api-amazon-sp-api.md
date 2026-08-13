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

### `Pending` no FBA não é "não pagou" (2026-08-08)

Pedido FBA fica em `OrderStatus: Pending` **mesmo depois do pagamento confirmado** —
sai de `Pending` na expedição, não na aprovação do cartão. Observado ao vivo no
pedido `702-2192919-5915420`: comprador recebeu "Confirmação de pagamento" às 14:06,
`LastUpdateDate` 14:09, e 7 horas depois ainda `Pending`, dentro do prazo
(`EarliestShipDate` = `LatestShipDate` = dia seguinte 23:59).

Consequência para o cálculo: enquanto está `Pending`, a Amazon **omite `OrderTotal`
no pedido e `ItemPrice` nos itens**. Não é falha de sync — o pedido entra no modelo
canônico com `gross` 0 e sem fees porque não há valor a capturar. Como não há
expedição, também não existe transação financeira, e o lucro conciliado fica
**vazio (desconhecido), nunca zero** — ver o card em `src/app/amazon/page.tsx`.

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

### Fees API devolve zero — e o zero pode ser verdadeiro (2026-08-09)

`POST /products/fees/v0/items/{asin}/feesEstimate` responde `Status: "Success"`
com **todas as tarifas zeradas**: `ReferralFee = 0`, `FBAFees = 0`,
`TotalFeesEstimate = 0`. Testado com ASIN próprio (`B0HBGLBL6Y`) e de terceiro
(`B0H42G9TGW`), `IsAmazonFulfilled` true e false, preços de R$ 15,90 a R$ 99,00.

⚠️ **Primeira leitura estava errada.** Registramos como "a API mente, igual à
Finances v0". A vendedora informou depois que **está isenta de tarifas por ser
seller nova (benefício de entrada)** — então o zero reflete a conta, não um
defeito. A Fees API estima o que **o seller autenticado** pagaria, não o dono do
ASIN; por isso devolve zero até em ASIN de terceiro, e isso é coerente.

O que isso exige do código:

1. **Zero da Fees API é um valor plausível, não lixo** — mas continua
   indistinguível de "não sei", porque a API não informa isenção nem prazo.
2. **A isenção é temporária.** Projetar margem futura com tarifa zero engana tão
   feio quanto tratar desconhecido como zero. Quem decide compra de estoque
   precisa ver os dois cenários: com benefício e sem.
3. A tarifa **real** aparece em `GET /finances/2024-06-19/transactions` quando o
   pedido é postado (`Commission`, `FBAPerUnitFulfillmentFee` separados). É a
   única fonte que confirma se a isenção valeu e em quanto.

`POST /products/fees/v0/feesEstimate` (lote) rejeita com `Missing objects
[PriceToEstimateFees]` mesmo com o campo presente no item da lista; não
investigado a fundo porque a versão por ASIN já resolve.

### `mode=VALIDATION_PREVIEW` — testar um anúncio sem criar (2026-08-08)

`PUT /listings/2021-08-01/items/{sellerId}/{sku}?mode=VALIDATION_PREVIEW` valida o
payload e devolve `status` + `issues` **sem gravar nada**. É o equivalente por API a
"começar a criar um anúncio para ver o que a Amazon aceita", sem sujar o catálogo
com rascunho.

Usado em 08/08 para provar que a logística da Amazon está disponível em anúncio
novo: com `fulfillment_availability: [{ fulfillment_channel_code: "AMAZON_NA" }]`
o retorno foi `VALID`, 0 issues. Sem os atributos de compliance do productType
(`batteries_required`, `supplier_declared_dg_hz_regulation`) o retorno é `INVALID`
com dois erros `90220` — que são do tipo de produto, **não** do canal de envio.

### Caso real: FNSKU travado por offer FBA+FBM duplo

O Seller Central remove FBM quando você ativa FBA — **a API não**. Anúncio criado via API pode ficar com `fulfillment_availability = [{AMAZON_NA}, {DEFAULT, quantity: 0}]`. Esse conflito **impede o registro do FNSKU** e a variação não aparece no "Enviar para a Amazon". Correção: `delete` da entrada `DEFAULT` (receita acima). FNSKU aparece ~1h após a conversão limpa.

## Catálogo, preço, estoque

| Endpoint | Uso | Observações |
|---|---|---|
| `GET /catalog/2022-04-01/items[/{asin}]` | Busca/detalhe de catálogo (`src/lib/catalog.ts`, `search.ts`) | `includedData=attributes,images,salesRanks,summaries`. ⚠️ Em lote (`identifiers`), o `pageSize` **padrão é 10** — um lote de 20 ASINs volta pela metade em silêncio. Sempre passar `pageSize` explícito (máx. 20). |
| `GET /products/pricing/v0/competitivePrice` | Preço competitivo (`src/lib/pricing.ts`) | — |
| `GET /products/pricing/v0/items/{asin}/offers` | Ofertas do ASIN | — |
| `GET /products/fees/v0/items/{asin}/feesEstimate` | Estimativa de tarifas (`src/lib/fees.ts`) | POST na prática (body com preço). ⚠️ **Retorna ZERADO nesta conta** — ver abaixo. |
| `GET /fba/inventory/v1/summaries` | Estoque FBA (`src/lib/inventory.ts`) | `details=true` traz **`fnSku`** — é aqui que se verifica se a variação registrou no FBA. |
| `GET /fba/inbound/v1/eligibility/itemPreview` | Elegibilidade FBA por ASIN | `program=INBOUND`. Usado no diagnóstico do caso FNSKU. |

## FBA Inbound — envio e agendamento de entrega (2024-03-20)

Usada para o envio self-ship (a própria vendedora entrega no CD). Operações da API
Fulfillment Inbound `2024-03-20` sobre `inboundPlans/{id}/shipments/{id}`:

- `generateSelfShipAppointmentSlots` → gerar janelas de entrega. **Sem esse passo o
  calendário do Seller Central abre mas não mostra botão de confirmar** — os slots não
  existem até serem gerados (pegadinha de 2026-08-04).
- `getSelfShipAppointmentSlots` → listar as janelas geradas.
- `scheduleSelfShipAppointment` → confirmar a janela (retorna o `appointmentId`).

## Relatórios e conta

| Endpoint | Uso | Observações |
|---|---|---|
| `POST /reports/2021-06-30/reports` → `GET .../reports/{id}` → `GET .../documents/{docId}` | Relatórios (`src/lib/reports.ts`) | Fluxo assíncrono: criar, poll até DONE, baixar documento (pode vir gzip). `GET_MERCHANT_LISTINGS_ALL_DATA` lista todos os SKUs. |
| `GET /sellers/v1/marketplaceParticipations` | Marketplaces da conta (`src/lib/sellers.ts`) | Bom "ping" para validar credenciais. |

### Transportadora do inbound: sem caminho por API hoje (2026-08-08)

Para saber qual transportadora a Amazon oferece num envio (a "parceira da Amazon"
/ TEXBR), as duas portas estão fechadas para este app:

- `GET /inbound/fba/2024-03-20/inboundPlans/{id}/shipments` → **403 Unauthorized**.
  Falta papel na aplicação SP-API (mesmo padrão do relatório de tráfego, que exige
  Brand Analytics). `GET .../inboundPlans/{id}` sozinho responde 200 — o bloqueio é
  só no nível de shipments.
- `GET /fba/inbound/v0/shipments/{id}/transport` → **400: "This API is deprecated.
  Please migrate to the new Fulfillment Inbound v2024-03-20 APIs."** A listagem
  `v0/shipments` ainda responde 200 (exige `ShipmentStatusList` ou `ShipmentIdList`),
  mas o transporte não.

Conclusão: a escolha de transportadora só é verificável na tela *Enviar para a
Amazon*. Se o papel for concedido, o caminho é `transportationOptions` da 2024-03-20.

## Changelog observado (mais recente primeiro)

- **2026-08-12** — **Cupom não aparece na Product Pricing API.** O
  `kit-clips-320` (`B0HBGLBL6Y`) estava com cupom de 10% off, e
  `GET /products/pricing/v0/items/{asin}/offers` devolveu `ListingPrice`,
  `LandedPrice` e `BuyBoxPrices` **todos a R$ 22,11**, sem nenhum campo de
  promoção ou desconto. O valor realmente pago (R$ 19,90) só apareceu no pedido,
  via Orders API.
  - Consequência: o preço da Pricing API é o **preço cheio**, não o preço
    praticado. Toda projeção feita em cima dele (margem por SKU, teto de ACOS,
    piso de preço FBA da pesquisa de nicho) fica otimista pelo valor do cupom,
    enquanto o realizado continua correto.
  - Tratar esse preço como **teto**, nunca como preço realizado. Desconto
    desconhecido é desconhecido, não zero.

- **2026-08-06** — **`GET_SALES_AND_TRAFFIC_REPORT` responde 403 Forbidden.**
  Não é token revogado nem erro de código: o relatório exige o papel
  **Brand Analytics**, que este app não possui. O perfil de desenvolvedor e os
  demais papéis funcionam normalmente (pedidos, listings, FBA, financeiro) — é
  um papel adicional que falta.
  - Peculiaridade confirmada em issues do repositório oficial (amzn #1989,
    #3018): Brand Analytics **não aparece como caixa de seleção** na
    configuração do app, diferente dos outros papéis. Precisa ser solicitado
    nominalmente via caso no suporte de desenvolvedores.
  - Depois de concedido: aplicar ao app, re-listar e **reautorizar** (a
    autorização antiga não carrega o papel novo).
  - Consequência: `/amazon/desempenho` (sessões, visualizações, conversão,
    % buy box) está implementado mas não funciona. Fonte alternativa hoje:
    Seller Central → Relatórios de Negócios.

- **2026-08-06** — **Refresh token revogado nas duas contas conectadas por
  OAuth** (`invalid_grant`). O `LWA_REFRESH_TOKEN` do ambiente continua válido —
  scripts de diagnóstico devem rodar **sem** `runWithAccount` para usá-lo. Ver
  [`conexoes-que-expiram.md`](./conexoes-que-expiram.md).

A Amazon muda comportamento e deprecia versões sem quebrar na hora. Toda mudança ou
pegadinha **datada** observada na prática entra aqui — o detalhe fica na seção
correspondente acima; esta lista é o índice cronológico.

- **2026-08-04** — Agendamento self-ship (Fulfillment Inbound 2024-03-20): slots de
  entrega precisam ser **gerados** (`generateSelfShipAppointmentSlots`) antes de
  listar/confirmar; sem isso o calendário do Seller Central fica sem botão de confirmação.
- **2026-08-03** — Catalog Items 2022-04-01 em lote (`identifiers`): confirmado que o
  `pageSize` padrão é **10** — lotes de 20 ASINs voltavam pela metade em silêncio (o
  snapshot de ranking rodou semanas capturando metade dos itens). Sempre passar `pageSize`.
- **2026-07-22** — Semântica de PATCH com selectors confirmada com o caso real do FNSKU
  travado por offer FBA+FBM duplo (fonte oficial: issue #2061). `replace` não sobrescreve
  array; remover entrada exige `delete` com selector no `value`.
- **(sem data precisa)** — `GET /finances/v0/financialEvents` retorna valores **zerados**
  nesta conta (deprecação silenciosa). Fees e lucro migrados para
  `GET /finances/2024-06-19/transactions`.
