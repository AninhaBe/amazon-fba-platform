-- Guarda o preço de tabela e o desconto por linha, em vez de só o valor líquido.
--
-- Hoje `unit_price` é o resultado de `ItemPrice − PromotionDiscount`, e as duas
-- parcelas são jogadas fora na ingestão. Consequência prática, medida em
-- 21/08/2026: a vendedora perguntou "como vejo se usaram cupom?" e a resposta era
-- "não vê" — nem na tela, nem no banco. Para saber, foi preciso abrir pedido a
-- pedido no Seller Central e depois consultar a própria API.
--
-- O que a API entrega por item e nós descartávamos:
--   ItemPrice ......... 22,11   (preço cheio)
--   PromotionDiscount . 2,21    (cupom resgatado)
--   PromotionIds ...... PLM-2f6aebf5-…   (qual campanha)
--
-- Sem isso não dá para distinguir "vendeu barato porque deu cupom" de "vendeu
-- barato porque o preço era outro" — e as duas levam a decisões opostas de preço.
-- Também é o que permite medir a taxa de resgate: 7 de 14 pedidos nesta conta,
-- R$ 16,83 em duas semanas, contra a nota do repo que dizia "resgate R$ 0,00".
--
-- ⚠️ Todas as colunas são ANULÁVEIS por decisão, não por descuido: canal que não
-- informa desconto grava `null` (desconhecido), nunca zero — zero significaria
-- "não houve desconto", que é afirmação diferente (AGENTS.md).
--
-- `unit_price` continua sendo o líquido: é dele que sai margem e lucro, e nenhuma
-- consulta existente precisa mudar.
--
-- Relacionado: ADR-001 (modelo canônico), docs/canonical-schema.md.

ALTER TABLE workspace_channel_order_items
  ADD COLUMN IF NOT EXISTS list_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS promotion_discount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS promotion_ids TEXT;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'workspace_channel_order_items'::regclass
       AND conname = 'workspace_channel_order_items_desconto_nao_negativo'
  ) THEN
    -- Desconto negativo seria acréscimo disfarçado; preço de tabela negativo não
    -- existe. Falhar alto é melhor que propagar número impossível para a margem.
    ALTER TABLE workspace_channel_order_items
      ADD CONSTRAINT workspace_channel_order_items_desconto_nao_negativo
      CHECK (
        (list_price IS NULL OR list_price >= 0)
        AND (promotion_discount IS NULL OR promotion_discount >= 0)
      );
  END IF;
END
$migration$;
