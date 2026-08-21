-- `gross` passa a aceitar NULL: valor desconhecido deixa de ser gravado como zero.
--
-- O AGENTS.md estabelece que `null` ≠ `0` — zero é o fato "não houve receita",
-- null é "ainda não sei". A coluna nasceu `NOT NULL`, então o esquema **obrigava
-- a mentir**: todo pedido sem valor conhecido entrava como 0,00.
--
-- Onde isso morde, medido em 21/08/2026: a Amazon **omite `OrderTotal` enquanto o
-- pedido está `Pending`** (documentado em docs/api-amazon-sp-api.md, observado em
-- 08/08). São 64 pedidos pendentes gravados com 0,00, nenhum deles com linhas de
-- item — ou seja, sem nenhuma fonte de valor. Somados ao faturamento, entram como
-- zero e a tela mostra pedido sem dinheiro; excluídos, a venda some. Os dois
-- comportamentos são errados, e a causa é a mesma: não existe como dizer "não sei".
--
-- ⚠️ `Pending` no FBA NÃO significa "não pagou" — o pedido sai de `Pending` na
-- expedição, não na aprovação do cartão. Então esses pedidos são vendas reais cujo
-- valor a Amazon ainda não expôs.
--
-- Não altera nenhuma linha existente: `DROP NOT NULL` só amplia o domínio. A cura
-- dos 64 zeros é passo separado e explícito.
--
-- Relacionado: AGENTS.md ("Como este projeto trata dado incerto"), ADR-020
-- (definição de faturamento), docs/api-amazon-sp-api.md.

ALTER TABLE workspace_channel_orders
  ALTER COLUMN gross DROP NOT NULL;
