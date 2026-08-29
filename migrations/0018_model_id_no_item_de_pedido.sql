-- ADR-029, passo 1 do lote atômico: a identidade da VARIAÇÃO passa a viajar por
-- um identificador estável, não pelo texto do SKU.
--
-- POR QUÊ (medido em 28/08/2026, loja UTILEIRA): o catálogo grava uma linha por
-- ANÚNCIO com o `item_sku` (vazio em 286 de 372), enquanto o pedido grava o
-- `model_sku` da variação. Resultado: 71 dos 76 SKUs que vendem não existem no
-- catálogo, e o custo — que é chaveado por SKU — não tem onde se prender.
--
-- `model_id` é a chave ESTÁVEL: o vendedor pode renomear um `model_sku`, e no
-- dia em que fizer isso o histórico amarrado por texto se parte em silêncio.
--
-- ⚠️ ORDEM IMPORTA, e ela é a lição da madrugada aplicada ANTES do estrago:
-- o `fillfactor` vem PRIMEIRO, antes de qualquer escrita em massa. A tabela
-- está hoje com fillfactor padrão (100) e 21 MB de índices — foi essa receita
-- que inflou 37 MB no backfill da R2 (ADR-022).
--
-- ⚠️ SEM ÍNDICE em `model_id`, de propósito: índice na coluna tornaria cada
-- escrita do backfill não-elegível a HOT, que é exatamente o que o fillfactor
-- acima está tentando evitar. A coluna não entra em nenhuma cláusula de busca —
-- ela viaja junto da linha, cuja identidade continua sendo `line_no`.
--
-- Impacto em particionamento e índices da ADR-022: NENHUM. `model_id` não entra
-- na PK.

ALTER TABLE workspace_channel_order_items SET (fillfactor = 90);

ALTER TABLE workspace_channel_order_items ADD COLUMN IF NOT EXISTS model_id text;

COMMENT ON COLUMN workspace_channel_order_items.model_id IS
  'Identificador da VARIACAO no canal (model_id na Shopee, sku.id no TikTok). NULL quando o canal nao tem variacao ou quando o pedido antigo nao trouxe o dado. Nunca indexar: manteria as escritas fora do HOT. Ver ADR-029.';
