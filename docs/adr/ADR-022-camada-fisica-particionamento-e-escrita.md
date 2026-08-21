# ADR-022: Camada física — particionar por tempo e parar de reescrever o que não mudou

- **Status:** Proposto
- **Data:** 2026-08-21
- **Não altera:** [ADR-001](./ADR-001-modelo-canonico.md) (modelo canônico) nem
  [ADR-020](./ADR-020-definicao-unica-de-faturamento.md). Nenhuma coluna, chave ou
  semântica muda. Isto é camada **física**.
- **Depende de:** [ADR-016](./ADR-016-ciclo-de-vida-do-dado.md) (retenção)

## Contexto

O modelo lógico foi desenhado com cuidado (ADR-001). A camada física nunca foi
escrita: não há particionamento, os tipos são `text` para colunas de cardinalidade 4
e 5, e a camada bruta mora dentro do banco que serve a tela interativa de 1 segundo
(ADR-017).

Três medições de 21/08/2026 mostram o preço.

### 1. A escrita reescreve o que não mudou

| Tabela | Inserções | Updates | HOT |
|---|---:|---:|---:|
| `workspace_channel_orders` | 84.158 | **2.225.919** | 1.355.479 (61%) |
| `workspace_marketplace_orders` | 38.005 | **1.132.039** | **174 (0,015%)** |

São ~26 updates por linha inserida. O sync roda a cada 5 minutos por canal e regrava
a linha inteira, tenha ela mudado ou não.

Um update **não-HOT** reescreve a linha *e cada entrada de índice dela*. Em
`workspace_marketplace_orders`, praticamente 100% dos updates são não-HOT — 1,13
milhão de reescritas de índice para 38 mil linhas reais. É a origem direta das linhas
mortas, do inchaço de índice e do volume de WAL.

O `fillfactor` está no padrão (100), então não sobra espaço na página para o HOT
acontecer — o que explica os 0,015%.

### 2. Retenção sem partição custa `VACUUM FULL`

No expurgo de 19/08, apagar 144 mil linhas **não reduziu o tamanho do banco**. Foi
preciso `VACUUM FULL`, que **tranca a tabela inteira**. Hoje há 9.935 linhas mortas em
`workspace_channel_orders` e 5.503 em `workspace_channel_order_fees`.

### 3. A camada bruta cobre metade do que promete

`workspace_marketplace_orders` tem 37.950 linhas para 72.399 pedidos canônicos —
**52% de cobertura**. A justificativa da camada bruta é "reconstruir o canônico sem
rechamar a API"; para 48% dos pedidos isso já não é verdade.

## Decisão

Escrever a camada física em três frentes, **nesta ordem**, que não é a ordem de
impacto — é a ordem imposta pelo espaço em disco.

### ⚠️ A ordem é obrigatória, e o motivo é o limite de 500 MB

**Particionar exige duplicar a tabela.** Criar a tabela particionada e copiar os dados
significa ter as duas versões no disco ao mesmo tempo: `workspace_channel_orders` tem
122 MB, e a folga do plano Free hoje é de **59 MB**.

**Particionar primeiro coloca o banco em modo somente-leitura no meio da migração** —
com a tabela original já parcialmente copiada. É o pior estado possível.

Portanto: **liberar espaço vem antes de particionar. Não é preferência de sequência,
é pré-requisito.**

### Frente 1 — parar a escrita inútil (sem migração, sem espaço extra)

1. `ON CONFLICT ... DO UPDATE ... WHERE` comparando o registro novo com o existente,
   para que linha idêntica **não gere update**. Elimina a maior parte dos 3,3 milhões
   de updates.
2. `fillfactor` entre 85 e 90 **apenas em `workspace_channel_orders`**, para o HOT
   voltar a funcionar onde o update é real. **Não aplicar em
   `workspace_marketplace_orders`** — ver R2 abaixo: lá o HOT é impossível por causa de
   um índice de expressão sobre `payload`, e reduzir o fillfactor só aceleraria o
   consumo dos 59 MB de folga.

Ganho: menos linhas mortas, menos inchaço de índice, menos WAL, menos autovacuum.
**Custo de espaço: zero. Risco: contido à ingestão.** É a única frente que pode
começar hoje.

### Frente 2 — tirar a camada bruta do Postgres

Mover `payload`/`raw` para object storage após N dias quentes, como o ADR-016 já
previu e nunca foi feito. Libera 90–115 MB — e só depois disso existe espaço para a
Frente 3.

Junto, dois ajustes baratos:
- `SET COMPRESSION lz4` nas colunas JSON (hoje `pglz`, o padrão antigo);
- decidir o que fazer com os 48% de pedidos sem bruto — ou a camada cobre tudo, ou a
  promessa de reconstrução precisa ser reescrita para o que ela de fato entrega.

### Frente 3 — particionar por mês

`workspace_channel_orders`, `workspace_channel_order_items`,
`workspace_channel_order_fees` e `workspace_marketplace_orders`, particionadas por
`RANGE (occurred_at)` mensal.

- Retenção vira `DROP PARTITION`: instantânea, sem inchaço, sem trava.
- Índices passam a ser por partição — cada um pequeno o bastante para caber em memória.
- Consultas por janela de data varrem só as partições relevantes.

#### Como particionar sem duplicar a tabela — `ATTACH` em vez de `COPY`

A leitura inicial desta ADR assumiu o caminho óbvio: criar a tabela particionada,
copiar tudo, trocar. Medido em 21/08, esse caminho está fora de alcance —
`workspace_channel_orders` tem 123 MB e a folga do Free é 58 MB.

**Existe caminho que não copia linha nenhuma.** O PostgreSQL aceita anexar uma
tabela existente como partição de um pai novo:

1. renomear a tabela atual para `..._ate_<data>`;
2. criar o pai particionado com o nome original, `PARTITION BY RANGE (occurred_at)`;
3. adicionar `CHECK` na tabela antiga casando com os limites da partição;
4. `ATTACH PARTITION` — operação de catálogo, sem reescrever dados;
5. criar as partições mensais daí para frente.

O único custo real de espaço é **um índice único novo**, contendo `occurred_at`,
exigido para virar a PK do pai. O índice equivalente hoje ocupa 17 MB; com mais uma
coluna de 8 bytes fica na casa dos 20 MB — **cabe nos 58 MB de folga**, contra os
123 MB da cópia.

Contrapartida honesta: a história inteira fica numa única partição gigante, então
`DROP PARTITION` só passa a valer para os meses criados depois. O ganho é imediato
para o dado novo e gradual para o antigo — o que é aceitável, e é o que torna a
Frente 3 possível antes da Frente 2 caso seja necessário inverter a ordem.

⚠️ A chave primária de uma tabela particionada **precisa conter a coluna de partição**.
As chaves atuais não incluem `occurred_at`; incluí-la muda a forma da chave e, por
tabela filha, a unicidade passa a ser garantida por partição. Isso precisa ser
resolvido no desenho antes de qualquer DDL — é o ponto de maior risco desta ADR.

## Refinamentos após revisão cruzada (21/08/2026)

Três pontos levantados em revisão externa. Todos foram conferidos contra o banco;
dois se confirmam e um muda de forma.

### R1. Chaves estrangeiras — o alvo estava errado, mas existe um problema real

A revisão alertou que `items` e `fees` teriam de carregar `occurred_at` para manter FK
válida contra uma pai particionada.

**Verificado: não existe FK entre `orders`, `items` e `fees`.** A integridade é
garantida pela escrita atômica em CTE única — e funciona: medição de 21/08 encontrou
**zero itens órfãos e zero taxas órfãs**. Logo, `occurred_at` nas filhas não é exigido
por FK.

**Mas `occurred_at` é exigido de qualquer forma**, porque é a coluna de partição: quem
particiona precisa da coluna. Confirmado que **nenhuma das duas tem a coluna hoje**. A
denormalização acontece — só não pelo motivo apontado, e o custo é o mesmo: mais bytes
por linha em duas tabelas de ~70 e ~99 mil linhas, e a coluna passa a integrar a PK.

**E existe uma FK que a revisão não viu, e que quebra:**

```
financial_transactions_order_fk
  workspace_financial_transactions (workspace_id, provider, connection_id, order_id)
  → workspace_channel_orders (workspace_id, provider, connection_id, external_order_id)
  DEFERRABLE INITIALLY DEFERRED · NOT VALID
```

Ao particionar `workspace_channel_orders`, a PK passa a incluir `occurred_at` e **as
colunas referenciadas deixam de formar uma chave única** — a FK se torna inválida.
Decidir antes da DDL: derrubar a FK (ela é `NOT VALID`, logo já não valida o passado)
ou propagar `occurred_at` também para o ledger financeiro. A tabela está vazia hoje, o
que torna esta a hora barata de resolver.

### R2. `fillfactor` — a ressalva procede, e o motivo real é mais forte

A revisão observa que baixar o `fillfactor` reserva 10–15% por página nova, elevando a
taxa de crescimento até a Frente 2 liberar espaço. Correto, e relevante com 59 MB de
folga.

**Mas o motivo para não aplicar em `workspace_marketplace_orders` é outro, e é
definitivo.** Os índices dessa tabela são:

```
(workspace_id, provider, connection_id, external_order_id)
(workspace_id, provider, connection_id, occurred_at DESC)
(workspace_id, provider, connection_id, (payload #>> '{shipping,id}'))
   WHERE status = 'paid' AND (payload #>> '{shipping,id}') IS NOT NULL
```

O terceiro é **índice de expressão sobre `payload`, parcial sobre `status`** — as duas
colunas que o sync reescreve. **Update que toca coluna indexada não pode ser HOT,
haja o espaço em página que houver.** É a explicação exata dos 0,015% de HOT, e
significa que baixar `fillfactor` ali seria **puro custo, com ganho zero**.

Decisão: `fillfactor` **só** em `workspace_channel_orders` (hoje em 61% de HOT, onde há
folga real para melhorar), e **não** em `workspace_marketplace_orders`. Para esta, o
único conserto é a Frente 1.1 — parar de reescrever linha que não mudou.

### R3. Upsert sem a data — procede, e há um risco pior embutido

Com `occurred_at` na PK, o alvo do `ON CONFLICT` passa a incluí-la; qualquer busca sem
a data varre todas as partições. A revisão pede confirmação de que a ingestão sempre
tem a data em mãos. Procede e entra como pré-requisito de projeto.

**O risco que não foi apontado é maior:** o PostgreSQL **não move linha entre partições
via `ON CONFLICT`**. Se o `occurred_at` de um pedido já gravado mudar — correção de
fuso, data provisória substituída pela definitiva, retificação do canal — o upsert
**não atualiza: insere uma segunda linha em outra partição**, e o pedido passa a existir
duas vezes. Sem FK e sem unicidade cruzando partições, nada barra isso.

Antes da Frente 3 é obrigatório provar que `occurred_at` é **imutável por pedido** após
a primeira gravação, ou tratar a mudança explicitamente (apagar e reinserir). Isto é
risco de **duplicação silenciosa de faturamento** — a pior classe de defeito deste
produto.

### Sobre "sem nenhum risco"

A revisão classifica a Frente 1 como "ganho massivo sem nenhum risco de downtime".
Downtime, de fato, não há. Mas a mudança é no caminho de escrita da ingestão: um erro
na comparação de "linha idêntica" faz o sync **parar de aplicar atualização legítima**,
e isso não aparece como erro — aparece como dado velho na tela. Vale teste com pedido
que muda de status antes de subir.

## Alternativas consideradas

**Trocar a chave natural composta por `id` sequencial.** Rejeitado. A ingestão é
`upsert` idempotente num único statement com CTEs; com chave artificial seria preciso
resolver o id do pai antes de gravar itens e taxas, quebrando a atomicidade atual. A
identidade do pedido **é** o ID externo. O problema nunca foi a chave ser natural — é
ela ser larga e redundante (ver abaixo).

**Remover `provider` das chaves e índices.** Adiado, não rejeitado. `provider` é 100%
derivável de `connection_id` (verificado em 72.399 de 72.399 linhas: `connection_id`
sempre começa com `provider || ':'`), e os cinco índices carregam os dois. Removê-lo
encolhe todos os índices sem mudar arquitetura — mas mexe na mesma DDL da Frente 3 e
deve ir junto, não antes.

## Consequências

- ➕ Retenção deixa de exigir operação que tranca tabela.
- ➕ A escrita para de gerar trabalho para si mesma.
- ➖ Migração de tabela particionada em produção, sem PITR, é a operação mais
  arriscada já feita neste banco. Exige janela, ensaio e plano de volta.
- ➖ A Frente 3 fica **bloqueada** até a Frente 2 liberar espaço.
- ⚠️ Nada disto deve ser implementado antes desta ADR sair de **Proposto**.
