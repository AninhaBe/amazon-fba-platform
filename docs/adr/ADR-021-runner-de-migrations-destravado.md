# ADR-021: Runner de migrations destravado — e a custódia da chave que o autoriza

- **Status:** Aceito
- **Data:** 2026-08-21
- **Complementa:** [ADR-012](./ADR-012-contrato-0005-sem-runtime-role.md)
- **Altera:** `scripts/migrate-cli.mjs`, `scripts/migration-safety.mjs`,
  `public.schema_migrations`

## Contexto

O aparato fail-closed de migrations foi escrito depois de um incidente real: o
runner antigo aplicava DDL ao rodar `npm run migrate`. A resposta foi correta —
`npm run migrate` virou trava sem conexão, e o apply passou a exigir plano,
manifesto com hash, worktree limpo e autorização assinada.

**Só que o aparato nunca funcionou nesta base.** Nenhuma migration de `0003` em
diante passou por ele. Todas foram aplicadas por fora, cada uma com seu desvio
registrado em [`docs/migrations.md`](../migrations.md). Um controle que é
contornado em 100% dos casos não é controle: é atrito que treina a operação a
passar por cima — e a passar por cima **sem plano, sem classificação de operação
destrutiva e sem registro de hash**, que é justamente o que ele existia para dar.

Três muros o mantinham inutilizável. Só um era decisão; os outros dois eram defeito.

### Muro 1 — `--runtime-role` obrigatória (defeito)

O CLI exigia uma role de runtime existente, sem `BYPASSRLS`, que não fosse dona do
banco/schema nem o `current_user`. **A ADR-012 já havia constatado, em 13/08, que
nenhuma role deste deployment satisfaz esse predicado** (conectamos como
`postgres`, dono do banco e com `BYPASSRLS`) e que as policies que ela habilitava
eram `USING (true)` — não protegiam nada.

A ADR-012 removeu a exigência da migration e do contrato, **e esqueceu o runner.**
Ele seguiu cobrando na linha 15 uma premissa que o próprio repositório já
declarara falsa. Isso sozinho travava todo `plan` e todo `apply`.

### Muro 2 — `schema_migrations` sem `migration_hash` (defeito)

O runner sempre gravou `(name, migration_hash)`. A tabela aqui é
`(name, applied_at)`: a coluna **nunca existiu**. `inspectTarget` recusa um ledger
sem ela ("ledger legado sem hashes"), então o runner morria antes de qualquer
introspecção. `migration_contract_versions.contract_hash` já existia — a 0005
criou; só esta ficou para trás.

Confirmado na prática em 21/08: a primeira tentativa de aplicar a `0006` pelo
caminho manual morreu exatamente neste ponto, com `ROLLBACK` limpo.

### Muro 3 — autorização Ed25519 sem emissor (decisão, não defeito)

O `validateApply` exige uma autorização assinada, ligada a nonce, ator, ambiente,
fingerprint do banco, hash do plano e expiração de no máximo 15 minutos. E o
repositório declara, de propósito, **não conter emissor nem chave**. Sem emissor,
o apply era logicamente impossível.

## Decisão

**Consertar os dois defeitos e implementar o terceiro como foi desenhado.** Não
amputar o aparato: o que ele protege — banco de produção com dado financeiro, em
plano sem PITR — merece porta.

### 1. `--runtime-role` passa a ser opcional

Aplicando o que a ADR-012 já decidira. **O que ela protegia continua inteiro:**
quando a role é informada, toda a validação roda, e o apply segue recusando role
diferente da assinada no manifesto. A comparação virou simétrica — "nenhuma role"
só casa com "nenhuma role" —, então um apply não pode nem introduzir uma role que
a assinatura não cobre, nem omitir a que ela cobre. No dia em que existir
`sellercore_runtime` (o "em aberto" da ADR-012), nada precisa ser reescrito.

### 2. `migration_hash` criada por bootstrap, fechada por migration

Há um ovo-e-galinha real: o runner precisa introspectar o ledger para montar
qualquer plano, e não consegue introspectar um ledger sem a coluna. A coluna e a
linha de base nascem em `scripts/bootstrap-ledger-hash.mjs` — o "procedimento de
bootstrap separado" que o próprio código cita ao recusar. O resto
(`NOT NULL` + `CHECK` de formato) é a migration `0007`, que **passa pelo fluxo
autorizado** e por isso é a primeira prova de que o runner voltou a funcionar.

⚠️ **O backfill é linha de base, não certificação retroativa.** Ele grava o hash do
arquivo como ele está hoje. Não prova que foi esse conteúdo que rodou em 0001–0004
— aplicadas por um processo que o repo declara não validado. O valor da detecção
de drift é daqui para frente.

### 3. A chave existe; a privada mora fora do repositório

`scripts/migration-authorize.mjs` emite a autorização. O par é gerado uma vez, com
`--out-dir` **obrigatoriamente fora do repositório** (o script recusa um caminho
interno). A pública vai para `MIGRATION_AUTH_PUBLIC_KEY` no ambiente de quem
aplica; a privada fica só com quem autoriza.

## O que isto compra de verdade — e o que não compra

Ser honesto aqui importa mais do que a ferramenta parecer robusta.

**Não compra separação de responsabilidades.** O desenho fala em "responsável
externo". Nesta operação, de uma pessoa só, quem autoriza e quem aplica são a
mesma pessoa, segurando as duas chaves. Chamar isso de dupla custódia seria
mentir para o próprio repositório — o mesmo tipo de mentira que a ADR-012 achou
nas policies `USING (true)`.

**Compra quatro coisas concretas, todas reais mesmo com uma pessoa:**

| O que | Por que importa aqui |
|---|---|
| Apply não acontece por acidente | Exige plano em disco, assinatura separada e janela de 10–15 min. Nenhum comando solto, nenhum agente distraído, aplica DDL em produção |
| A operação é classificada antes | `classify()` marca `DROP`/`TRUNCATE` como `DESTRUCTIVE` **no plano, antes de rodar**. O `DROP` das 4 tabelas de 21/08 teria aparecido assim |
| O alvo é conferido | `--expected-target` com fingerprint do banco: aplicar no banco errado exige errar duas vezes |
| Migration editada depois de aplicada acusa | É o que `migration_hash` + `NOT NULL` passam a garantir |

## Consequências

- ➕ O runner sai de 100% de contorno para caminho utilizável. `docs/migrations.md`
  para de acumular "desvio autorizado" como rotina.
- ➕ A `0007` prova o fluxo ponta a ponta em produção, em vez de o repo afirmar que
  funciona sem nunca ter rodado.
- ➖ **Se a chave privada vazar, a autorização vira carimbo.** Trocar o par é o
  único remédio; não há revogação.
- ➖ Continua sem defesa em profundidade no banco — o "em aberto" da ADR-012 segue
  aberto. Este ADR destrava o processo de aplicar migrations, não o isolamento
  entre inquilinos.
- ➖ O bootstrap é um desvio a mais, e o último previsto. Se aparecer um quarto
  muro, a pergunta certa passa a ser se o aparato cabe nesta operação — não emendar
  outro desvio.
