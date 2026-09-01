-- A role que NÃO pode ignorar RLS passa a existir. Etapa 1 da ADR-036.
--
-- ⚠️ ESTA MIGRATION NÃO LIGA BARREIRA NENHUMA, E ISSO É O DESENHO. Ela cria o
-- sujeito e mais nada: não há policy, e a aplicação continua conectando como
-- `postgres`. Sem os dois passos seguintes, esta role não muda uma linha do
-- comportamento de ninguém. É de propósito — a etapa 1 existe para medir o custo
-- do transporte em produção antes de qualquer coisa filtrar.
--
-- ⚠️ POR QUE ELA NÃO PODE SER DONA DE TABELA. Dono de tabela pula RLS pelo
-- caminho nativo do Postgres, mesmo sem `BYPASSRLS`, enquanto
-- `FORCE ROW LEVEL SECURITY` estiver desligado — e ele está, nas 32 tabelas
-- (medido em 01/09/2026). Uma role de runtime que fosse dona tornaria o desenho
-- inteiro decoração. As tabelas continuam de `postgres`.
--
-- ⚠️ SEM SENHA, E ISSO TAMBÉM É O DESENHO — não é esquecimento.
--
-- Uma senha dentro de um arquivo versionado é um segredo no repositório, e o
-- `AGENTS.md` proíbe. Sem senha a role **existe e não consegue autenticar**, que
-- é exatamente o estado certo para a etapa 1: nada deve conectar como ela ainda.
-- A senha entra fora do versionamento, com `ALTER ROLE ... PASSWORD`, quando a
-- etapa 3 chegar — e aí a string de conexão vira o interruptor da ADR-036, que é
-- o que permite voltar atrás sem DDL.
--
-- ⚠️ E ELA NÃO ENTRA SOZINHA NO LUGAR DA `postgres`. Medido: `service_role`
-- também tem `rolbypassrls = true`. Usar qualquer uma das duas no runtime anula
-- a barreira, e isso precisa de teste, não de lembrança — o teste comportamental
-- está em `tests-integracao/barreiraDeInquilinoNoBanco.test.mjs`.

DO $$
BEGIN
  -- `CREATE ROLE` não tem `IF NOT EXISTS`; reaplicar não pode falhar.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexo_runtime') THEN
    CREATE ROLE nexo_runtime LOGIN NOBYPASSRLS;
  ELSE
    -- Reafirma o que importa mesmo se a role já existir por outro caminho:
    -- nunca com bypass, nunca com poder de criar role ou banco.
    ALTER ROLE nexo_runtime NOBYPASSRLS NOCREATEROLE NOCREATEDB NOSUPERUSER;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO nexo_runtime;

-- DML nas tabelas de produto. A escolha de conceder por tabela, e não com
-- `ON ALL TABLES`, é menor privilégio: a contabilidade de migrations
-- (`schema_migrations`, `migration_contract_versions`) é do runner operacional e
-- o runtime nunca deve escrever nela — nem por acidente, nem por uma consulta
-- gerada errado.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND c.relname NOT IN ('schema_migrations', 'migration_contract_versions')
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO nexo_runtime', t);
  END LOOP;
END
$$;

-- Tabela criada depois desta migration já nasce acessível ao runtime — senão a
-- próxima migration quebra a aplicação de um jeito que só aparece em produção.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexo_runtime;

-- Sequências: sem isto, todo INSERT em tabela com coluna serial falha.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nexo_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO nexo_runtime;

COMMENT ON ROLE nexo_runtime IS
  'Role de runtime da ADR-036: NOBYPASSRLS e NAO dona de tabela, para que RLS realmente a alcance. Sem senha ate a etapa 3 — existe e nao autentica. NUNCA usar postgres nem service_role no runtime: as duas tem rolbypassrls.';
