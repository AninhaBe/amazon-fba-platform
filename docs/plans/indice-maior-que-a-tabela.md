# O índice está errado, não grande — recomendação da frente L

**Medido em 31/08–01/09/2026, produção, somente leitura.** Nenhuma escrita foi
feita. Este documento é proposta: nada aqui foi aplicado.

O gatilho foi a revisão da ADR-027, onde a PK de seis colunas `TEXT` apareceu
como custo lateral. Ela não é lateral.

## O número que muda o enquadramento

Na `workspace_channel_order_fees`, as três primeiras colunas da chave primária —
`workspace_id` (36 B), `provider` (10,6 B), `connection_id` (22,8 B) — ocupam
**69 bytes por linha**. Elas codificam, no banco inteiro, **10 combinações
distintas**: 4 workspaces, 4 providers, 10 conexões.

**62% do peso da chave carrega cerca de 3 bits de informação.**

Isso é o que separa "o índice está grande" de "o índice está errado". Um índice
grande porque a tabela é grande é o preço do negócio. Um índice grande porque a
chave repete 36 bytes de UUID em texto, 140 mil vezes, para distinguir quatro
valores, é defeito.

## Onde dói hoje

Banco em **471 MB de um teto de 500** — **29 MB de folga**. Índices somam
**~137 MB**, e duas tabelas têm mais índice que dado:

| tabela | heap | TOAST | índice | razão idx/heap | total |
|---|---|---|---|---|---|
| `workspace_channel_orders` | 93 MB | — | 34 MB | 0,36 | **127 MB** |
| `workspace_marketplace_orders` | 11 MB | **93 MB** | 20 MB | **1,81** | **124 MB** |
| `workspace_channel_order_fees` | 24 MB | — | **35 MB** | **1,46** | 58 MB |
| `workspace_channel_order_items` | 30 MB | — | 21 MB | 0,71 | 51 MB |
| `workspace_marketplace_shipments` | 35 MB | — | 6,9 MB | 0,19 | 42 MB |
| `workspace_marketplace_events` | 21 MB | — | 12 MB | 0,59 | 33 MB |
| `workspace_rank_history` | 1,6 MB | — | 3,2 MB | **1,95** | 4,9 MB |

⚠️ **Correção de 01/09/2026.** A primeira versão desta tabela usava
`pg_relation_size`, que **exclui o TOAST**, e por isso mostrava
`workspace_marketplace_orders` com 11 MB de dado. O `payload` dela é jsonb
toastado: são **93 MB fora do heap**, e a tabela é a segunda maior do banco, não
uma tabela de 31 MB. Os picos de reescrita citados adiante já estão corrigidos.
A `workspace_channel_orders` é o oposto — TOAST de 8 kB, ou seja o `raw` dela
mora **inline no heap**, comprimido.

Uma tabela com **um único índice** — a PK — e razão 1,46 não tem excesso de
índices. Tem a chave errada.

---

## Achado A — `workspace_id` é um UUID guardado como texto

**Medido:** 99.420 de 99.420 linhas de `workspace_channel_orders` casam o formato
UUID canônico, com comprimento fixo 36. Não há uma exceção.

`TEXT` de 36 caracteres ocupa **37 B** (36 + 1 de cabeçalho curto). O tipo `uuid`
nativo ocupa **16 B**, sem cabeçalho. **Economia: 21 B por ocorrência** — em cada
entrada de índice que contenha a coluna, e outra vez no heap.

### Ganho por tabela

| tabela | linhas | índices com `workspace_id` | entradas | ganho índice | ganho heap | total |
|---|---|---|---|---|---|---|
| `workspace_channel_orders` | 99.420 | 4 | ~298k | 6,3 MB | 2,0 MB | **8,3 MB** |
| `workspace_channel_order_items` | 97.754 | 2 | ~196k | 4,1 MB | 2,0 MB | **6,1 MB** |
| `workspace_channel_order_fees` | 140.369 | 1 | ~140k | 2,9 MB | 2,8 MB | **5,7 MB** |
| `workspace_marketplace_orders` | 39.535 | 3 | ~99k | 2,1 MB | 0,8 MB | **2,9 MB** |
| `workspace_marketplace_events` | 32.646 | 2 | ~65k | 1,4 MB | 0,7 MB | **2,1 MB** |
| `workspace_marketplace_shipments` | 38.082 | 1 | ~38k | 0,8 MB | 0,8 MB | **1,6 MB** |
| `workspace_rank_history` | 15.752 | 2 | ~32k | 0,7 MB | 0,3 MB | **1,0 MB** |
| `workspace_channel_offer_history` | 9.116 | 2 | ~18k | 0,4 MB | 0,2 MB | **0,6 MB** |
| **total** | | | **~886k** | **~18,7 MB** | **~9,6 MB** | **~28 MB** |

⚠️ O ganho realizado vem abaixo disso, porque a economia é por linha mas o espaço
é devolvido por página. Trate ~28 MB como teto e ~20 MB como piso.

**Custo de churn: baixo.** O driver `pg` devolve `uuid` como string, e comparação
com parâmetro textual é coagida pelo próprio Postgres. O que quebra é código que
trate `workspace_id` como texto arbitrário (`LIKE`, concatenação, `substring`) —
levantamento pontual antes de aplicar, não reescrita.

## Achado B — `provider` é 100% derivável de `connection_id`

**Medido:** 99.420 de 99.420 linhas satisfazem `connection_id LIKE provider || ':%'`.
O formato é literalmente `provider:id_externo` — `amazon:AO62LVXJMX3AA`,
`mercado_livre:648425194`, `shopee:275804987`.

Guardar `provider` ao lado de `connection_id` na mesma chave é **armazenar o
provider duas vezes**, a ~11 B por ocorrência. Ganho estimado: ~7,7 MB de índice
+ ~5,2 MB de heap ≈ **13 MB**.

**Descartado, e o motivo é churn, não tamanho.** Remover `provider` da chave muda
a PK de todas as tabelas canônicas, todo `ON CONFLICT`, toda consulta e todo
código de escrita dos quatro canais. É o inverso do Achado A: caro em risco,
barato em bytes. Fica registrado porque merece ser reconsiderado se o modelo de
chave for redesenhado por outro motivo — nunca sozinho.

## Achado C — dois índices sem uso em 63 dias

As estatísticas contam desde **30/06/2026** — janela de **63 dias**, longa o
bastante para a conclusão valer:

| índice | scans em 63 dias | frequência | tamanho |
|---|---|---|---|
| `workspace_channel_offer_history_idx` | **17** | 1 a cada 4 dias | 1.152 kB |
| `workspace_marketplace_orders_period_idx` | **97** | 1,5 por dia | 6.496 kB |

O segundo é o caso mais claro: a PK da mesma tabela já cobre o prefixo
`(workspace_id, provider, connection_id)`; ele só acrescenta `occurred_at DESC`,
e é usado uma vez e meia por dia enquanto ocupa 6,5 MB.

**Ganho: ~7,6 MB**, com uma migration trivial e **reversível** — recriar um
índice é um comando.

⚠️ **Não recomendo dropar `workspace_rank_history_idx`** (3.040 scans, 1.616 kB),
mesmo tendo índice maior que a tabela: 48 usos por dia é uso real. E
`channel_orders_workspace_period_idx` (14.849 scans, 7.312 kB) **não é redundante**
com `channel_orders_period_idx`: o prefixo `(workspace_id, occurred_at)` serve a
consulta multicanal ordenada por data, que o outro, prefixado por
`provider, connection_id`, não serve. Mantidos os dois.

## Achado D — o que infla o índice além do conteúdo é a escrita

Atualizações por linha viva, medidas em 63 dias:

| tabela | updates | linhas vivas | **updates por linha** |
|---|---|---|---|
| `workspace_marketplace_orders` | 1.157.395 | 39.535 | **29,3** |
| `workspace_channel_orders` | 2.380.818 | 99.420 | **23,9** |
| `workspace_channel_order_fees` | 1.310.034 | 140.371 | **9,3** |
| `workspace_marketplace_syncs` | 1.178.864 | **14** | — |
| `workspace_marketplace_overview_snapshots` | 2.986.272 | **12** | — |

Todo `UPDATE` que não é HOT insere entrada nova em **todos** os índices da
tabela. O efeito é medível: na `fees`, o índice custa **257,8 B por linha** contra
~130 B de conteúdo lógico (chave de 111 B mais cabeçalhos). **Cerca de metade do
índice é folga acumulada.**

Isso não se conserta com migration: conserta com `REINDEX INDEX CONCURRENTLY`,
que é manutenção. Ganho potencial só na `fees`: 34 MB → ~18 MB, **~16 MB**.

---

## A restrição que ordena tudo: 29 MB de folga

As duas operações que recuperam espaço **precisam de espaço para rodar**:

- `REINDEX CONCURRENTLY` constrói o índice novo ao lado do velho. Pico = tamanho
  do índice. O `fees_pkey` tem **34 MB** — **não cabe nos 29 MB de hoje**.
- `ALTER COLUMN TYPE` reescreve tabela e índices. Pico de `workspace_channel_orders`:
  **127 MB**; o de `workspace_marketplace_orders`, **124 MB**. Não chega perto.

📌 Estes dois números foram para
[`espaco-no-teto.md`](./espaco-no-teto.md), que trata do problema maior que este
documento destapou: com 29 MB de folga, **nenhuma operação de reescrita cabe**, e
o expurgo do bronze sozinho não resolve.

Por isso a recomendação é uma **sequência**, e essa é a parte que vale mais que
qualquer um dos achados isolados:

### Passo 1 — dropar os dois índices sem uso `+7,6 MB`

Migration trivial, reversível, sem tocar em dado. Folga vai a **~37 MB**.

```sql
-- Medido em 01/09/2026, contra `pg_stat_user_indexes`, numa janela de 63 dias
-- (estatisticas do banco resetadas em 30/06/2026). Os numeros abaixo sao a
-- decisao inteira: quem for recriar um destes daqui a seis meses precisa saber
-- que o drop teve medida, e nao palpite.

-- 17 scans em 63 dias (1 a cada 4 dias) para 1.152 kB de indice.
DROP INDEX IF EXISTS workspace_channel_offer_history_idx;

-- 97 scans em 63 dias (1,5 por dia) para 6.496 kB de indice. Alem do desuso, a
-- PK da mesma tabela ja cobre o prefixo (workspace_id, provider, connection_id);
-- este indice so acrescenta occurred_at DESC.
DROP INDEX IF EXISTS workspace_marketplace_orders_period_idx;
```

⚠️ **Aplicar só depois que a 0022 estiver aplicada** — decisão do cérebro em
01/09/2026, pelo mesmo motivo de este DDL ainda não estar em `migrations/`: duas
migrations não aplicadas na árvore ao mesmo tempo.

### Passo 2 — `REINDEX CONCURRENTLY`, do menor para o maior `+20 a 30 MB`

Um por vez, medindo a folga **antes e depois de cada um**. Com 37 MB, o
`fees_pkey` (34 MB) passa. Não é migration: é manutenção, não muda schema, mas
**escreve** — aprovado pelo cérebro em 01/09/2026 com três condições:

1. do menor para o maior, um por vez, com a folga medida antes e depois;
2. 🛑 **regra de parada, escrita antes de começar:** se a folga cair abaixo do
   tamanho do próximo índice, **para e chama o cérebro**. Não tentar o próximo
   "porque provavelmente cabe";
3. avisar antes de começar — é escrita em produção num banco com 6% de folga, e
   ele quer saber a hora.

### Passo 3 — `workspace_id` para `uuid` `+20 a 28 MB`

🔴 **BLOQUEADO POR ESPAÇO, não por dúvida técnica.** Decisão do cérebro em
01/09/2026: o passo 3 não vira ADR agora. A medição está fechada e a direção está
certa — o que falta é folga para executá-lo. **O desbloqueio é o expurgo do
bronze**, e nada além dele. ADR que não pode ser executada vira dívida com
aparência de plano.

⚠️ **Ainda não cabe depois do passo 2.** Mesmo com ~65 MB de folga,
`workspace_channel_orders` pede pico de 127 MB. Duas saídas:

**(a) Expurgar o bronze primeiro** — e este é o achado que amarra tudo:

| coluna | tamanho |
|---|---|
| `workspace_marketplace_orders.payload` | **74 MB** |
| `workspace_channel_orders.raw` | **41 MB** |
| | **115 MB** |

O expurgo do bronze já é decisão tomada ([ADR-026](../adr/ADR-026-camadas-por-ciclo-de-vida.md));
falta desenhá-lo. **O que ninguém tinha medido é que ele não é só higiene: é o
bloqueio físico da correção de chave.** 115 MB presos em duas colunas são o
motivo de a migration de tipo não caber.

**(b) Tabela por tabela**, das pequenas para as grandes, deixando
`workspace_channel_orders` por último — só ela pede mais folga do que as outras
sete somadas.

## O que peço de decisão

1. Aprovar o **passo 1** (drop dos dois índices) como migration própria — ganho
   certo, risco baixo, reversível.
2. Aprovar o **passo 2** como janela de manutenção, com medição entre cada
   `REINDEX`.
3. Decidir se o **passo 3** vira ADR agora ou espera o desenho do expurgo do
   bronze. Minha recomendação: **espera** — sem o expurgo ele não cabe, e ADR que
   não pode ser executada vira dívida com aparência de plano.

📌 A migration do passo 1 **não foi criada em `migrations/`** de propósito: a 0022
ainda não foi aplicada, e duas migrations não aplicadas na árvore ao mesmo tempo
é exatamente o que o cérebro pediu para evitar. O DDL está acima, pronto.
