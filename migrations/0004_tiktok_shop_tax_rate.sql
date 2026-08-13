ALTER TABLE workspace_tiktok_shops
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'workspace_tiktok_shops'::regclass
       AND conname = 'workspace_tiktok_shops_tax_rate_check'
  ) THEN
    ALTER TABLE workspace_tiktok_shops
      ADD CONSTRAINT workspace_tiktok_shops_tax_rate_check
      CHECK (tax_rate >= 0 AND tax_rate <= 100);
  END IF;
END
$migration$;
