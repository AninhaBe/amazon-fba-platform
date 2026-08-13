// Compatibilidade deliberadamente fail-closed. Este caminho nunca conecta ao banco.
console.error("BLOCKED: scripts/migrate.mjs não aplica migrations. Use npm run migrate:plan e siga docs/migrations.md.");
process.exitCode = 2;
