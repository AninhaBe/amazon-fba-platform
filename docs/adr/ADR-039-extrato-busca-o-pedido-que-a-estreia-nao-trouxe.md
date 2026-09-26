# ADR-039 — O extrato busca o pedido que a estreia não trouxe

**Data:** 26/09/2026
**Status:** aceita — decisão da dona do produto (*"pode seguir com a c"*)
**Contexto medido:** primeiro cliente real do TikTok, conectado em 12/09/2026

## O problema: duas garantias corretas produziram um travamento

Duas regras deste projeto, cada uma certa no que promete:

1. **A estreia importa só o mês vigente** (decisão da dona, 27/08/2026,
   `tiktokSeedSyncWindow`): conta nova puxa do dia 1º do mês corrente e para, sem
   aprofundamento retroativo em background;
2. **O ledger recusa dinheiro sem pedido** (`upsertLedger`): transação cujo
   `order_id` não existe em `workspace_channel_orders` daquela conexão lança
   `TIKTOK_FINANCIAL_ORDER_ASSOCIATION_UNRESOLVED`.

O extrato de um dia liquida pedidos criados **dias ou semanas antes**. Para uma
conexão nova, muitos desses pedidos são anteriores ao dia 1º — ela não os tem e,
pela regra 1, nunca vai ter. Cada transação assim derruba a janela inteira; a
seleção retoma sempre a janela incompleta mais antiga; logo o pipeline **não sai
dela**.

Medido no único cliente real:

| | 20/09 | 26/09 |
|---|---|---|
| janela travada | 11→12/09 | a mesma |
| erros em `statements` | 176 | 299 |
| transações gravadas | 59 (todas estimadas) | 59 |
| pedidos | 1.863 | 2.461 |

**Pedido cresce, transação não.** Catorze dias, zero linha de extrato liquidado.

⚠️ **Atinge todo vendedor novo**, e piora quanto mais tarde no mês ele conectar.
Até 12/09 não existia conexão nascida pela regra de estreia — as duas regras
nunca tinham se cruzado.

## As alternativas, e por que a escolhida

| saída | preserva | custa | decisão |
|---|---|---|---|
| **a)** pular a linha órfã com diagnóstico | a janela anda | **perde dinheiro** de pedido antigo; em silêncio se o diagnóstico não for lido | recusada |
| **b)** gravar com `order_id` nulo | o valor | **quebra a associação** pedido↔dinheiro, que é o que torna a conciliação auditável | recusada |
| **c)** buscar o pedido que o extrato citou | **as duas garantias** | uma chamada por pedido citado que falta | **aceita** |

(a) e (b) escolhem qual garantia sacrificar. (c) não sacrifica nenhuma: nada se
perde e tudo fica associado.

## A decisão

Quando o extrato citar `order_id` que a conexão não tem, **buscar aquele pedido
na API e gravá-lo** pelo mesmo caminho canônico da varredura, antes de gravar a
transação.

**Dirigida, não alargamento de janela.** Traz só os ids que o extrato citou. Uma
conta com meses de histórico não vira varredura retroativa, e o custo é
proporcional ao que o dinheiro exige — não ao tamanho do passado.

### Onde ela roda, e por que aí

Entre o `read` da página e a transação que grava (`runPage`, gancho `prepare`).

⚠️ **Não dentro da transação.** A busca faz chamada externa, e rede dentro de
transação a mantém aberta pelo tempo da API — trocaria um travamento de
conciliação por um incidente de banco. A guarda
`tests/extratoBuscaPedidoQueFalta` reprova a inversão, com o fake marcando a
fronteira da transação (a primeira versão dele rodava inline e **não
distinguia** dentro de fora — a quebra revelou).

### O que ela reusa, e o que ela não toca

Reusa a ingestão canônica inteira: `getTiktokOrderDetail` no mesmo lote
(`ORDER_DETAIL_BATCH`), `validateTiktokOrderBatch`, a recusa de status
desconhecido (`TiktokUnmappedStatusError`), `validateTiktokOrderForSync` e
`saveCanonicalOrders` — upsert idempotente, dedupe por `external_order_id`.

**Não toca em estado de sync:** não avança cursor, não move
`covered_from`/`covered_to`, não faz checkpoint. Por isso dispensa o lease do
sync — que já foi liberado quando o financeiro roda — sem abrir a porta que o
lease protege: o que ele guarda é quem avança cobertura, e aqui ninguém avança.

## Consequências

✅ A janela travada completa e a seleção volta a andar sozinha até o dia corrente,
recuperando os dias parados — porque a janela agora fecha.

⚠️ **A tabela passa a ter pedido FORA do intervalo que `covered_*` declara.** Quem
ler cobertura como "tudo o que existe" lerá **menos** do que há — nunca mais. É
assimetria segura (a leitura subestima, não inventa), mas está escrita aqui porque
`covered_*` ganha um segundo significado na prática: "o que a varredura alcançou",
não "o que existe". Quem for usar cobertura para decidir completude precisa saber.

⚠️ **Custo de chamada proporcional ao extrato**, não ao histórico. No pior caso de
uma conta nova, o primeiro extrato pode citar muitos pedidos antigos de uma vez;
o lote é o mesmo da varredura e o `pageBudget` do scheduler continua limitando o
ciclo.

📌 **Isto não conserta a falta de alarme.** O travamento foi descoberto por levas
de documentação, em 20 e 26/09 — não por vigia. Um vigia de cobertura financeira
foi proposto e **cancelado pela dona do produto em 26/09**; fica registrado que a
lacuna é conhecida e a decisão de não preenchê-la é dela.

## Lição que generaliza

**Duas garantias locais corretas podem produzir um terceiro comportamento que
ninguém escolheu, e o lugar onde isso aparece é a fronteira entre dois
subsistemas** — aqui, a ingestão de pedido e o ledger financeiro. É a irmã de
*"replicar a garantia, não o mecanismo"* (AGENTS.md), vista por dentro de um mesmo
canal: cada lado replicou a garantia certa, e o encontro não tinha dono.

E o sintoma foi mudo pela mesma razão de sempre: **nada ficou vermelho.** O sync
de pedidos ficou verde, o vigia de defasagem ficou verde, e o que faltava — dia
que nunca virou janela — não tem `error_count` para envelhecer.
