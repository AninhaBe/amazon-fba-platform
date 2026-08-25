-- Métricas diárias de anúncio, por campanha.
--
-- POR QUE TABELA PRÓPRIA, E NÃO O MODELO CANÔNICO (ADR-001)
--
-- Publicidade não é canal de venda: não tem pedido, não tem item, não tem
-- comprador. Enfiar em `workspace_channel_orders` criaria um `provider` fantasma
-- que sync, overview e dashboard teriam de aprender a ignorar em todo lugar — o
-- mesmo motivo pelo qual o token do Ads já não mora em `workspace_integrations`.
--
-- POR QUE PRECISA SER PERSISTIDA
--
-- O relatório da Amazon Ads é ASSÍNCRONO. Medido em 25/08/2026: o primeiro
-- relatório levou mais de 30 minutos entre `PENDING` e `COMPLETED`. Nenhuma tela
-- pode esperar por isso — o sync cria, guarda o `report_id`, e um ciclo posterior
-- busca e grava aqui. A tela lê daqui, sempre.
--
-- AGNÓSTICA DE CANAL DESDE O PRIMEIRO DIA
--
-- Mercado Livre (Product Ads), TikTok (GMV Max) e Shopee (AdsManager) também têm
-- API de anúncio — pesquisado em 25/08/2026. A coluna `provider` existe para que
-- o segundo canal seja um INSERT, não uma tabela nova. Foi a lição de 24/08,
-- quando equalizei cobertura de estoque em dois canais e esqueci dos outros dois.
CREATE TABLE IF NOT EXISTS workspace_ad_metrics (
  workspace_id   uuid        NOT NULL,
  provider       text        NOT NULL,
  connection_id  text        NOT NULL,
  -- Dia no fuso do anunciante (Brasília para BR). A Amazon reporta por dia do
  -- perfil, não em UTC — guardar como date evita a conversão que fez a data de
  -- liberação do ML aparecer um dia atrás (corrigido em 24/08 no `brDate`).
  day            date        NOT NULL,
  campaign_id    text        NOT NULL,
  campaign_name  text,
  impressions    integer     NOT NULL DEFAULT 0,
  clicks         integer     NOT NULL DEFAULT 0,
  -- Dinheiro em numeric, nunca float: cost e sales entram em cascata de lucro.
  cost           numeric(12,2) NOT NULL DEFAULT 0,
  -- Vendas e compras ATRIBUÍDAS ao anúncio, na janela de atribuição do canal
  -- (30 dias na Amazon). NÃO é o faturamento do dia — é o que o anúncio gerou.
  -- Confundir os dois inverteria o ACOS.
  purchases      integer     NOT NULL DEFAULT 0,
  sales          numeric(12,2) NOT NULL DEFAULT 0,
  currency       text        NOT NULL DEFAULT 'BRL',
  synced_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider, connection_id, day, campaign_id)
);

-- A tela pede sempre "os últimos N dias deste workspace neste canal".
CREATE INDEX IF NOT EXISTS workspace_ad_metrics_periodo
  ON workspace_ad_metrics (workspace_id, provider, day DESC);

-- Relatórios pedidos e ainda não colhidos.
--
-- Sem isto, cada ciclo do cron criaria um relatório novo e nunca buscaria o
-- anterior — exatamente o defeito que travou a fila financeira do TikTok por 85
-- rodadas em agosto.
CREATE TABLE IF NOT EXISTS workspace_ad_reports (
  workspace_id   uuid        NOT NULL,
  provider       text        NOT NULL,
  connection_id  text        NOT NULL,
  report_id      text        NOT NULL,
  start_date     date        NOT NULL,
  end_date       date        NOT NULL,
  -- pending | completed | failed
  status         text        NOT NULL DEFAULT 'pending',
  -- Motivo da falha, quando houver. `null` não é sucesso: é "ainda não falhou".
  last_error     text,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider, connection_id, report_id)
);

CREATE INDEX IF NOT EXISTS workspace_ad_reports_pendentes
  ON workspace_ad_reports (workspace_id, provider, status, requested_at)
  WHERE status = 'pending';
