-- Modelo canônico multicanal (docs/canonical-schema.md).
-- Criado por migração versionada (npm run migrate), fora do caminho das
-- requisições — o ensureSchema do app não conhece estas tabelas.

CREATE TABLE IF NOT EXISTS workspace_channel_orders (
  workspace_id      TEXT NOT NULL,
  provider          TEXT NOT NULL,
  connection_id     TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  status            TEXT NOT NULL,
  provider_status   TEXT NOT NULL,
  occurred_at       TIMESTAMPTZ NOT NULL,
  closed_at         TIMESTAMPTZ,
  currency          TEXT NOT NULL,
  gross             NUMERIC(14,2) NOT NULL,
  buyer_shipping    NUMERIC(14,2),
  fulfillment       TEXT,
  pack_id           TEXT,
  -- Nulo durante a transição do Mercado Livre: o payload bruto continua em
  -- workspace_marketplace_orders. Canais sem tabela legada gravam aqui.
  raw               JSONB,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider, connection_id, external_order_id)
);

CREATE TABLE IF NOT EXISTS workspace_channel_order_items (
  workspace_id      TEXT NOT NULL,
  provider          TEXT NOT NULL,
  connection_id     TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  line_no           SMALLINT NOT NULL,
  external_product_id TEXT NOT NULL,
  sku               TEXT,
  title             TEXT NOT NULL,
  qty               INTEGER NOT NULL,
  unit_price        NUMERIC(14,2) NOT NULL,
  PRIMARY KEY (workspace_id, provider, connection_id, external_order_id, line_no)
);

CREATE TABLE IF NOT EXISTS workspace_channel_order_fees (
  workspace_id      TEXT NOT NULL,
  provider          TEXT NOT NULL,
  connection_id     TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  fee_type          TEXT NOT NULL,
  provider_fee_code TEXT NOT NULL DEFAULT '',
  amount            NUMERIC(14,2) NOT NULL,
  currency          TEXT NOT NULL,
  -- Origem do valor no canal (ex.: id do shipment que gerou o frete).
  external_ref      TEXT,
  PRIMARY KEY (workspace_id, provider, connection_id, external_order_id, fee_type, provider_fee_code)
);

CREATE TABLE IF NOT EXISTS workspace_channel_products (
  workspace_id      TEXT NOT NULL,
  provider          TEXT NOT NULL,
  connection_id     TEXT NOT NULL,
  external_product_id TEXT NOT NULL,
  sku               TEXT,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL,
  provider_status   TEXT NOT NULL,
  price             NUMERIC(14,2) NOT NULL,
  currency          TEXT NOT NULL,
  available_qty     INTEGER NOT NULL DEFAULT 0,
  fulfillment       TEXT,
  thumbnail         TEXT,
  permalink         TEXT,
  cost_id           TEXT,
  raw               JSONB,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider, connection_id, external_product_id)
);

CREATE INDEX IF NOT EXISTS channel_orders_period_idx
  ON workspace_channel_orders (workspace_id, provider, connection_id, occurred_at DESC)
  INCLUDE (status, gross, currency);
CREATE INDEX IF NOT EXISTS channel_orders_workspace_period_idx
  ON workspace_channel_orders (workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS channel_order_items_product_idx
  ON workspace_channel_order_items (workspace_id, provider, connection_id, external_product_id);
CREATE INDEX IF NOT EXISTS channel_products_status_idx
  ON workspace_channel_products (workspace_id, provider, connection_id, status);
