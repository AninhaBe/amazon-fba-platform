-- R2 da frente L (ADR-026, regra 2): estado do produto sai de raw._sellercore
-- e ganha colunas próprias — raw volta a ser só "o que o canal disse", imutável
-- e descartável por retenção. Aditiva: nenhum dado é movido aqui; o backfill a
-- partir do raw roda em passo separado (cura com portão), e os leitores mantêm
-- fallback ao raw até a extinção do namespace (fase final da R2).
--
-- Semântica dos DEFAULT false: é a semântica VIGENTE — todo leitor já faz
-- COALESCE(raw #>> '...', 'false'); "ausente = ainda não liquidado / sem
-- evidência" é conclusão do produto, não dado do canal (não há null≠0 aqui).

ALTER TABLE workspace_channel_orders
  ADD COLUMN IF NOT EXISTS financial_settled        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS settlement_attempt_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_outcome       TEXT,
  ADD COLUMN IF NOT EXISTS evidence_fees            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS evidence_seller_shipping BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS evidence_ads             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS evidence_taxes_withheld  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS evidence_refunds         BOOLEAN NOT NULL DEFAULT false;
