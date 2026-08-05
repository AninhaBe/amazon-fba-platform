# API endpoints — Amazon SP-API & Mercado Livre (referência geral)

Visão geral das duas APIs: os **grupos** e seus **endpoints principais**, com o que cada
um retorna. Não é exaustivo até a última operação (a SP-API tem centenas) — é a "boa
geral" pra você saber o que existe e onde procurar.

> **Como usar / avisos honestos**
> - Para **o que o SellerCore usa e as pegadinhas já pagas** (semântica de PATCH, regra
>   de faturamento do ML, FNSKU…), veja [`api-amazon-sp-api.md`](./api-amazon-sp-api.md)
>   e [`api-mercado-livre.md`](./api-mercado-livre.md). **Este arquivo é panorama**, não
>   substitui a doc oficial.
> - **Versões mudam.** Onde há mais de uma versão, marcamos a atual e a legada. Confirme
>   na doc oficial antes de implementar algo novo (fontes no fim).
> - SP-API: base de host para o **Brasil** (`A2Q3Y263D00KWC`) é a região **NA** —
>   `https://sellingpartnerapi-na.amazon.com`. Auth por token LWA (`x-amz-access-token`);
>   dados restritos (PII) exigem um **RDT** da Tokens API.
> - ML: base `https://api.mercadolibre.com` (o site — `MLB` p/ Brasil — é por recurso);
>   OAuth em `https://auth.mercadolivre.com.br`; Mercado Pago em `https://api.mercadopago.com`.

---

## 0. O que o SellerCore usa hoje (do código)

### Amazon SP-API
| Endpoint | Onde no código | Pra quê |
|---|---|---|
| `GET /catalog/2022-04-01/items` | `lib/search.ts`, `lib/integrations/amazonRankSnapshot.ts` | Busca de mercado (/pesquisa) e foto de ranking. |
| `GET /catalog/2022-04-01/items/{asin}` | `lib/catalog.ts`, `lib/amazonListingBuilder.ts` | Detalhe do ASIN (rank, dimensões, marca) e inspeção pra anúncio. |
| `GET /listings/2021-08-01/restrictions` | `lib/amazonListingBuilder.ts` | Gating (você pode listar esse ASIN?). |
| `PUT /listings/2021-08-01/items/{sellerId}/{sku}` | `lib/amazonListingBuilder.ts` | Criar/atualizar anúncio (com `VALIDATION_PREVIEW`). |
| `GET /definitions/2020-09-01/productTypes` (+ `/{type}`) | `lib/amazonListingBuilder.ts` | Descobrir product type e atributos obrigatórios. |
| `GET /fba/inventory/v1/summaries` | `lib/inventory.ts` | Estoque FBA (radar, ruptura). |
| `GET /orders/v0/orders` | `lib/orders.ts` | Pedidos. |
| `GET /products/pricing/v0/competitivePrice` | `lib/pricing.ts` | Preço competitivo + nº de ofertas. |
| `GET /sales/v1/orderMetrics` | `lib/sales.ts` | Métricas agregadas (dashboard). |
| `GET /finances/2024-06-19/transactions` | `lib/transactions.ts` | Financeiro conciliado (lucro real). |
| `POST/GET /reports/2021-06-30/reports` (+ `/documents`) | `lib/reports.ts` | Relatórios. |

### Mercado Livre
| Endpoint | Onde no código | Pra quê |
|---|---|---|
| `POST /oauth/token` | `api/integrations/mercado-livre/callback` | OAuth (token rotativo — persistir o novo refresh na hora). |
| `GET /users/me` | `lib/integrations/mercadoLivre.ts`, callback | Conta conectada. |
| `GET /users/{id}/items/search` | `lib/integrations/mercadoLivre.ts` | Anúncios do vendedor. |
| `GET /items/{id}` (+ `/sale_price`, `/description`) | `lib/integrations/mercadoLivre.ts`, webhook | Detalhe do anúncio e preço promocional real. |
| `GET /sites/{site}/listing_prices` | `lib/integrations/mercadoLivre.ts` | Tarifa/comissão por preço. |
| `GET /shipments/{id}/costs` | `mercadoLivre.ts`, `...Webhook.ts`, `...Sync.ts` | Frete real (vendedor vs comprador). |
| `GET /orders/search` | `mercadoLivre.ts`, `...Sync.ts` | Pedidos (faturamento). |
| `GET /users/{id}/shipping_options/free` | `lib/integrations/mercadoLivre.ts` | Custo estimado de frete grátis. |
| Webhooks (tópicos `orders_v2`, `items`, `shipments`, `questions`…) | `mercadoLivreWebhook.ts` | Notificações de mudança. |

O resto (abaixo) é o que as APIs **oferecem** e ainda não usamos.

---

# Amazon Selling Partner API (SP-API)

## Orders — `/orders/v0`
| Método | Path | Retorna / faz |
|---|---|---|
| GET | `/orders/v0/orders` | Lista pedidos por marketplace, data, status, canal de fulfillment. |
| GET | `/orders/v0/orders/{orderId}` | Cabeçalho de um pedido. |
| GET | `/orders/v0/orders/{orderId}/orderItems` | Itens do pedido (ASIN/SKU, qtd, preços). |
| GET | `/orders/v0/orders/{orderId}/address` | Endereço de entrega (PII — precisa RDT). |
| GET | `/orders/v0/orders/{orderId}/buyerInfo` | Dados do comprador (PII — precisa RDT). |
| GET | `/orders/v0/orders/{orderId}/regulatedInfo` | Metadados de pedido regulado (documentos exigidos). |
| POST | `/orders/v0/orders/{orderId}/shipmentConfirmation` | Confirma envio (MFN). |

## Catalog Items — `/catalog/2022-04-01` (atual)
Legado: `/catalog/2020-12-01`, `catalogItemsV0`.
| Método | Path | Retorna / faz |
|---|---|---|
| GET | `/catalog/2022-04-01/items` | Busca por palavra-chave ou por identificador (ASIN/EAN/UPC/GTIN); itens com o `includedData` pedido. |
| GET | `/catalog/2022-04-01/items/{asin}` | Detalhe de um ASIN: atributos, dimensões, identificadores, imagens, product types, relações, **sales rank**, summaries. |

## Listings Items — `/listings/2021-08-01` (atual)
Legado: `/listings/2020-09-01`.
| Método | Path | Retorna / faz |
|---|---|---|
| GET | `/listings/2021-08-01/items/{sellerId}/{sku}` | Anúncio do vendedor pra um SKU (summaries, atributos, issues, ofertas, disponibilidade). |
| PUT | `/listings/2021-08-01/items/{sellerId}/{sku}` | Cria ou substitui o anúncio do SKU. |
| PATCH | `/listings/2021-08-01/items/{sellerId}/{sku}` | Atualização parcial (semântica de PATCH da Amazon: `replace` **não** sobrescreve arrays — deletar por selector antes). |
| DELETE | `/listings/2021-08-01/items/{sellerId}/{sku}` | Apaga o anúncio. |
| GET | `/listings/2021-08-01/items/{sellerId}` | Pagina os anúncios do vendedor. |
| GET | `/listings/2021-08-01/restrictions` | **Gating**: restrições pra listar um ASIN + condição + vendedor (ex.: "aprovação necessária"), com links de solicitação. |

## Product Type Definitions — `/definitions/2020-09-01`
| Método | Path | Retorna / faz |
|---|---|---|
| GET | `/definitions/2020-09-01/productTypes` | Busca product types do marketplace (por keyword/item). |
| GET | `/definitions/2020-09-01/productTypes/{productType}` | JSON Schema (atributos obrigatórios/validação) do product type — pra montar o Listings. |

## FBA Inventory — `/fba/inventory/v1`
| Método | Path | Retorna / faz |
|---|---|---|
| GET | `/fba/inventory/v1/summaries` | Estoque FBA (fulfillable, inbound, reserved, unfulfillable) por SKU/ASIN. |

## Fulfillment Inbound (FBA) — `/inbound/fba/2024-03-20` (atual) · `/fba/inbound/v0` (legado)
A **2024-03-20** é orientada a workflow (criar plano → packing → placement → transporte → janela de entrega → confirmar). Operações principais: `POST/GET /inboundPlans`, `.../packingOptions`, `.../placementOptions`, `.../transportationOptions`, `.../deliveryWindowOptions`, `.../shipments/{id}`, `GET /operations/{operationId}` (status de operação assíncrona). O **v0** (`createInboundShipmentPlan`, `createInboundShipment`, `getShipments`, `getLabels`, `getTransportDetails`…) está sendo aposentado.
| Método | Path | Retorna / faz |
|---|---|---|
| GET | `/fba/inbound/v1/eligibility/itemPreview` | Se um item é elegível pra inbound FBA, com motivos de inelegibilidade. |

## Fulfillment Outbound (MCF) — `/fba/outbound/2020-07-01`
| Método | Path | Retorna / faz |
|---|---|---|
| GET | `/fba/outbound/2020-07-01/fulfillmentPreview` | Prévia (taxas, prazos) de um pedido Multi-Channel Fulfillment. |
| POST | `/fba/outbound/2020-07-01/fulfillmentOrders` | Cria pedido MCF. |
| GET | `/fba/outbound/2020-07-01/fulfillmentOrders/{id}` | Pedido MCF com envios e itens. |
| PUT | `.../fulfillmentOrders/{id}/cancel` | Cancela pedido MCF. |
| GET | `/fba/outbound/2020-07-01/tracking` | Rastreamento de um envio MCF. |

## Merchant Fulfillment — `/mfn/v0`
| Método | Path | Retorna / faz |
|---|---|---|
| POST | `/mfn/v0/eligibleShippingServices` | Serviços/tarifas elegíveis de Buy Shipping pra um pedido. |
| POST | `/mfn/v0/shipments` | Compra etiqueta (cria o envio). |
| GET/DELETE | `/mfn/v0/shipments/{shipmentId}` | Retorna / cancela o envio. |

## Shipping (Buy Shipping) — `/shipping/v2` (atual) · `/shipping/v1` (legado)
| Método | Path | Retorna / faz |
|---|---|---|
| POST | `/shipping/v2/shipments/rates` | Tarifas/serviços disponíveis pra um envio. |
| POST | `/shipping/v2/shipments` | Compra (cria) o envio; retorna etiqueta + rastreio. |
| GET | `/shipping/v2/shipments/{id}` | Detalhe do envio. |
| POST | `/shipping/v2/shipments/{id}/cancel` | Cancela o envio. |
| GET | `/shipping/v2/tracking` | Status de rastreio (tracking id + carrier). |

## Feeds — `/feeds/2021-06-30`
| Método | Path | Retorna / faz |
|---|---|---|
| POST | `/feeds/2021-06-30/documents` | Cria feed document (retorna URL de upload). |
| POST | `/feeds/2021-06-30/feeds` | Cria um feed (referencia o documento). |
| GET | `/feeds/2021-06-30/feeds/{feedId}` | Status de processamento do feed. |
| GET | `/feeds/2021-06-30/documents/{feedDocumentId}` | URL pra baixar o relatório de processamento. |

## Reports — `/reports/2021-06-30`
| Método | Path | Retorna / faz |
|---|---|---|
| POST | `/reports/2021-06-30/reports` | Solicita a criação de um relatório. |
| GET | `/reports/2021-06-30/reports/{reportId}` | Status + `reportDocumentId`. |
| GET | `/reports/2021-06-30/documents/{reportDocumentId}` | URL de download dos dados (pode vir comprimido/criptografado). |
| GET/POST | `/reports/2021-06-30/schedules` | Lista/cria agendamentos de relatório. |

## Finances — `/finances/v0` (legado) · `/finances/2024-06-19` Transactions (atual) · Transfers `/finances/transfers/2024-06-01`
| Método | Path | Retorna / faz |
|---|---|---|
| GET | `/finances/2024-06-19/transactions` | **Transações financeiras** (modelo plano) por período — substitui os eventos granulares do v0. **(usado)** |
| GET | `/finances/v0/financialEvents` | Eventos financeiros por data (legado, granular). |
| GET | `/finances/v0/orders/{orderId}/financialEvents` | Eventos financeiros de um pedido. |
| GET | `/finances/transfers/2024-06-01/payments` | Repasses/disbursements pra conta bancária. |

## Product Pricing — `/products/pricing/v0` (legado) · `/products/pricing/2022-05-01` (Buy Box)
| Método | Path | Retorna / faz |
|---|---|---|
| GET | `/products/pricing/v0/competitivePrice` | Preço competitivo dos itens (+ nº de ofertas). **(usado)** |
| GET | `/products/pricing/v0/items/{asin}/offers` | Ofertas de menor preço pra um ASIN. |
| POST | `/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice` | Preço necessário pra ganhar/manter a **Featured Offer (Buy Box)** (batch). |

## Product Fees — `/products/fees/v0`
| Método | Path | Retorna / faz |
|---|---|---|
| POST | `/products/fees/v0/items/{asin}/feesEstimate` | Estimativa de tarifas (referral/FBA) pra um ASIN a um preço. |
| POST | `/products/fees/v0/feesEstimate` | Estimativa em lote. |

## Sales — `/sales/v1`
| Método | Path | Retorna / faz |
|---|---|---|
| GET | `/sales/v1/orderMetrics` | Métricas agregadas (pedidos, unidades, vendas) por intervalo — dashboard sem puxar cada pedido. **(usado)** |

## Notifications — `/notifications/v1`
| Método | Path | Retorna / faz |
|---|---|---|
| POST | `/notifications/v1/subscriptions/{notificationType}` | Assina um tipo de notificação (destino SQS/EventBridge). |
| POST/GET | `/notifications/v1/destinations` | Cria/lista destinos. |

## Tokens (RDT) — `/tokens/2021-03-01`
| Método | Path | Retorna / faz |
|---|---|---|
| POST | `/tokens/2021-03-01/restrictedDataToken` | **RDT** de curta duração pra acessar dados restritos (PII: endereço/comprador). |

## Sellers — `/sellers/v1`
| Método | Path | Retorna / faz |
|---|---|---|
| GET | `/sellers/v1/marketplaceParticipations` | Marketplaces em que o vendedor participa e status. |
| GET | `/sellers/v1/account` | Metadados da conta (tipo de negócio, programas). |

## Solicitations — `/solicitations/v1`
| Método | Path | Retorna / faz |
|---|---|---|
| POST | `/solicitations/v1/orders/{amazonOrderId}/solicitations/productReviewAndSellerFeedback` | Envia o "solicitar avaliação" ao comprador. |

## Messaging — `/messaging/v1`
| Método | Path | Retorna / faz |
|---|---|---|
| GET | `/messaging/v1/orders/{amazonOrderId}` | Ações de mensagem permitidas pro pedido. |
| POST | `/messaging/v1/orders/{amazonOrderId}/messages/...` | Mensagens comprador-vendedor (confirmar entrega, garantia, etc.). |

## Tax / Invoices (NF-e) — `/tax/invoices/2024-06-19`  ← relevante Brasil
| Método | Path | Retorna / faz |
|---|---|---|
| GET | `/tax/invoices/2024-06-19/invoices` | Lista notas fiscais (NF-e) por data/status. |
| GET | `/tax/invoices/2024-06-19/documents/{invoicesDocumentId}` | URL de download dos documentos (PDF/XML da NF-e). |

## Shipment Invoicing (VCS, Brasil) — `/fba/outbound/brazil/v0`
| Método | Path | Retorna / faz |
|---|---|---|
| POST | `/fba/outbound/brazil/v0/shipments/{shipmentId}/invoice` | Envia a NF-e de um envio FBA no Brasil. |

## Outros grupos SP-API (menção)
- **Data Kiosk** `/dataKiosk/2023-11-15` — analytics em lote via **GraphQL** (vendas & tráfego, economics). `POST /queries` → `queryId` → `GET /documents/{id}`.
- **A+ Content** `/aplus/2020-11-01` — conteúdo A+ (documentos, ASINs, publicar).
- **AWD** `/awd/2024-05-09` — Amazon Warehousing & Distribution (armazenagem bulk).
- **Replenishment** `/replenishment/2022-11-07` — métricas do Subscribe & Save.
- **Supply Sources** `/supplySources/2020-07-01` — locais de origem (omnichannel/MCF).
- **Easy Ship** `/easyShip/2022-03-23` — programa regional (Índia etc.).
- **Uploads** `/uploads/2020-11-01` — destino pré-assinado pra anexos.
- **Application Management** `/applications/2023-11-30` — rotacionar client secret.
- **App Integrations** `/appIntegrations/2024-04-01` — notificações in-app no Seller Central.
- **Seller Wallet**, **Customer Feedback** `/customerFeedback/2024-06-01`, **Vehicles** `/catalog/vehicles/2024-11-01`.
- **Vendor APIs (1P)** `/vendor/...` — só pra vendors (first-party), não pra seller 3P.

---

# Mercado Livre / Mercado Libre API (site Brasil = `MLB`)

> Acesso: endpoints privados exigem `Authorization: Bearer $ACCESS_TOKEN`. Busca pública
> (`/sites/MLB/search`) e ler itens de **outro** vendedor retornam **403** pra apps não
> certificados. **Refresh token é rotativo** — cada refresh invalida o anterior; persistir
> o novo na hora.

## Autenticação / OAuth
| Método + Path | Faz |
|---|---|
| `GET auth.mercadolivre.com.br/authorization?response_type=code&client_id=…&redirect_uri=…` | Tela de login; volta com um `code`. |
| `POST /oauth/token` (`grant_type=authorization_code`) | Troca o `code` por `access_token` + `refresh_token`. |
| `POST /oauth/token` (`grant_type=refresh_token`) | Renova o token (retorna **novo** refresh — salvar imediatamente). |

## Sites & Categorias
| Método + Path | Faz |
|---|---|
| `GET /sites` / `GET /sites/{site_id}` | Lista marketplaces / detalhe (moeda, exposições). |
| `GET /sites/{site_id}/categories` | Árvore de categorias do site. |
| `GET /categories/{category_id}` (+ `/attributes`) | Detalhe da categoria e atributos válidos/obrigatórios. |
| `GET /sites/{site_id}/domain_discovery/search?q={title}` | **Preditor de categoria** a partir do título. |
| `GET /sites/{site_id}/listing_prices?price={p}` | Tarifa de exposição + comissão de venda pra um preço. **(usado)** |
| `GET /sites/{site_id}/listing_types` | Tipos de anúncio (ex.: `gold_special`, `gold_pro`). |

## Items / Anúncios
| Método + Path | Faz |
|---|---|
| `POST /items` | Publica anúncio (título, categoria, preço, estoque, atributos, fotos, variações). |
| `GET /items/{id}` | Detalhe do anúncio. **(usado)** |
| `GET /items?ids={id1,id2,…}` | Multiget (~20 itens numa chamada — bem mais barato). |
| `PUT /items/{id}` | Atualiza (preço, estoque, status, atributos). Ao mexer em variações, reenviar os IDs de todas que quer manter. |
| `GET /items/{id}/sale_price?context=channel_marketplace` | **Preço promocional real** (o campo `price` não reflete promo ativa). **(usado)** |
| `POST/PUT/GET /items/{id}/description` | Cria/substitui/lê a descrição (POST sobre existente dá erro — usar PUT). |
| `POST /pictures` → `POST /items/{id}/pictures` | Sobe imagem ao repositório e associa ao item (até 10). |

## Search
| Método + Path | Faz |
|---|---|
| `GET /users/{user_id}/items/search` | IDs dos anúncios do **próprio** vendedor (`status`, `limit`/`offset`, `search_type=scan`). **(usado)** |
| `GET /sites/{site_id}/search?q={query}` | Busca pública. ⚠️ **403** pra apps não certificados. |
| `GET /products/search?q={query}&site_id=MLB` | Busca de **produtos de catálogo**. |

## Orders
| Método + Path | Faz |
|---|---|
| `GET /orders/search?seller={id}&order.date_created.from=…&order.date_created.to=…&sort=date_desc` | Feed de pedidos do vendedor (paginação por `offset`). Base do faturamento. **(usado)** |
| `GET /orders/{id}` | Detalhe: comprador, `order_items[]` (com `sale_fee` por unidade), pagamentos, status. |
| `GET /orders/{id}/feedback` | Feedback do pedido. |

> **Regra de faturamento (validada):** faturamento ML = vendas **aprovadas + canceladas**
> (`paid_amount` dos itens, **sem** frete do comprador). Painel em `America/Sao_Paulo`;
> "últimos N dias" é por dia de calendário, não janela móvel de 24h.

## Shipments (Mercado Envios)
| Método + Path | Faz |
|---|---|
| `GET /shipments/{id}` | Detalhe: status, rastreio, tipo logístico, endereços. |
| `GET /shipments/{id}/costs` | **Custo real de frete** — `senders[].cost` = frete do vendedor, `receiver.cost` = frete do comprador. **(usado)** |
| `GET /shipment_labels?shipment_ids={ids}&response_type=pdf` | Baixa etiquetas (pdf/zpl). |
| `GET /users/{user_id}/shipping_options/free?…` | Custo estimado de oferecer frete grátis. **(usado)** |

## Users & Me
| Método + Path | Faz |
|---|---|
| `GET /users/me` | Perfil do próprio token (id, nickname, site, reputação). **(usado)** |
| `GET /users/{id}` | Perfil público de qualquer usuário. |
| `GET /users/{id}/addresses` | Endereços cadastrados. |

## Questions & Answers
| Método + Path | Faz |
|---|---|
| `GET /questions/search?item_id={id}&api_version=4` | Perguntas de um item. |
| `GET /my/received_questions/search` | Perguntas recebidas pelo vendedor. |
| `POST /answers` (`question_id`, `text`) | Responde uma pergunta. |

## Messages (pós-venda)
| Método + Path | Faz |
|---|---|
| `GET /messages/packs/{pack_id}/sellers/{seller_id}?tag=post_sale` | Thread da conversa do pedido. |
| `POST /messages/packs/{pack_id}/sellers/{seller_id}` | Envia mensagem ao comprador. |

## Feedback / Reviews
| Método + Path | Faz |
|---|---|
| `POST /orders/{id}/feedback` | Envia feedback do pedido (rating positivo/neutro/negativo). |
| `GET /reviews/item/{item_id}` | Avaliações do produto (média + individuais). |

## Metrics / Visits
| Método + Path | Faz |
|---|---|
| `GET /visits/items?ids={ids}` | Visitas históricas de um ou mais itens. |
| `GET /items/{id}/visits/time_window?last={n}&unit=day` | Visitas por janela móvel. |
| `GET /users/{user_id}/items_visits?date_from=…&date_to=…` | Visitas agregadas de todos os itens do usuário. |

## Billing / Invoices (faturamento)
| Método + Path | Faz |
|---|---|
| `GET /billing/integration/monthly/periods?group={ML\|MP}` | Últimos ~12 períodos de cobrança. |
| `GET /billing/integration/periods/key/{KEY}/group/{ML\|MP}/details` | Detalhe de cobranças/bônus/frete do período (paginar por `from_id`). |
| `GET /billing/integration/periods/key/{KEY}/group/{ML\|MP}/documents` | Notas e créditos emitidos no período. |

## Notifications / Webhooks
| Configuração | Faz |
|---|---|
| Callback URL + tópicos (em *My Applications*) | ML faz **POST** com só `resource`, `topic`, `user_id`, `application_id` — você **re-busca** o recurso. Responder `200` rápido, processar async. |
| `GET /myfeeds?app_id={id}` | Recupera notificações perdidas (se o endpoint caiu). |

**Tópicos:** `orders_v2`, `items`, `items_prices`, `stock-locations`, `questions`,
`marketplace_questions`, `messages`, `shipments`, `payments`, `orders_feedback`,
`marketplace_items`, `price_suggestion`, `catalog_item_competition_status`, `promotions`.

## Mercado Pago (pagamentos — base `api.mercadopago.com`)
| Método + Path | Faz |
|---|---|
| `POST /v1/payments` | Cria pagamento (Checkout API). |
| `GET /v1/payments/{id}` | Status/detalhe de um pagamento. |
| `GET /v1/payments/search` | Busca pagamentos (external_reference, status, data). |
| `POST /v1/payments/{id}/refunds` | Estorno (parcial se `amount`, total se omitido). |
| `GET /v1/chargebacks/{id}` | Dados de chargeback (pagamento contestado). |

## Promotions / Deals · Catalog
| Método + Path | Faz |
|---|---|
| `GET /seller-promotions/users/{user_id}?app_version=v2` | Promoções/campanhas disponíveis ao vendedor. |
| `POST /seller-promotions/items/{item_id}?app_version=v2` | Coloca um item em promoção a um preço. |
| `GET /products/{product_id}` (+ `/items`) | Produto de catálogo e os anúncios que competem nele (buy box). |
| `GET /highlights/{site_id}/category/{category_id}` | Ranking de **mais vendidos** de uma categoria. |
| `GET /trends/{site_id}` | Buscas em alta no site. |

---

## Fontes (oficiais)
**Amazon SP-API**
- Repositório oficial de modelos (lista autoritativa de grupos + OpenAPI): https://github.com/amzn/selling-partner-api-models/tree/main/models
- Portal de documentação: https://developer-docs.amazon.com/sp-api/

**Mercado Livre**
- Índice de APIs: https://developers.mercadolibre.com/api-docs/ · https://global-selling.mercadolibre.com/devsite/api-docs
- Auth: https://developers.mercadolivre.com.br/en_us/authentication-and-authorization
- Notificações: https://developers.mercadolivre.com.br/en_us/services-authenticate-authorization/products-receive-notifications
- Mercado Pago: https://www.mercadopago.com.br/developers/en/reference

**Nota de precisão:** os grupos e versões da SP-API foram conferidos no repositório
oficial de modelos. Para o ML, o portal oficial bloqueia leitura automatizada (403), então
os paths vieram de snippets da doc + a doc interna já validada contra a API viva
(`api-mercado-livre.md`); alguns endpoints de promoções/catálogo têm variações por site —
confirme na doc oficial ao implementar.
