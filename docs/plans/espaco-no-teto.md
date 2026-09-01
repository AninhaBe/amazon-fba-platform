# O banco bate no teto entre 15/09 e 10/10 — e o expurgo sozinho não salva

**Medido em 01/09/2026, produção, somente leitura.** Nada foi aplicado.

Encomendado pelo cérebro depois que a folga de **29 MB em 500** apareceu no meio
da recomendação de índice ([`indice-maior-que-a-tabela.md`](./indice-maior-que-a-tabela.md)).
Responde quatro perguntas: **quanto tempo falta**, **o que acontece ao bater**,
**o desenho do expurgo** e **os dois casos de escrita absurda**.

> A resposta curta, para quem não vai ler o resto: faltam **2 a 5 semanas**; a
> última vez que o teto foi ultrapassado o serviço **continuou de pé**; e o
> expurgo do bronze **não devolve disco** — toda operação que converteria espaço
> liberado em disco livre precisa de mais disco livre do que temos.

---

## (a) Quanto tempo falta

### Duas medições independentes, porque uma só enganaria

**Por ingestão** — linhas novas por dia × bytes por linha (heap + índice):

| tabela | linhas/dia (7d) | bytes/linha | MB/dia |
|---|---|---|---|
| `workspace_channel_orders` | 637 | 1.338 | 0,81 |
| `workspace_channel_order_fees` | ~898 (1,41/pedido) | 434 | 0,37 |
| `workspace_channel_order_items` | ~624 (0,98/pedido) | 543 | 0,32 |
| `workspace_marketplace_shipments` | ~147 | 1.161 | 0,16 |
| `workspace_marketplace_orders` | 147 | 835 | 0,12 |
| | | | **~1,8 MB/dia** |

Pela média de 30 dias (777 pedidos/dia em vez de 637) sobe para **~2,1 MB/dia**.

**Por pontos históricos** — o tamanho do banco registrado no próprio repositório:

| data | tamanho | fonte |
|---|---|---|
| 19/08/2026 | **559 MB** | ADR-016 (medição acidental) |
| 28/08/2026 | 468 MB | ADR-026, inventário L1 |
| 01/09/2026 | **471 MB** | esta medição |

De 28/08 a 01/09: **+3 MB em 4 dias = 0,75 MB/dia**.

**A divergência não é erro, é o autovacuum.** Páginas liberadas voltam ao mapa de
espaço livre da tabela e são reusadas, então o arquivo cresce mais devagar que o
dado lógico. O intervalo honesto é **0,75 a 2,1 MB/dia**.

### A data

Com **29 MB** de folga:

| ritmo | dias | teto em |
|---|---|---|
| 2,1 MB/dia | 14 | **15/09/2026** |
| 1,8 MB/dia | 16 | 17/09/2026 |
| 0,75 MB/dia | 39 | **10/10/2026** |

**Entre meados de setembro e o começo de outubro.** Não são três meses.

⚠️ **E a média esconde o risco real, que é o salto.** A ADR-016 registra que a
fila de webhooks do ML levou o banco de **526 para 559 MB no intervalo de uma
conversa** — 33 MB de uma vez, mais do que a folga inteira de hoje. A fila hoje
tem expurgo (261.487 inseridas contra 228.851 apagadas, 32.652 vivas) e está
estável, mas o mecanismo que produziu o salto continua existindo. **Planejar pela
média é planejar para o caso que não machuca.**

## (b) O que acontece quando bater

**Evidência do próprio projeto, não especulação:** em 19/08/2026 o banco foi
medido em **559 MB — 59 MB acima do teto** — e antes disso em 526 MB. Não há
registro de parada de serviço em nenhum dos dois momentos; a ADR-016 descreve a
medição como tendo sido feita *"por acidente, durante uma conversa sobre
hospedagem"*, o que só é possível se nada tinha quebrado.

**Conclusão que a evidência sustenta:** os 500 MB do plano Free não são um corte
duro de escrita no byte 500.000.001. Já passamos, e a operação seguiu.

**Conclusão que a evidência NÃO sustenta, e por isso não afirmo:** que passar de
novo seja seguro. Não sei qual é a política de cobrança/restrição vigente do
Supabase hoje, e não vou inventar. Uma degradação para somente-leitura é
exatamente o tipo de coisa que tem período de carência e depois deixa de ter.

🔴 **Passo que só a dona da conta pode dar, e que eu recomendo antes de qualquer
decisão de arquitetura:** abrir o painel do Supabase e ler o aviso de uso de
disco do projeto — ele diz, em texto do próprio fornecedor, o que acontece e
quando. Uma leitura de trinta segundos vale mais que qualquer estimativa minha.

## (c) O expurgo do bronze — desenho, e a má notícia

### O que existe

| coluna | tamanho | linhas | média |
|---|---|---|---|
| `workspace_marketplace_orders.payload` | **74 MB** (93 MB no TOAST) | 39.535 | 1.970 B |
| `workspace_channel_orders.raw` | **41 MB**, inline no heap | 99.420 | 714 B |

Por canal, dentro do `raw` canônico: Shopee 20 MB, TikTok 14 MB, Amazon 6,6 MB,
Mercado Livre praticamente zero.

**Não há duplicação.** Levantei a hipótese de que o bruto do ML estivesse guardado
duas vezes — as duas tabelas têm os mesmos 39.535 pedidos. **Está errada:** os
39.535 pedidos do ML no canônico têm `raw IS NULL`. O bruto do ML vive só em
`marketplace_orders.payload`. Registro porque a hipótese era boa e teria valido
74 MB se fosse verdade.

### Quanto volta por janela de retenção

| janela | `channel_orders.raw` | `marketplace_orders.payload` | total |
|---|---|---|---|
| acima de 30 dias | 28 MB | 61 MB | **89 MB** |
| acima de 60 dias | 11 MB | 49 MB | **60 MB** |
| acima de 90 dias | 4,6 MB | 35 MB | **40 MB** |

O ganho está quase todo no `payload` do ML. O `raw` canônico é dado recente: acima
de 90 dias sobram 4,6 MB, então expurgá-lo rende pouco e custa a mesma discussão.

### A janela defensável: 60 dias

Não é número redondo escolhido por gosto:

- **90 dias renderia só 40 MB** — pouco pelo risco.
- **30 dias é curto demais para reprocessar.** A Shopee só aceita consulta de
  pedidos em janelas de 15 dias (`docs/api-shopee.md`); refazer o canônico a
  partir da fonte, para um mês atrás, é caro e às vezes impossível. O bruto é a
  nossa única segunda chance.
- **60 dias cobre qualquer ciclo de conciliação** já visto no projeto e devolve
  49 MB do ML mais 11 MB do canônico.

### O bloqueio já conhecido, agora com número

A ADR-026 registra que o expurgo está travado porque estado do produto mora
dentro do bruto. Medido: **13.380 de 99.420 linhas** têm `_sellercore` dentro do
`raw`, e **6.936** têm `invoice_data` — é a faixa "pedido aguardando NF-e", que
lê dali. Apagar o `raw` dessas linhas apaga pendência operacional viva da tela.

Ordem obrigatória: **migrar `_sellercore` e `invoice_data` para colunas próprias
antes** (recomendação R2 da frente L, já registrada na ADR-026), e só então
`SET raw = NULL` — nunca `'{}'`, pela regra 1 da mesma ADR.

### 🔴 A má notícia, e é a parte importante deste documento

**`UPDATE ... SET payload = NULL` não devolve um byte de disco.** Ele cria tupla
morta; o espaço volta para o mapa de espaço livre **daquela tabela**, e
`pg_database_size` não se mexe. Para devolver ao sistema de arquivos é preciso
`VACUUM FULL` ou `pg_repack` — que **reescrevem a tabela e precisam de espaço
para a cópia nova enquanto a velha existe**.

E aí a conta não fecha:

| operação | pico de disco necessário | temos |
|---|---|---|
| `VACUUM FULL workspace_marketplace_orders` | ~75 MB (124 MB menos o expurgado) | 29 MB |
| `VACUUM FULL workspace_channel_orders` | 127 MB | 29 MB |
| `REINDEX` do `fees_pkey` | 34 MB | 29 MB |
| `ALTER COLUMN TYPE` em `channel_orders` | 127 MB | 29 MB |

**Nenhuma cabe.** E pior: mesmo que o expurgo liberasse espaço dentro do TOAST de
`marketplace_orders`, esse espaço só é reusável **por aquela tabela** — o
crescimento diário acontece majoritariamente em `channel_orders`, que não pode
aproveitá-lo.

**Conclusão que eu preciso dizer com todas as letras, mesmo não sendo a que eu
gostaria de trazer:** com 29 MB de folga, o problema de espaço **não tem solução
puramente técnica dentro do plano atual**. A única operação que devolve disco de
verdade e cabe hoje é o drop dos dois índices sem uso — **7,6 MB**, que compra
cerca de **quatro a dez dias**.

### As saídas reais, para decisão de quem decide

1. **Plano pago.** Supabase Pro, ~US$ 25/mês, já avaliado em
   `docs/infra-decisao-hospedagem.md`. Destrava tudo o resto de uma vez: com
   folga, o expurgo, o `VACUUM FULL`, os `REINDEX` e a migração de chave passam
   a caber e devolvem ~180 MB. **É a minha recomendação.** É decisão de custo, e
   portanto da Ana, não minha.
2. **Reduzir dado de verdade** — apagar linhas antigas, não só o bruto delas.
   `workspace_marketplace_shipments` (42 MB) e a fila `marketplace_events`
   (33 MB) são candidatas antes de qualquer pedido. É decisão de produto: define
   até onde o histórico da vendedora vive.
3. **Ganhar dias com o que cabe** — drop dos dois índices (+7,6 MB) e
   `VACUUM FULL` nas tabelas pequenas, acumulando folga até a primeira grande
   caber. É paliativo, e ele fica pequeno depressa.

## (d) Os dois casos de escrita absurda — e por que eles NÃO são a emergência

| tabela | updates em 63 dias | linhas vivas | tamanho |
|---|---|---|---|
| `workspace_marketplace_overview_snapshots` | **2.986.272** | **12** | 552 kB |
| `workspace_marketplace_syncs` | **1.179.081** | **14** | 96 kB |

São 249 mil atualizações por linha na primeira. Mas **as duas tabelas somam
648 kB** — o autovacuum dá conta, e elas não ocupam espaço.

**Portanto isto não é problema de disco, e eu não vou tratá-lo como se fosse.**
É custo contínuo de WAL, de I/O e de trabalho de autovacuum — que importa para
latência e para o consumo de recursos do plano, não para o teto de 500 MB.

Fica registrado como item para o backend, que está justamente no agendador, com a
pergunta certa: *o que reescreve a linha inteira do snapshot a cada ciclo, e dá
para condicionar a escrita a ter havido mudança?* Um `UPDATE` que só grava quando
o valor muda — o padrão `WHERE ... IS DISTINCT FROM` que a própria
`amazonTarifaEstimada.ts` já usa — costuma matar 90% desse volume.

## O que peço de decisão

1. **A leitura do painel do Supabase** (só a Ana pode) — define se temos carência
   ou não, e muda a urgência de tudo.
2. **Plano pago sim ou não.** Se sim, o resto do plano técnico volta a fazer
   sentido na ordem que já está escrita. Se não, é preciso decidir *o que apagar*,
   e isso é decisão de produto sobre o histórico da vendedora.
3. **Autorização do drop dos dois índices** já está dada — ele vale os 7,6 MB
   mesmo sendo paliativo, e é o único ganho que cabe hoje.
