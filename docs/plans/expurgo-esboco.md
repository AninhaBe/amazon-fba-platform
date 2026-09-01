# Expurgo — esboço das opções

**Escrito em 01/09/2026 como preparação, não como plano aprovado.** Nada aqui foi
implementado. Existe para que, se a decisão sobre o plano pago for "não", o
desenho não comece do zero.

## O estado, medido

**470 MB de 500 — 30 MB de folga.** As maiores:

| tabela | total | do que é feita |
|---|---|---|
| `workspace_channel_orders` | **128 MB** | 41 MB são `raw`, **inline no heap** (TOAST de 8 kB) |
| `workspace_marketplace_orders` | **118 MB** | **93 MB são TOAST** — o `payload` do ML |
| `workspace_channel_order_fees` | 61 MB | 35 MB de índice para 24 MB de dado |
| `workspace_channel_order_items` | 51 MB | |
| `workspace_marketplace_shipments` | 42 MB | tem coluna `payload` |
| `workspace_marketplace_events` | 33 MB | fila, **já expurgada** |

`marketplace_events` **não é candidata**: 32.579 linhas, e só **26** acima de 30
dias. A retenção dela já funciona.

## 🔴 A restrição que elimina metade das opções óbvias

Está medida e é o que mais importa aqui:

> **`UPDATE ... SET payload = NULL` não devolve um byte de disco.** Cria tupla
> morta; o espaço volta ao mapa de espaço livre **daquela tabela** e
> `pg_database_size` não se mexe.

E as operações que devolveriam precisam de **cópia**, ou seja, de espaço que não
temos:

| operação | pico | temos |
|---|---|---|
| `VACUUM FULL` em `marketplace_orders` | ~118 MB | **30 MB** |
| `VACUUM FULL` em `channel_orders` | ~128 MB | 30 MB |
| `REINDEX` do `fees_pkey` | 35 MB | 30 MB |

**Nenhuma cabe.** Qualquer esboço que comece por "expurgar o bruto" e pare aí
entrega zero megabyte.

## O que devolve disco SEM cópia

Esta é a chave do desenho, e é o que separa as opções viáveis das inviáveis:

| operação | precisa de cópia? |
|---|---|
| `DROP TABLE` | **não** — libera na hora |
| `TRUNCATE` | **não** — libera na hora |
| `DELETE` + `VACUUM` comum | não libera ao SO |
| `VACUUM FULL`, `pg_repack`, `ALTER TYPE` | **sim** |
| `CREATE TABLE novo AS SELECT … ; DROP antigo; RENAME` | sim, mas só do **que fica** |

## As opções, da que cabe hoje à que não cabe

### Opção 1 — reconstrução por troca (`CREATE AS SELECT` + swap)

Em vez de esvaziar `payload` e tentar compactar depois, **cria-se a tabela nova já
sem o bruto antigo** e troca-se pela velha.

Pico = tamanho do que **fica**, não da tabela inteira. Para
`marketplace_orders`, mantendo o `payload` só dos últimos 60 dias:
118 MB − 49 MB ≈ **69 MB de pico**.

⚠️ **Ainda não cabe nos 30 MB.** Mas é a única forma que fica *perto*, e cabe
depois de qualquer ganho intermediário.

⚠️ **E o custo não é só espaço:** trocar tabela sob tráfego exige janela, e
qualquer escrita concorrente durante a cópia se perde. Não é operação de
madrugada distraída — é operação com a aplicação parada ou com trava.

### Opção 2 — recortar o histórico de verdade

Apagar **linhas**, não só o bruto delas. Candidatas por tamanho:
`marketplace_shipments` (42 MB) e o histórico antigo de pedidos.

⚠️ **Isto é decisão de produto, não minha:** define até onde o histórico da
vendedora existe. E `shipments` **não é descartável** — é lida em
`mercadoLivreSync.ts:628` e `mercadoLivre.ts:1275` para custo de frete. Apagá-la
tira número da tela, não lixo do disco.

### Opção 3 — plano pago

~US$ 25/mês. Destrava tudo de uma vez: com folga, a Opção 1 passa a caber, os
`REINDEX` passam a caber, e a migração de chave (`workspace_id` para `uuid`,
~28 MB) também. **É a única opção que não exige escolher o que perder.**

## A ordem, se a resposta for "não" ao plano pago

1. **Ganhar os primeiros megabytes sem cópia.** É o único jeito de destravar o
   resto. Candidatos: qualquer tabela inteira que se prove descartável — as duas
   mortas da migration 0025 já saem por `DROP` (584 kB, simbólico), e vale
   procurar outras com o mesmo rigor de prova (sem escritor, **sem leitor**,
   amostrado como taxa e não como acumulado).
2. **Reconstrução por troca da `marketplace_orders`**, assim que a folga chegar a
   ~70 MB. Devolve ~49 MB de uma vez e é o maior ganho isolado disponível.
3. **Depois dela, `REINDEX`** — que aí passa a caber e recupera o bloat medido
   (~50% do índice de `fees`).
4. **Só então** a migração de chave, que é o maior prêmio (~28 MB) e o maior pico.

## O que este esboço NÃO resolve, e precisa ser dito

⚠️ **O crescimento continua.** Entre 0,75 e 2,1 MB/dia, medido. Qualquer expurgo
compra tempo proporcional ao que devolveu — 49 MB compram de 23 a 65 dias. **Não
existe expurgo que resolva permanentemente**, porque o dado que chega é dado de
negócio, não lixo.

O que resolveria permanentemente é uma política de retenção **contínua** —
`payload` mais velho que N dias sendo anulado toda noite, com a reconstrução
periódica para devolver o espaço. Isso é a ADR-026 levada até o fim, e é desenho
próprio.

## Verificações pendentes antes de qualquer implementação

- `marketplace_shipments.payload` por idade — **não medi**. Se for como o do ML
  (velho e grande), entra na Opção 1 junto.
- Quem lê `marketplace_orders.payload` hoje, e a partir de que idade ninguém lê.
  A NF-e da Shopee lê `raw->invoice_data` (ADR-026); o equivalente do ML não foi
  levantado.
- Se a reconstrução por troca pode ser feita **por conexão** em vez da tabela
  inteira — isso reduziria o pico e permitiria fatiar em várias janelas curtas.
  **É a pergunta que eu investigaria primeiro**, porque transforma uma operação
  que não cabe em várias que cabem.

---

# As três verificações, fechadas em 01/09/2026

## A pergunta certa não era "por conexão" — era "quanto bruto fica"

A reconstrução por troca tem pico igual ao tamanho do que **fica**. Medido, para
`workspace_marketplace_orders`:

| tabela nova conteria | pico | cabe nos ~30 MB? |
|---|---|---|
| base **sem payload nenhum** | **25 MB** | ✅ |
| base + payload de **7 dias** | **27 MB** | ✅ |
| base + payload de **15 dias** | **30 MB** | ⚠️ no limite exato |
| base + payload de **30 dias** | **38 MB** | ❌ |
| base + payload de 60 dias | 51 MB | ❌ |
| base + payload inteiro (hoje) | 100 MB | ❌ |

**Fatiar por conexão não muda nada**: o pico é o tamanho do dado retido, e ele é o
mesmo somado em qualquer ordem. A variável que decide é a **janela de retenção**.

## E quem lê o payload define a janela mínima — não somos nós

Levantado: além do índice por `payload #>> '{shipping,id}'`, existe
`mercadoLivreSync.ts:605`, que faz `SELECT payload` **inteiro**, filtrado por
`occurred_at` **entre o início e o fim do período escolhido na tela**. É a fonte da
visão do Mercado Livre.

E a tela oferece **Hoje, 7, 15 e 30 dias** (`DashboardPeriodFilter.tsx:240`), mais
período personalizado por `?from=&to=`.

> **Logo, a janela mínima segura é 30 dias** — abaixo disso, escolher "30 dias" no
> filtro devolve visão vazia ou incompleta do ML.

## 🔴 O impasse, dito com precisão

| | cabe hoje | preserva a tela |
|---|---|---|
| reter 7 dias de payload | ✅ | ❌ quebra 15 e 30 dias |
| reter 30 dias de payload | ❌ (38 MB > 30) | ✅ |

**A operação que cabe quebra a tela; a que preserva a tela não cabe.** Faltam
~8 MB para a versão segura — e é por isso que o drop dos dois índices sem uso
(7,6 MB) deixou de ser paliativo e virou quase exatamente a diferença.

⚠️ **A saída que não é expurgo:** se a visão do ML lesse o **canônico** em vez do
`payload` bruto, a janela de retenção deixaria de ser ditada pela tela e o expurgo
ficaria livre. Isso é arquitetura — a mesma direção da ADR-001 — e não cabe neste
esboço.

## `marketplace_shipments`: não é candidata, e agora com número

24 MB de `payload`, e **zero bytes acima de 60 dias** — é tudo recente. Somado ao
fato de alimentar o custo de frete da tela, ela sai da lista por dois motivos
independentes.
