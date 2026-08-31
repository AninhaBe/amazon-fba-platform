-- `unit_price` passa a aceitar NULL: preço desconhecido deixa de ser impossível
-- de representar — e, com isso, deixa de virar zero.
--
-- ⚠️ É A MESMA CORREÇÃO DA MIGRATION 0008, NO NÍVEL DA LINHA. Lá `gross` (o total
-- do pedido) ganhou NULL porque a Amazon omite `OrderTotal` enquanto o pedido está
-- `Pending`. O item tem exatamente o mesmo comportamento, e o esquema ainda
-- obrigava a mentir: `unit_price NUMERIC(14,2) NOT NULL`.
--
-- MEDIDO EM 31/08/2026, com uma chamada real a `getOrderItems` num pedido
-- `Pending` da conta AO62LVXJMX3AA (pedido 702-7217003-1775439):
--
--   { "ASIN": "B0HBGLBL6Y", "SellerSKU": "kit-clips-320",
--     "QuantityOrdered": 1, "QuantityShipped": 0,
--     "Title": "Kit 320 Clips de Papel Coloridos…" }
--
-- A Orders API DEVOLVE o item — com ASIN, SKU, título e quantidade — e **não
-- devolve preço**: `ItemPrice`, `ItemTax` e `PromotionDiscount` simplesmente não
-- existem no objeto enquanto o pedido é `Pending`.
--
-- ⚠️ E O NOSSO BANCO ESTAVA VAZIO POR CULPA NOSSA, NÃO DA AMAZON.
-- `amazonSync.ts` filtrava `status IN ('paid','shipped','delivered')` ao buscar
-- itens: nunca pedimos os de um pendente. A ausência era consequência da nossa
-- consulta, e chegou a ser tratada como fato sobre a API — o mesmo mecanismo pelo
-- qual a premissa "a Amazon não tem imposto do vendedor" nasceu e sobreviveu.
--
-- O QUE ISTO DESTRAVA, e é o pedido dela de 31/08 às 9h ("já teve as vendas e não
-- está jogando nada pra parte de cima"): com SKU e quantidade do pendente, o
-- **custo dos produtos** passa a ser calculável no minuto do pedido — hoje ele
-- fica em travessão junto com todo o resto. Receita e tarifa continuam
-- desconhecidas até a Amazon expor; é a ADR-027 que trata delas.
--
-- ⚠️ POR QUE NULL E NÃO ZERO: `AGENTS.md` — zero é o fato "não custou nada", null
-- é "ainda não sei". Gravar 0,00 faria a receita do pedido desaparecer somando, e
-- a linha de item mentiria sobre um preço que a fonte não informou. É o mesmo
-- defeito que esta semana produziu tarifa R$ 0,00 com 63 vendas.
--
-- Não altera nenhuma linha existente: `DROP NOT NULL` só amplia o domínio.
-- Nenhum item hoje tem preço desconhecido, porque nenhum pendente foi ingerido.
--
-- ⚠️ QUEM LÊ PRECISA TRATAR O NULL. As leituras que somam `qty * unit_price`
-- (receita por linha, rateio de tarifa, top de produtos) devem EXCLUIR a linha
-- sem preço em vez de coalescer para zero — coalescer aqui recria exatamente a
-- mentira que esta migration remove.
ALTER TABLE workspace_channel_order_items
  ALTER COLUMN unit_price DROP NOT NULL;

COMMENT ON COLUMN workspace_channel_order_items.unit_price IS
  'Preco unitario praticado. NULL = a fonte ainda nao expos (pedido Pending na Amazon devolve item sem ItemPrice). NUNCA gravar 0 para desconhecido: zero e o fato "nao custou nada".';
