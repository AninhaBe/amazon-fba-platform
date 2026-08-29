-- ADR-033: estoque desconhecido é `null`, não `0`.
--
-- POR QUÊ (medido em 29/08/2026, conta real): `available_qty` era
-- `integer NOT NULL`, então a coluna NÃO CONSEGUIA dizer "não sei". Três estados
-- diferentes chegavam a toda leitura como o mesmo zero, e só o primeiro é fato:
--
--   · a fonte devolveu o anúncio e informou 0      -> FATO
--   · a fonte não devolveu o anúncio na varredura  -> ignorância escrita como 0
--   · nunca sincronizamos este produto             -> nem linha existe
--
-- Tamanho do segundo caso: 435 dos 747 anúncios da Shopee (58% do catálogo) e
-- 30 dos 33 zeros do TikTok (91%). O Mercado Livre não fabrica nenhum — os 313
-- zeros dele têm quantidade realmente informada.
--
-- Consequência já observada: o sinal de ruptura do briefing ia anunciar cinco
-- produtos como "estoque ZERO"; TRÊS eram zero fabricado. E `mercadoLivreFullStock`
-- filtra `availableQty > 0`, então o item SOME da lista de capital parado sem
-- deixar rastro — erro que aparece a gente conserta, erro que some ninguém procura.
--
-- ⚠️ SÓ AFROUXA A RESTRIÇÃO. Nenhuma linha muda de valor aqui: `DROP NOT NULL`
-- não reescreve a tabela em Postgres (é só catálogo), então não há custo de
-- escrita nem risco de inflar índice — ao contrário do backfill, que é passo
-- SEPARADO e vai com contagem antes e depois.

ALTER TABLE workspace_channel_products
  ALTER COLUMN available_qty DROP NOT NULL;

-- ⚠️ O DEFAULT 0 TEM QUE CAIR JUNTO, E SOZINHO O DROP NOT NULL NAO RESOLVERIA
-- NADA. Com `DEFAULT 0`, todo INSERT que omitisse a coluna continuaria gravando
-- zero — a mentira voltaria a nascer pela porta dos fundos, no dia seguinte,
-- sem ninguem perceber. Quem escreve estoque agora precisa DIZER o valor,
-- inclusive dizer NULL; omitir deixou de ser uma forma de afirmar zero.
ALTER TABLE workspace_channel_products
  ALTER COLUMN available_qty DROP DEFAULT;

COMMENT ON COLUMN workspace_channel_products.available_qty IS
  'Quantidade disponivel informada PELA FONTE. NULL = desconhecido (a varredura nao devolveu este anuncio); 0 = a fonte disse que nao ha. Nunca escreva 0 para um item que voce nao encontrou: varredura que nao acha um item pode mudar o STATUS dele, nunca os NUMEROS dele. Ver ADR-033.';
