-- `ordered_gross`: o valor de tabela do pedido, capturado enquanto a Amazon
-- ainda informa — para que o cancelamento não apague a venda que existiu.
--
-- O problema, medido em 22/08/2026 nas quatro fontes da SP-API:
--
--   fonte                                  pedido cancelado devolve
--   -------------------------------------  ------------------------
--   getOrders                              sem OrderTotal
--   getOrderItems                          QuantityOrdered: 0, sem ItemPrice
--   sales/v1/orderMetrics                  a linha do dia nem existe
--   relatorio ALL_ORDERS_DATA_BY_ORDER_DATE  quantity 0, item-price vazio
--
-- A Amazon **zera** o pedido cancelado. Não é omissão parcial: some tudo,
-- inclusive a quantidade. O Seller Central sabe o valor e mostra (R$ 516,27
-- contra R$ 449,94 da API — os R$ 66,33 de diferença são 2 cancelados).
--
-- A saída não é procurar outro endpoint, é capturar antes. O relatório
-- ALL_ORDERS **precifica pedido pendente** (medido: R$ 72,12 em 3 pendentes que
-- o getOrders devolvia sem valor nenhum) e só zera depois do cancelamento.
-- Ingerindo o relatório de forma recorrente, o valor fica gravado enquanto
-- existe e sobrevive ao cancelamento.
--
-- ⚠️ Por que coluna nova e não reaproveitar `gross`:
--
--   gross          = o que o comprador PAGOU (OrderTotal, líquido de cupom)
--   ordered_gross  = preço de TABELA (item-price do relatório, antes do cupom)
--
-- Medido no mesmo dia: os dois divergem em R$ 16,83 nos 14 pedidos enviados —
-- exatamente o cupom resgatado que o PromotionDiscount já tinha apontado por
-- outro caminho. Gravar um no campo do outro corrompe faturamento e margem, e
-- é a mesma pegadinha da Pricing API registrada em 2026-08-12.
--
-- Nulo continua sendo "não sei" (AGENTS.md): pedido cancelado antes da primeira
-- captura fica null e a tela diz "valor não informado", nunca zero.
--
-- Relacionado: ADR-020 (definição de faturamento), docs/api-amazon-sp-api.md
-- ("Changelog observado", 2026-08-22), migrations/0008.

ALTER TABLE workspace_channel_orders
  ADD COLUMN IF NOT EXISTS ordered_gross NUMERIC(14,2);

COMMENT ON COLUMN workspace_channel_orders.ordered_gross IS
  'Valor de tabela do pedido (antes de cupom), capturado do relatorio ALL_ORDERS enquanto a origem ainda informa. Sobrevive ao cancelamento, que zera o pedido na API. NULL = desconhecido, nunca zero.';

-- Marca da última ingestão do relatório. O createReport da SP-API tem limite de
-- ~1 requisição por minuto e o relatório leva minutos para ficar pronto — então
-- ele NÃO cabe no ciclo de 2 minutos do agendador. Esta coluna é o que espaça a
-- ingestão, no mesmo padrão de `products_synced_at`.
ALTER TABLE workspace_marketplace_syncs
  ADD COLUMN IF NOT EXISTS orders_report_at TIMESTAMPTZ;
