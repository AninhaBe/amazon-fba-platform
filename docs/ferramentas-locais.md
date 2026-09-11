# Ferramentas locais (`scripts/`)

Utilitários que rodam **fora do app** — não fazem parte do produto, mas resolvem
tarefas recorrentes de operação. Todos usam o mesmo prefixo:

```
node --experimental-transform-types --import ./scripts/ts-resolver.mjs --env-file=.env.local scripts/<arquivo>
```

Convenção do projeto: scripts são `.mjs` (não `.ts`, que quebra o `tsc --noEmit`
do app). Scripts descartáveis usam prefixo `_tmp-` e são apagados ao terminar.

## `fba-monitor.mjs` — monitor de estoque FBA

Painel local em `http://localhost:4310` que acompanha o estoque FBA da Amazon,
com foco em **quando as unidades saem de "transferência interna" e viram
vendáveis**. Atalho: **`scripts/monitor-estoque.cmd`** (duplo clique no Windows).

- Consulta a SP-API a cada 5 min (`REFRESH_MS` para mudar) e a página recarrega
  a cada 1 min; tem botão **"Consultar agora"** para leitura sob demanda.
- Destaca em verde os SKUs com unidade vendável e mostra o quanto entrou desde a
  leitura anterior.
- `GET /api` devolve o snapshot em JSON; `GET /refresh` força a consulta.
- Porta ocupada dá mensagem explicando que já existe um monitor rodando (use
  `PORT=4311` para subir outro em paralelo).

**Usa o `LWA_REFRESH_TOKEN` do ambiente**, não a conexão OAuth do app — por isso
continua funcionando mesmo com a autorização da conta revogada
(ver [`conexoes-que-expiram.md`](./conexoes-que-expiram.md)). Somente leitura.

Contexto de por que ele existe: `pendingTransshipmentQuantity` é a etapa em que a
Amazon redistribui a remessa entre centros de distribuição. Nessa fase o estoque
já está com ela, mas **não conta como vendável** — e isso não aparece de forma
óbvia no Seller Central.

## `trial-account.mjs` — contas de avaliação

Criar, consultar, estender e excluir contas de teste com prazo.
Ver [`contas-de-avaliacao.md`](./contas-de-avaliacao.md).

## `_demo-seed.mjs` — workspace de demonstração

Popula o workspace da conta trial com dados sintéticos (pedidos, itens, taxas,
produtos e custos) para Amazon, Mercado Livre e Shopee. Existe porque a
candidatura ISV e o Go Live da Shopee exigem uma conta de teste onde o avaliador
veja um produto com dados, não telas vazias.

Idempotente: rodar de novo atualiza a senha e reescreve os dados. PRNG com seed
fixa (`Math.random()` e `Date.now()` não são usados na geração, para o resultado
ser reproduzível).

⚠️ Grava em **produção**, no workspace da conta demo — nunca no da usuária. O
isolamento por `workspace_id` é o que garante isso.

## Postgres descartável, para validar migration por EXECUÇÃO

Levantado em 11/09/2026 para provar a `0033` (e a `0032`, pendente junto) antes
da janela de apply. O caminho é o que o repo já prevê:

```
TEST_DATABASE_URL=postgres://...@127.0.0.1:5433/nexo_migracao npm run ci:preparar-banco
```

`ci-preparar-banco.mjs` cria o bootstrap pré-migrations (as tabelas antigas que
nasceram no `db.ts`, antes de as migrations existirem) e empilha `migrations/`
em ordem. Ele recusa alvo não-local e alvo igual a `DATABASE_URL` **antes** de
qualquer escrita.

⚠️ **NUNCA escreva um segundo script que aplique `.sql` em ordem.** Um caminho de
apply fora do portão assinado é o atalho que um dia alguém aponta para produção.
Um foi escrito neste dia, por não se ter achado o `ci-preparar-banco.mjs` de
primeira, e foi **apagado** — o caminho previsto já existia.

### ⚠️ A porta 5432 desta máquina JÁ TEM UM POSTGRES, e ele não é do NEXO

Medido em 11/09/2026 com `Get-NetTCPConnection -LocalPort 5432`: há um Postgres
**nativo do Windows** escutando em `0.0.0.0:5432` (processo `postgres`). **Não
sabemos de quem é** e ninguém o configurou para este projeto.

O sintoma de esbarrar nele é traiçoeiro: a conexão **funciona** e falha com
*"password authentication failed"* — ela chegou num servidor real, só que no
errado. Quem apontar `TEST_DATABASE_URL` para `localhost:5432` achando que é
descartável **escreve no banco de outra pessoa**. Use outra porta; o Postgres
levantado aqui ficou na **5433**.

### Onde ele roda, e as duas armadilhas do WSL

Não há `docker` nem `podman` nesta máquina. Há WSL2 (Ubuntu e Debian), e lá
dentro se roda como root, sem senha de sudo: `apt-get install postgresql` dá o
16.x. Nada é instalado no Windows. Trocar a porta: `pg_conftool 16 main set port
5433`.

1. **O encaminhamento de `localhost` do WSL2 cai quando a VM ocioso-desliga.**
   Conecta, funciona, e minutos depois `ECONNREFUSED` — com o Postgres
   provadamente no ar (`ss -lntp` mostra ele escutando). Segure um processo vivo
   (`wsl -d Ubuntu -e sleep 3000 &`) durante o trabalho. **Não** "conserte"
   abrindo `pg_hba.conf` para `0.0.0.0/0`: não é a causa, e é brecha.
2. **Rode pelo Node do Windows, não pelo do WSL.** O Ubuntu 24.04 traz Node 18,
   que não descasca tipos (`--experimental-strip-types`).

### O que essa prova cobre — e o que não cobre

Cobre **sintaxe, semântica e idempotência**, contra um schema construído do zero,
e permite medir o efeito (coluna, `CHECK`, índices, default, e quantas views
leem a tabela — a pergunta da lição da `0029`).

⚠️ **Não mede tempo de lock.** O banco está vazio; produção tem dado, estatística
e tamanho reais. Estimativa de lock em tabela quente continua estimativa.

## Outros já existentes

`migrate.mjs` (migrações versionadas), `backfill-canonical.mjs` (reprocessa
histórico para o modelo canônico), `listing-images.mjs` e `listing-health.mjs`
(anúncios da Amazon).
