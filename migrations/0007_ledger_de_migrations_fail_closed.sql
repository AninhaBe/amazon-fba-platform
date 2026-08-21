-- Fecha o ledger de migrations: nenhuma linha nova sem hash, e nenhum hash com
-- formato inventado.
--
-- Contexto: `public.schema_migrations` nasceu como `(name, applied_at)`. O runner
-- sempre gravou `(name, migration_hash)` — coluna que nunca existiu aqui — e por
-- isso morria em TODA execução (`inspectTarget` recusa "ledger legado sem hashes").
-- Foi um dos três muros que mantiveram o runner inutilizável desde 0003.
--
-- A coluna em si é criada pelo bootstrap (`scripts/bootstrap-ledger-hash.mjs`),
-- porque há um ovo-e-galinha real: o runner precisa introspectar o ledger para
-- montar qualquer plano, e não consegue introspectar um ledger sem a coluna.
-- ESTA migration faz o resto — e ela sim passa pelo fluxo autorizado, o que a
-- torna a primeira prova de que o runner voltou a funcionar de ponta a ponta.
--
-- Por que NOT NULL importa: sem ela, uma linha sem hash volta a entrar, e linha
-- sem hash é linha que a deteccao de drift não cobre. O ledger deixa de detectar
-- migration editada depois de aplicada exatamente onde mais importa.
--
-- Relacionado: ADR-021 (runner destravado), docs/migrations.md.

ALTER TABLE schema_migrations
  ALTER COLUMN migration_hash SET NOT NULL;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'schema_migrations'::regclass
       AND conname = 'schema_migrations_migration_hash_formato'
  ) THEN
    -- `loadMigrations` produz sempre `sha256:` + 64 hex. Qualquer outra coisa é
    -- gravação fora do runner e deve falhar alto, não virar registro plausível.
    ALTER TABLE schema_migrations
      ADD CONSTRAINT schema_migrations_migration_hash_formato
      CHECK (migration_hash ~ '^sha256:[0-9a-f]{64}$');
  END IF;
END
$migration$;
