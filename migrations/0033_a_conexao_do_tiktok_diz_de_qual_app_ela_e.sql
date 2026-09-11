-- A conexão do TikTok passa a dizer DE QUAL APP ela é.
--
-- ⚠️ O DEFEITO QUE ISTO DESTRAVA É A ETAPA 2 DA MIGRAÇÃO PARA O APP PÚBLICO, e
-- ele foi medido no código em 11/09/2026, no dia em que o app público foi
-- publicado no Service Market e a dona do produto pediu o link de reautorização.
--
-- Hoje existem DOIS pares de credencial no ar (`tiktokApps.ts`): o custom, que
-- atende a loja conectada, e o público, aprovado agora. O app viaja dentro do
-- `state` assinado do convite e chega ao callback — que troca o `auth_code` com
-- o par certo. Até aí, correto.
--
-- 📌 MAS O APP NUNCA ERA GRAVADO. `appDaConexao()` só era usado para LER o app
-- de dentro do convite (`tiktokInvite.ts`); nenhuma coluna o guardava. Logo,
-- a partir do instante seguinte à autorização, ninguém no sistema sabia de qual
-- app aquele token era — e todo caminho que precisa da credencial caía no
-- `APP_PADRAO`, que é o CUSTOM:
--
--   getAuthorizedShops  -> tiktokFetch sem app  -> assina com a chave do custom
--   tiktokFinancialApi  -> tiktokFetch sem app  -> assina com a chave do custom
--   tiktokStore (x2)    -> refreshAccessToken sem app -> renova com o custom
--
-- Ou seja: reautorizar pelo público produziria um token do PÚBLICO que seria
-- usado com a chave do CUSTOM. É a mesma família do `undefined` em produção que
-- a Amazon já pagou (`.env` × `workspace_accounts`) — duas vias de credencial
-- onde só uma é escolhida por padrão.
--
-- É também a lição da COLUNA QUE DOIS ESCRITORES TOCAM, com o sinal trocado:
-- ali um campo tinha dois significados; aqui um significado (de qual app é este
-- token) não tinha campo nenhum, e o sistema o adivinhava.
--
-- ═══ QUEM LÊ ISSO AGORA — a pergunta obrigatória antes do apply ═══
--
-- A coluna é ADITIVA e tem DEFAULT: nada quebra no instante do apply. Nenhum
-- leitor de hoje a procura, e o leitor novo (este mesmo deploy) já sabe lê-la.
--
-- ⚠️ E NÃO HÁ VIEW NO CAMINHO — a lição de 02/09/2026 (a 0029 adicionou
-- `posted_at` numa tabela cujo leitor passava por uma view criada antes, e o
-- dashboard da Amazon caiu com 42703 por horas). Conferido em 11/09/2026:
-- nenhuma view seleciona de `workspace_tiktok_shops`; os leitores
-- (`tiktokStore.ts`, `tiktokScheduler.ts`) consultam a TABELA direto.
--
-- ⚠️ O DEFAULT É 'custom', E ISSO É UM FATO, NÃO UMA CONVENIÊNCIA. A conexão
-- viva hoje (shop 7494291387899806731) foi autorizada pelo app custom em
-- 10/08/2026. Marcá-la 'custom' é gravar a verdade dela; marcá-la 'publico'
-- seria mentir e quebrar o refresh no dia seguinte.
--
-- 📌 E É ISTO QUE TORNA A ETAPA 3 VERIFICÁVEL. Sem a coluna, "a loja migrou
-- para o público" não teria como ser PROVADO — só torcido. Com ela, aposentar o
-- custom é uma consulta: nenhuma linha com app='custom' restando.

ALTER TABLE workspace_tiktok_shops
  ADD COLUMN IF NOT EXISTS app text NOT NULL DEFAULT 'custom';

-- Valor desconhecido não entra. A lista é FECHADA de propósito: é o oposto da
-- lista negra que este projeto matou em 31/08/2026 (`fee_type NOT IN (...)`),
-- onde o desconhecido passava por padrão. Aqui o desconhecido para tudo.
ALTER TABLE workspace_tiktok_shops
  DROP CONSTRAINT IF EXISTS workspace_tiktok_shops_app_conhecido;
ALTER TABLE workspace_tiktok_shops
  ADD CONSTRAINT workspace_tiktok_shops_app_conhecido
  CHECK (app IN ('custom', 'publico'));

COMMENT ON COLUMN workspace_tiktok_shops.app IS
  'Qual dos dois apps do TikTok autorizou esta conexão: custom ou publico. '
  'Decide com QUAL par de credencial assinar chamada e renovar token — '
  'adivinhar erra em silêncio. Ver src/lib/integrations/tiktokApps.ts.';
