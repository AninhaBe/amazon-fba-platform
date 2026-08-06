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

## Outros já existentes

`migrate.mjs` (migrações versionadas), `backfill-canonical.mjs` (reprocessa
histórico para o modelo canônico), `listing-images.mjs` e `listing-health.mjs`
(anúncios da Amazon).
