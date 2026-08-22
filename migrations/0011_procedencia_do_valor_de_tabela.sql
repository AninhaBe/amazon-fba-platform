-- `ordered_gross_source`: de onde veio o valor de tabela do pedido.
--
-- A migration 0010 criou `ordered_gross` capturando do relatorio ALL_ORDERS
-- enquanto o pedido ainda tem valor. Isso resolve dali para frente e nao resolve
-- o pedido que ja foi cancelado: a Amazon zera valor E quantidade, e as cinco
-- fontes testadas em 22/08/2026 (getOrders, getOrderItems, orderMetrics,
-- relatorio ALL_ORDERS, financialEvents) devolvem nada.
--
-- O que NAO some do relatorio, mesmo depois do cancelamento: `sku`, `asin`,
-- `product-name` e `purchase-date`. Com o SKU e a data da o para valorizar o
-- pedido pelo preco de tabela que aquele SKU praticava naquele dia -- preco que
-- esta no nosso proprio banco, vindo dos pedidos reais do mesmo SKU.
--
-- ⚠️ Isso e ESTIMATIVA, e o AGENTS.md proibe extrapolar em silencio. Por isso a
-- coluna existe: valor estimado tem que ser distinguivel de valor medido em
-- todo lugar -- na tela, na consulta e em qualquer soma futura. Sem ela, o
-- estimado viraria fato na primeira pessoa que consultasse a tabela sem saber.
--
--   'relatorio' = veio do item-price do ALL_ORDERS. E o valor.
--   'estimado'  = preco de tabela do SKU na data x quantidade presumida.
--   NULL        = sem valor de tabela (ordered_gross tambem e NULL).
--
-- ⚠️ Limite conhecido da estimativa: a quantidade tambem e zerada pela Amazon,
-- entao ela presume 1 unidade. Medido na conta real: 2 cancelados estimados em
-- R$ 44,22, enquanto o Seller Central implica R$ 66,33 -- ou seja, um deles
-- tinha 2 unidades. A estimativa erra para BAIXO nesses casos, nunca para cima,
-- porque 1 e o minimo possivel de um pedido que existiu.
--
-- Nada disso entra em faturamento. Cancelado nao e receita; o numero existe para
-- responder "quanto deixei de vender", que e outra pergunta.
--
-- Relacionado: migrations/0010, docs/api-amazon-sp-api.md (Changelog 2026-08-22),
-- AGENTS.md ("Como este projeto trata dado incerto").

ALTER TABLE workspace_channel_orders
  ADD COLUMN IF NOT EXISTS ordered_gross_source TEXT;

ALTER TABLE workspace_channel_orders
  DROP CONSTRAINT IF EXISTS workspace_channel_orders_ordered_gross_source_check;

ALTER TABLE workspace_channel_orders
  ADD CONSTRAINT workspace_channel_orders_ordered_gross_source_check
  CHECK (ordered_gross_source IS NULL OR ordered_gross_source IN ('relatorio', 'estimado'));

COMMENT ON COLUMN workspace_channel_orders.ordered_gross_source IS
  'Procedencia de ordered_gross: relatorio = medido no item-price; estimado = preco de tabela do SKU na data (quantidade presumida 1). NULL = sem valor.';
