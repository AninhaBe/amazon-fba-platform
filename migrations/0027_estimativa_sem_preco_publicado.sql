-- A tarifa estimada deixa de exigir preço: `unit_price` passa a aceitar NULL.
--
-- É a mesma correção que a 0021 fez em `workspace_channel_order_items`, na
-- tabela que a 0022 criou depois — e que nasceu já com o defeito que a 0021
-- tinha acabado de tirar do vizinho.
--
-- ⚠️ O DEFEITO QUE ISTO DESTRAVA, medido na Silveiras Import em 01/09/2026 com a
-- autorização da SP-API caída:
--
--   31 pedidos no dia. 30 sem `unit_price`, sem `ordered_gross` e com `gross` 0
--   — a Amazon ainda não publicou valor para eles. 13 ASINs distintos, e 12
--   deles JÁ TÊM tarifa observada no nosso próprio extrato.
--
--   A tarifa desses 30 pedidos é conhecida: a observada é ABSOLUTA (R$ X por
--   unidade, `SUM(fee)/SUM(qty)`), não um percentual do preço. Mesmo assim
--   nenhuma era gravável, porque a coluna exigia um preço que não existe.
--   Resultado medido: 0 de 30 com estimativa, contra 1 de 1 entre os que tinham
--   preço. A correlação era perfeita, e o `NOT NULL` era metade da causa.
--
-- 📌 QUEM LÊ ISTO AGORA (a pergunta obrigatória antes de qualquer apply):
--
--   1. `amazonOverviewCanonical.ts` — lê `e.unit_price::text` para derivar
--      `percentualDaCategoria`. Já trata o NULL: `Number(null)` é 0 e o
--      `preco > 0` devolve `null` em vez de um percentual inventado.
--   2. `workspace_channel_order_fees_efetivas` (view da 0022) — não projeta
--      `unit_price`. Nada muda para ela.
--   Nenhum outro leitor no repo toca esta coluna.
--
-- 📌 E ISTO NÃO PRODUZ LUCRO PARA ESSES PEDIDOS, nem deve. Sem receita não há
-- resultado, e a base já os mantém de fora pela regra "custo e tarifa só existem
-- para o pedido cuja receita existe". O que muda é que a tarifa fica gravada e
-- datada, pronta para o instante em que a Amazon publicar o valor.
ALTER TABLE workspace_channel_order_fee_estimates
  ALTER COLUMN unit_price DROP NOT NULL;

COMMENT ON COLUMN workspace_channel_order_fee_estimates.unit_price IS
  'Preço unitário no instante da estimativa, quando conhecido. NULL = a fonte '
  'ainda não publicou valor para o pedido — nunca 0, que afirmaria brinde.';
