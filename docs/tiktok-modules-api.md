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
| Saldo e retenção | `GET /api/integrations/tiktok/saldo` | **Sem período** — saldo é o estado de agora, mesma decisão da rota do ML. `retido` (transações `unsettled`, valor que o próprio TikTok estima), `aLiberar`/`liberacoes[{date,amount,pagamentos,vendas,estornos,atrasada}]` a partir de `expected_time`, e `liberado` dos últimos 30 dias. A data de liberação só existe onde a API emitiu `expected_time`: venda retida sem extrato aparece com valor e **sem data**. Teto de leitura reportado com número exato. Zero identificador na resposta. |
| Pedidos a revisar | `GET /api/integrations/tiktok/auditoria` | Frete **cobrado** (`workspace_financial_transactions.seller_shipping`, feed de statements) contra o **declarado** (fee `shipping_seller`, extrato por pedido). Os dois lados carregam uma `base` explícita e a comparação só acontece com `mesmaBase`; bases diferentes viram pendência com motivo, nunca divergência. `payment.shipping_fee` (frete do comprador) aparece como contexto e **nunca** entra na subtração — `shipping_cost_amount` já é líquido dele. `totalAContestar` é `null`, não zero, quando nada foi comparado. |
| Curva ABC | `GET /api/integrations/tiktok/abc` | ranking determinístico por receita, `coverage`, e `profitSubset`. `profit=null`/`profitAvailable=false` enquanto lucro por SKU não for derivável com segurança. |

Respostas paginadas contêm `page:{limit,offset,total,hasMore}`. Leituras sem banco
ou sem materialização retornam `availability:"NOT_AVAILABLE"`, nunca números
fabricados. `null` mantém o significado de dado desconhecido; zero é fato.
