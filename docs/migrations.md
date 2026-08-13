# Migrations fail-closed

O incidente revelou que o runner anterior podia aplicar DDL ao executar `npm run migrate`. Esse comando agora é uma trava sem conexão. Runtime, sync, testes e health também não criam nem reparam schema: retornam `SCHEMA_BLOCKED` quando o contrato mínimo está ausente.

## Fluxo

O `--runtime-role <role>` e obrigatorio tanto no `migrate:plan` quanto no apply.
A role entra no manifesto e, portanto, no `planHash` coberto pela autorizacao
Ed25519. O apply recusa uma role diferente da planejada. A role tambem nao pode
ser `current_user`, owner do database/schema, superuser ou `BYPASSRLS`.

1. `npm run migrate:plan -- --environment <local|staging|production> --out <arquivo>` faz somente introspecção SQL de leitura, imprime preflight sanitizado e cria um manifesto imutável com fingerprint do target, database/schema/role, commit/dirty, pendências, hashes e classificação das operações.
2. Um responsável externo emite uma autorização Ed25519 curta vinculada ao nonce, referência, ator, ambiente, fingerprint, hash do plano e expiração (máximo 15 minutos). O repositório deliberadamente não contém emissor nem autorização real.
3. Local: `npm run migrate:local -- --environment local --apply --expected-target <fp> --plan <arquivo> --authorization <arquivo>`. Só `localhost`, `127.0.0.1` e `::1` são aceitos; `.env.local` remoto aborta.
4. Remoto: `npm run migrate:apply -- --environment production --apply --expected-target <fp> --plan <arquivo> --authorization <arquivo>`. Exige `MIGRATION_AUTH_PUBLIC_KEY`, commit rastreado, worktree limpo, identidade e hashes invariantes.

### Contrato 0005 (ledger financeiro)

O plan e o apply executam a mesma introspecção somente-leitura de tabelas,
colunas/tipos/nullability, PK/FK (`NOT VALID`), checks, índices e predicados,
assinaturas/`SECURITY DEFINER`, ACLs e RLS. Objetos preexistentes criados por
`IF NOT EXISTS` só são aceitos quando semanticamente compatíveis. No apply, a
segunda inspeção ocorre dentro da transação; somente depois de contrato, ACL e
RLS em `PASS` são gravados `migration_contract_versions` e `schema_migrations`.

O `contract_hash` é SHA-256 dos bytes UTF-8 exatos de
`0005_workspace_financial_ledger.sql`, mantendo literalmente o marcador
`__CALCULATED_0005_CONTRACT_HASH__`. O runner calcula e substitui o marcador
apenas na cópia executada; assim não há constante solta nem auto-hash impossível.

O apply exige `--runtime-role <role>` existente. A role não pode ser `PUBLIC`,
`anon`, `authenticated`, superuser ou `BYPASSRLS`; recebe somente DML nas três
tabelas e execução nas duas funções, com policies privadas correspondentes.
Clientes Supabase públicos não recebem policy nem privilégio. O owner do schema
continua com o bypass nativo de owner do PostgreSQL e deve ficar restrito ao
runner operacional, nunca às credenciais do runtime.

O ledger também fecha contradições de proveniência sem enumerar tipos econômicos
de cada provider: linhas `unsettled` são estimadas e têm rank abaixo de 100;
linhas `settled`/`reversed` não são estimadas e têm rank autoritativo 100.
`statement_transactions` exige statement e evidência final; a fonte `unsettled`
exige ausência de statement e evidência provisória. Outros nomes de recurso
continuam permitidos desde que respeitem essas invariantes. Pagamentos seguem em
tabela separada e nunca são componentes de lucro.

### Plano e rollback da 0005

Antes de dados reais, falha transacional reverte DDL, grants, policies e ledgers
automaticamente. Depois que houver dados reais, a 0005 é **forward-only**: não
há rollback destrutivo; correções usam nova migration aditiva, preservando o
ledger e reconciliação. Uma reaplicação só é considerada válida quando o catálogo
e os hashes já passam integralmente.

Cada tentativa registra JSON sanitizado com run ID, ator, ambiente, fingerprint, commit/dirty, hashes/plano, referência da autorização e resultado. Nunca registrar URL, senha, nonce ou assinatura. O ledger precisa existir e possuir `migration_hash`; ausência ou legado sem hash é `BLOCKED` e requer procedimento de bootstrap/remediação separado, aprovado e auditado — o runner não corrige isso.

## Desvio autorizado: 0005 aplicada fora do runner (13/08/2026)

A 0005 foi aplicada **fora deste fluxo**, com autorização explícita da responsável,
porque o runner não conseguia executá-la em nenhum caminho:

- `migrate:local` só aceita `localhost/127.0.0.1/::1`, e o `DATABASE_URL` aponta
  para o Supabase — cai em `production`;
- em `production` o runner exige worktree limpo e commit rastreado, com ~200
  arquivos pendentes na época;
- e exige autorização Ed25519 cujo emissor este repositório declara não conter.

Foi aplicada em transação única, com `ROLLBACK` em caso de erro, gravando
`migration_contract_versions` (v3 + hash) e `schema_migrations` na mesma transação —
a mesma ordem que o runner faria. O contrato foi verificado depois do commit e
passou integralmente.

### Quatro defeitos encontrados no caminho

O ledger estava inalcançável por bugs independentes, nenhum deles detectável pelos
testes existentes, porque **nenhum teste conecta a um banco**:

1. `actual_columns` não expunha `typ`, então o SQL do contrato lançava `42703`
   **sempre** — aplicada ou não a migration.
2. `array_agg(attname)` produz `name[]` e era comparado com `text[]`: `42883`.
3. `migration_contract_versions`, criada pela 0003, **não tem `contract_hash`**,
   mas `inspectFinancialLedgerContract` lê essa coluna. Sem ela o contrato volta
   `version 0 / hash null`. A coluna passou a ser criada pela própria 0005.
4. A runtime role exigida não existe neste banco — ver
   [ADR-012](./adr/ADR-012-contrato-0005-sem-runtime-role.md).

Também observado: `service_role` recebe privilégios em toda tabela nova do schema
`public` via `ALTER DEFAULT PRIVILEGES` do Supabase, incluindo o de esvaziar a
tabela. A 0005 passou a revogá-lo junto de `anon` e `authenticated`.

### O runner continua inutilizável

**Nada disso consertou o runner.** Ele segue exigindo `--runtime-role` (que não
pode existir aqui) e inserindo em `schema_migrations(name, migration_hash)` e
`migration_contract_versions(..., contract_hash)` — colunas que não existiam antes
da 0005. A próxima migration esbarra nos mesmos muros. Consertar o runner é
trabalho próprio, ainda não feito.

## Incidente 0003/0004

As migrations `0003_oauth_refresh_leases.sql` e `0004_tiktok_shop_tax_rate.sql` ficam **ratificadas quanto à permanência**: este incidente não autoriza rollback nem remoção de seus objetos. O processo histórico que as aplicou **não foi validado** e não deve ser tratado como evidência de execução segura. A ratificação é de estado desejado, não do procedimento anterior.

Os testes do runner usam apenas funções puras, fakes e chaves efêmeras em memória; nenhum teste recebe `DATABASE_URL`, conecta ou muta banco.
