# TikTok Shop — contrato modular de leitura V1

Todas as rotas exigem sessão autenticada e `connection_id=tiktok_shop:<shop_id>`.
Erros seguros: `400` (`CONNECTION_ID_REQUIRED`, `INVALID_CONNECTION_ID`, filtros,
período ou paginação inválidos), `404` (`CONNECTION_NOT_FOUND`) e `409`
(`OWNERSHIP_CONFLICT`). Paginação usa `limit` (1–100, padrão 50) e `offset`.

Períodos usam `from=YYYY-MM-DD&to=YYYY-MM-DD`, inclusive, máximo 365 dias.

| Módulo | Endpoint | Resposta específica |
|---|---|---|
| Dashboard | `GET /api/integrations/tiktok/overview` | Compatível com V2 atual; acrescenta `orders`, `units`, `ticket`, `dailySeries[{date,revenue,orders,units}]`, `statusBreakdown[{status,orders}]`, `topProducts[{productId,sku,title,revenue,units}]`. |
| Monitor | `GET /api/integrations/tiktok/monitor` | `q`, `status`, `order_id` exato, `sku` exato; `items[{orderId,status,providerStatus,occurredAt,closedAt,currency,gross,buyerShipping,fulfillment,packageId,financialStatus,items[]}]`. Com `order_id`, também devolve `detail`. Zero PII. |
| Financeiro | `GET /api/integrations/tiktok/finance` | `status=complete,partial,pending`; `items` por pedido e `coverage` Coverage V2 (`requestedPeriod` e `historicalBacklog`). Não expõe ledger nem estimativas. |
| Catálogo | `GET /api/integrations/tiktok/catalog` | `q`, `status`; `items[{productId,variationId,sku,title,status,providerStatus,price,currency,availableQty,updatedAt}]`. Read-only. |
| Estoque | `GET /api/integrations/tiktok/inventory` | filtros `out`, `low`, `no_sales`; catálogo acrescido de `unitsSold`, `averagePerDay`, `daysRemaining`. `daysRemaining=null` sem estoque conhecido ou denominador de venda. |
| Custos | `GET/POST /api/integrations/tiktok/costs` | GET devolve somente custos da conexão. POST `{productId,sku?,title?,cost}`; o backend constrói o id canônico, sem ASIN. |
| Curva ABC | `GET /api/integrations/tiktok/abc` | ranking determinístico por receita, `coverage`, e `profitSubset`. `profit=null`/`profitAvailable=false` enquanto lucro por SKU não for derivável com segurança. |

Respostas paginadas contêm `page:{limit,offset,total,hasMore}`. Leituras sem banco
ou sem materialização retornam `availability:"NOT_AVAILABLE"`, nunca números
fabricados. `null` mantém o significado de dado desconhecido; zero é fato.
