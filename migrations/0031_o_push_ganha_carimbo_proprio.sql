-- O push ganha carimbo próprio: `last_push_at`, separado de `last_success_at`.
--
-- ⚠️ O DEFEITO QUE ISTO DESTRAVA JÁ ESTÁ VIVO EM PRODUÇÃO, e foi medido em
-- 02/09/2026: `mercadoLivreWebhook.ts` escreve `last_success_at = now()` em dois
-- lugares (linhas 258 e 393), toda vez que processa um evento de webhook.
--
-- `last_success_at` é a coluna que o VIGIA DE DEFASAGEM lê para responder "este
-- canal parou de sincronizar?". Com o webhook escrevendo nela, o Mercado Livre
-- fica assim:
--
--   varredura PARADA + webhooks chegando  ->  last_success_at avança
--                                         ->  o vigia responde "ok"
--
-- Ou seja: no único canal que hoje tem webhook, o alarme pode ficar CEGO — e
-- justamente quando o polling, que é a rede de segurança, é o que parou. Push
-- acelera, poll garante; se o push mascara a ausência do poll, a garantia some
-- e ninguém fica sabendo.
--
-- 📌 SÃO DOIS FATOS DIFERENTES E PASSAM A TER DUAS COLUNAS:
--
--   last_success_at  a VARREDURA completou um ciclo. É o que o vigia vigia.
--   last_push_at     o canal nos EMPURROU um evento e nós o processamos.
--
-- Um não substitui o outro, e nenhum dos dois sozinho responde "estamos em dia".
--
-- ═══ QUEM LÊ ISSO AGORA — a pergunta obrigatória antes do apply ═══
--
-- A coluna é ADITIVA e NULLABLE: nada quebra no instante do apply, e nenhum
-- leitor de hoje a procura. Não há view no caminho (a lição de 02/09/2026): o
-- vigia e o webhook leem a TABELA `workspace_marketplace_syncs` direto, e
-- `grep -rn "workspace_marketplace_syncs" src/` não encontra nenhuma view sobre
-- ela. Conferido, não deduzido.
--
-- ⚠️ E A DEPENDÊNCIA DE SEQUÊNCIA, QUE É O ESPELHO DO INCIDENTE DE HOJE:
--
--   **O CÓDIGO QUE ESCREVE `last_push_at` NÃO PODE SUBIR ANTES DESTE APPLY.**
--
-- No incidente da manhã o LEITOR exigia uma coluna que a view não tinha. Aqui
-- seria o ESCRITOR exigindo coluna que a tabela não tem — mesmo 42703, mesmo
-- silêncio, e desta vez derrubando o processamento de webhook do ML e o push da
-- Shopee. Por isso a leva que contém o escritor só sobe **depois do apply
-- confirmado**, e é por isso que esta migration entra na mesma janela da 0030.
--
-- Ordem da janela: `0030` (conserta a view da Amazon, urgente) e `0031` (esta),
-- num comando só; deploy da leva **depois**.
ALTER TABLE workspace_marketplace_syncs
  ADD COLUMN IF NOT EXISTS last_push_at TIMESTAMPTZ;

COMMENT ON COLUMN workspace_marketplace_syncs.last_push_at IS
  'Ultimo evento de PUSH/webhook processado para esta conexao. NAO confundir com '
  'last_success_at, que e da VARREDURA: o vigia de defasagem le aquele, e push '
  'gravando nele faria varredura parada parecer saudavel. NULL = nenhum push '
  'recebido — nunca "nao ha push".';

-- Índice só sobre o que existe: a maioria das conexões nunca terá push (a Amazon
-- não tem, a Shopee só depois do cadastro no console).
CREATE INDEX IF NOT EXISTS workspace_marketplace_syncs_last_push_at_idx
  ON workspace_marketplace_syncs (provider, connection_id, last_push_at)
  WHERE last_push_at IS NOT NULL;
