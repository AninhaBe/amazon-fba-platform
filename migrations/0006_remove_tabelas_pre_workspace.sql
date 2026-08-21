-- Remove as quatro tabelas anteriores ao modelo multiusuário.
--
-- Cada uma foi substituída por uma versão com escopo de workspace, e NENHUMA é
-- referenciada pelo código (auditado em 21/08/2026: zero ocorrências de
-- FROM/INTO/UPDATE/JOIN sobre elas em `src/` e `scripts/`), por nenhuma view e
-- por nenhuma chave estrangeira.
--
--   accounts       (2 linhas)  ->  workspace_accounts
--   integrations   (0 linhas)  ->  workspace_integrations
--   tiktok_shops   (0 linhas)  ->  workspace_tiktok_shops
--   product_costs  (7 linhas)  ->  workspace_product_costs
--
-- ⚠️ A `product_costs` era a mais perigosa das quatro justamente por ter dado:
-- guardava custos DIVERGENTES da tabela viva (CADARÇO-BRANCO a R$ 2,42 contra
-- R$ 5,00 na nova; PORTA-COMPRIMIDOS a R$ 100,00, que não existe mais). Tabela
-- morta com dado plausível é pior que tabela vazia — quem consulta acredita.
--
-- Conteúdo das quatro exportado para JSON antes da remoção. Nada aqui é
-- recuperável pelo banco depois: o plano Free do Supabase não tem PITR.
--
-- Relacionado: ADR-001 (modelo canônico), ADR-016 (ciclo de vida do dado).

DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS integrations;
DROP TABLE IF EXISTS tiktok_shops;
DROP TABLE IF EXISTS product_costs;
