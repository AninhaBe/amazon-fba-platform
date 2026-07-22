-- A paginação da SP-API usa NextToken (string opaca), diferente do offset
-- numérico do Mercado Livre. O token vive junto do cursor do sync.
ALTER TABLE workspace_marketplace_syncs ADD COLUMN IF NOT EXISTS cursor_token TEXT;
