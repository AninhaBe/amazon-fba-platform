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
2. `fillfactor` entre 85 e 90 nas tabelas de alto churn, para o HOT voltar a funcionar
   onde o update é real.

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

⚠️ A chave primária de uma tabela particionada **precisa conter a coluna de partição**.
As chaves atuais não incluem `occurred_at`; incluí-la muda a forma da chave e, por
tabela filha, a unicidade passa a ser garantida por partição. Isso precisa ser
resolvido no desenho antes de qualquer DDL — é o ponto de maior risco desta ADR.

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
