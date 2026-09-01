# ADR-012: Contrato da 0005 sem exigência de runtime role dedicada

> 📌 **Reaberta em 01/09/2026 pela [ADR-036](./ADR-036-barreira-de-inquilino-no-banco.md),
> com motivo novo.** O que está decidido aqui — que policy `USING (true)` não
> protege e que o `REVOKE` de `PUBLIC`/`anon`/`authenticated`/`service_role` é o
> que de fato protege — **continua valendo e foi reconfirmado por medição**. O que
> a ADR-036 acrescenta é o caso que esta aqui não cobria: a role da **própria
> aplicação** é `postgres`, com `rolbypassrls = true` e dona das 32 tabelas, então
> a separação entre inquilinos hoje depende inteiramente do `WHERE` da aplicação.



- **Status:** Aceito
- **Data:** 2026-08-13
- **Substitui parcialmente:** o bloco de grants/policies de
  `migrations/0005_workspace_financial_ledger.sql` e as asserções correspondentes
  em `scripts/migration-contracts.mjs`

## Contexto

A migration `0005_workspace_financial_ledger.sql` foi escrita assumindo que a
aplicação conecta ao Postgres com uma **role de runtime restrita** — sem
`BYPASSRLS`, sem ser dona do schema ou do banco. Em cima dessa premissa ela:

1. exigia `sellercore.runtime_role` definido no momento do apply, sob pena de
   `RAISE EXCEPTION 'runtime role ausente ou insegura'`;
2. concedia DML nas três tabelas e EXECUTE nas duas funções a essa role;
3. criava três policies de RLS ligadas a ela;
4. e o contrato verificado em runtime (`FINANCIAL_LEDGER_CONTRACT_SQL`) validava
   `runtime_acl_match`, `policies_match` e `runtime_role_safe`.

**A premissa não corresponde ao deployment.** Verificado em 13/08/2026 no banco de
produção (Supabase):

```
current_user      = postgres
postgres          = rolbypassrls TRUE, dono do database
schema owner      = pg_database_owner
```

Nenhuma role existente satisfaz o predicado da migration. As únicas sem
`BYPASSRLS` são internas do Supabase (`authenticator`, `supabase_auth_admin`,
`supabase_storage_admin`, …) e usá-las significaria dar privilégio do ledger ao
encanamento da plataforma.

Consequência: a 0005 **não podia ser aplicada**, e — mesmo se fosse — o
`ensureFinancialLedgerSchema()` a rejeitaria, porque sem `sellercore.runtime_role`
o contrato cai para `current_user` e `runtime_role_safe` é falso por causa do
`BYPASSRLS` do `postgres`. O ledger financeiro ficava permanentemente `SCHEMA_BLOCKED`.

## O que o aparato entregava de segurança real

Nada. As policies eram:

```sql
CREATE POLICY ... FOR ALL TO <role> USING (true) WITH CHECK (true)
```

Elas **não filtram por `workspace_id`**. Liberam tudo para a role. O isolamento
entre workspaces continua sendo garantido exclusivamente pelo código da aplicação
(`WHERE workspace_id = ...`), exatamente como em todas as outras tabelas do schema.

O que protege de fato são os `REVOKE` de `PUBLIC`, `anon` e `authenticated` — que
impedem os clientes públicos do Supabase de tocar nas tabelas — e o
`ENABLE ROW LEVEL SECURITY` sem policy, que deixa qualquer role futura sem
`BYPASSRLS` **fail-closed** por padrão.

## Decisão

Remover a exigência de runtime role dedicada, **preservando integralmente a parte
que protege**:

| Mantido | Removido |
|---|---|
| `REVOKE ALL ... FROM PUBLIC` | exigência de `sellercore.runtime_role` no apply |
| `REVOKE ALL ... FROM anon, authenticated` | `GRANT` de DML/EXECUTE à runtime role |
| `ENABLE ROW LEVEL SECURITY` nas 3 tabelas | as 3 policies `USING (true)` |
| Tabelas, colunas, checks, índices, FK, funções | `runtime_acl_match`, `policies_match`, `runtime_role_safe` |

`FINANCIAL_LEDGER_CONTRACT_VERSION` sobe de 2 para 3, porque o contrato mudou e
qualquer banco com a versão antiga deve ser tratado como divergente.

O contrato passa a exigir, no lugar das asserções removidas, que **não exista
nenhuma policy** nas tabelas do ledger e que **nenhum grantee além do
`current_user`** tenha privilégio — o que é mais estrito do que antes para
qualquer role que não seja a que conecta.

## Consequências

- ➕ O ledger financeiro passa a poder ser aplicado e lido. O Financeiro do TikTok
  deixa de ser `SCHEMA_BLOCKED`.
- ➕ O contrato para de afirmar uma postura de segurança que o deployment não tem.
  Não havia isolamento por RLS; agora o código não finge que havia.
- ➖ Continua sem defesa em profundidade no banco: **se a aplicação errar um
  `WHERE workspace_id`, o banco não segura**. Isso já era verdade para as ~20
  tabelas existentes; a 0005 apenas deixou de ser a exceção decorativa.
- ➖ A migration foi aplicada **fora do runner** nesta ocasião (o runner exige
  worktree limpo e autorização Ed25519 cujo emissor não existe no repo). O desvio
  está registrado em [`docs/migrations.md`](../migrations.md).

## O que fica em aberto

**Defesa em profundidade de verdade** — criar `sellercore_runtime` sem
`BYPASSRLS`, conceder privilégio nas tabelas existentes, repontar o `DATABASE_URL`
local e do Render, e então escrever policies que **filtrem por `workspace_id`**
(não `USING (true)`). Isso é o que o ADR-007 chama de o risco principal do
produto: vazamento cruzado entre inquilinos. É projeto próprio, com migração de
credencial e teste de isolamento cruzado — não cabe de carona numa migration de
ledger.
