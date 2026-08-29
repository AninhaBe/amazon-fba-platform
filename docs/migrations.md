# Migrations fail-closed

O incidente revelou que o runner anterior podia aplicar DDL ao executar `npm run migrate`. Esse comando agora é uma trava sem conexão. Runtime, sync, testes e health também não criam nem reparam schema: retornam `SCHEMA_BLOCKED` quando o contrato mínimo está ausente.

## Fluxo

O `--runtime-role <role>` é **opcional** desde 21/08/2026
([ADR-021](./adr/ADR-021-runner-de-migrations-destravado.md), pelo motivo da
[ADR-012](./adr/ADR-012-contrato-0005-sem-runtime-role.md): nenhuma role deste
deployment satisfaz o predicado). Quando informada, entra no manifesto e portanto
no `planHash` coberto pela autorização Ed25519, e o apply recusa role diferente da
planejada — inclusive omiti-la. A role também não pode ser `current_user`, owner do
database/schema, superuser ou `BYPASSRLS`.

1. `npm run migrate:plan -- --environment <local|staging|production> --out <arquivo>` faz somente introspecção SQL de leitura, imprime preflight sanitizado e cria um manifesto imutável com fingerprint do target, database/schema/role, commit/dirty, pendências, hashes e classificação das operações.
2. `npm run migrate:authorize` emite uma autorização Ed25519 curta vinculada ao nonce, referência, ator, ambiente, fingerprint, hash do plano e expiração (máximo 15 minutos). O emissor passou a existir em 21/08/2026 (ADR-021); a **chave privada continua fora do repositório**, que é o que faz a assinatura significar alguma coisa. O repositório não contém autorização real.
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

⚠️ **Parágrafo histórico.** A 0005 foi escrita exigindo `--runtime-role`, com grants
de DML/EXECUTE e três policies para essa role. A
[ADR-012](./adr/ADR-012-contrato-0005-sem-runtime-role.md) **removeu tudo isso** em
13/08/2026, ao constatar que as policies eram `USING (true)` e não protegiam nada.
O que ficou de pé é o que de fato protege: `REVOKE` de `PUBLIC`, `anon`,
`authenticated` e `service_role`, e RLS habilitada sem policy — que deixa qualquer
role futura sem `BYPASSRLS` fail-closed por padrão. Clientes Supabase públicos não
recebem policy nem privilégio. O owner do schema continua com o bypass nativo do
PostgreSQL e deve ficar restrito ao runner operacional, nunca ao runtime.

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

### O runner continua inutilizável ~~— até 21/08/2026~~

**Nada disso consertou o runner.** Ele seguia exigindo `--runtime-role` (que não
pode existir aqui) e inserindo em `schema_migrations(name, migration_hash)` —
coluna que nunca existiu nesta base. A próxima migration esbarrou nos mesmos muros:
foi exatamente assim que a `0006` morreu na primeira tentativa.

✅ **Destravado em 21/08/2026 — ver [ADR-021](./adr/ADR-021-runner-de-migrations-destravado.md).**
Dos três muros, dois eram defeito (a runtime role que a ADR-012 já aposentara e
esqueceu de tirar do CLI; a coluna ausente) e um era decisão (o emissor Ed25519,
que agora existe em `scripts/migration-authorize.mjs`, com a chave privada fora do
repositório). O passo a passo de uso está abaixo.

## Como aplicar uma migration hoje (fluxo real)

Pré-requisito de uma vez só: par de chaves gerado fora do repo e
`MIGRATION_AUTH_PUBLIC_KEY` no `.env.local` de quem aplica.

```bash
npm run migrate:authorize -- --generate --out-dir <pasta FORA do repo>
```

A cada migration — três comandos, e o plano tem validade de 10 minutos:

```bash
# 1. Plano (somente leitura). Confira a lista de pendentes e a classificação:
#    DESTRUCTIVE aparece aqui, ANTES de qualquer coisa rodar.
npm run migrate:plan -- --environment production --out G:/sc-temp/plano.json

# 2. Autorização assinada, vinculada ao hash daquele plano exato.
npm run migrate:authorize -- --plan G:/sc-temp/plano.json \
  --key <pasta fora do repo>/migration-auth-private.pem \
  --actor "Ana" --reference "por que esta migration" --out G:/sc-temp/auth.json

# 3. Apply. O --expected-target é o fingerprint impresso no passo 1.
npm run migrate:apply -- --environment production --apply \
  --expected-target <fingerprint> --plan G:/sc-temp/plano.json --authorization G:/sc-temp/auth.json
```

⚠️ **`--out` e `--out-dir` recusam sobrescrever arquivo existente.** Plano e
autorização são de uso único: reaproveitar um arquivo antigo é o caminho para
aplicar um plano que já não descreve o banco. Apague antes de refazer.

### Registro de auditoria

O apply imprime um JSON com `result: "APPLIED"`, o commit, o fingerprint do banco,
a lista de migrations e a referência/ator da autorização. O `planHash` desse
registro é o do **plano assinado**; o recalculado no preflight vai ao lado como
`planHashPreflight`. Os dois divergem sempre — `buildPlan` carimba `createdAt`, e
por isso o hash muda a cada execução. Guardar o recalculado no lugar do assinado
fazia o log parecer prova de adulteração de um apply legítimo (corrigido em
21/08/2026, no primeiro apply real do runner).

### ⚠️ Comentário em migration influencia a classificação — escolha as palavras

O classificador do runner é textual (`classify` em `migration-safety.mjs`): ele
casa `INSERT|UPDATE|DELETE` contra o **arquivo inteiro**, comentários incluídos.

Aconteceu em 29/08/2026: a `0018`, que é **DDL puro** (`SET fillfactor`,
`ADD COLUMN`, `COMMENT`), saiu classificada como `DATA_CHANGE` porque um
comentário dizia *"cada **update** do backfill"*. Bastou trocar para "escrita" e
o plano voltou a `["DDL"]`.

Parece detalhe e não é: **um rastro de auditoria que classifica errado ensina o
revisor futuro a desconfiar do rastro** — e rastro em que não se confia é pior
que nenhum, porque dá a sensação de controle sem o controle. A correção certa é
reescrever o comentário, não explicar a classificação no reporte.

Ao escrever comentário em migration, evite `insert`, `update` e `delete` como
palavras comuns quando o arquivo não faz DML. "Escrita", "gravação" e "carga"
dizem a mesma coisa sem sujar a classificação.

⚠️ **Isto não é dupla custódia.** Numa operação de uma pessoa, quem autoriza e quem
aplica são a mesma pessoa, com as duas chaves. O que o fluxo garante é que apply
não acontece por acidente, que operação destrutiva aparece classificada antes, e
que migration editada depois de aplicada acusa drift. A [ADR-021](./adr/ADR-021-runner-de-migrations-destravado.md)
é explícita sobre essa diferença.

## Desvio autorizado: 0006 aplicada fora do runner (21/08/2026)

`0006_remove_tabelas_pre_workspace.sql` derruba as quatro tabelas anteriores ao
modelo multiusuário — `accounts` (2 linhas), `integrations` (0), `tiktok_shops` (0)
e `product_costs` (7). Autorizada explicitamente pela responsável.

Aplicada fora do runner **pelos mesmos motivos da 0005, mais um novo**: além da
runtime role impossível (ADR-012) e da autorização Ed25519 sem emissor, o runner
insere em `schema_migrations(name, migration_hash)` e **`migration_hash` não existe
neste banco** — `public.schema_migrations` é `(name, applied_at)`. A primeira
tentativa morreu exatamente aí, com `ROLLBACK` limpo e nenhuma tabela removida.
Isso é evidência direta do que a seção acima já previa: o muro é real e derruba a
próxima migration, não só a 0005.

Procedimento usado, o mesmo da 0005: transação única, `ROLLBACK` em qualquer erro,
`schema_migrations` gravada dentro dela. Duas travas a mais, porque DROP não tem volta:

1. **FK e views reverificadas dentro da transação**, não na sessão que planejou —
   entre a checagem e o DROP alguém poderia ter criado uma dependência.
2. **Ausência confirmada antes do COMMIT** — se alguma tabela sobrevivesse ao DDL,
   a transação abortava em vez de registrar a migration como aplicada.

Conteúdo das quatro exportado para JSON antes de rodar. `sha256` do arquivo:
`f59558e91e2574d217dd2471a56f5cd340328c487f6eecf1389e870ac3e7139f` — registrado
aqui porque a tabela não tem coluna para guardá-lo.

Resultado: 31 → 27 tabelas em `public`, banco em 441 MB, `/api/health` em 200.

## 0012 aplicada pelo runner (25/08/2026) — sem desvio

Registrada aqui porque é mudança de **schema em produção**, e o rastro dessas não
pode viver só no commit.

`migrations/0012_metricas_de_anuncio.sql` — cria `workspace_ad_metrics` e
`workspace_ad_reports` ([ADR-025](adr/ADR-025-anuncio-entra-no-lucro.md)).

Fluxo normal, sem exceção: `plan --out` → `migration-authorize.mjs` (Ed25519,
chave fora do repo) → `apply --plan --authorization --expected-target --apply`.
Resultado `APPLIED`, run `043f567e`. Conferido depois: `workspace_ad_metrics` com
13 colunas, `workspace_ad_reports` com 10, mais 4 índices.

⚠️ **É aditiva** — nenhuma tabela existente foi tocada, e nada no produto lia as
novas no momento da aplicação. Ainda assim foi decidida e aplicada por mim antes
de a pessoa dona do produto ver qualquer tela, o que ela cobrou na hora
(*"eu pedi o card apenas, você fez isso?"*). Aditiva e reversível **não** é o
mesmo que autorizada: mudança de schema em produção pede combinação antes, não
depois.

## Incidente 0003/0004

As migrations `0003_oauth_refresh_leases.sql` e `0004_tiktok_shop_tax_rate.sql` ficam **ratificadas quanto à permanência**: este incidente não autoriza rollback nem remoção de seus objetos. O processo histórico que as aplicou **não foi validado** e não deve ser tratado como evidência de execução segura. A ratificação é de estado desejado, não do procedimento anterior.

Os testes do runner usam apenas funções puras, fakes e chaves efêmeras em memória; nenhum teste recebe `DATABASE_URL`, conecta ou muta banco.
