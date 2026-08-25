# ADR-025: Anúncio é custo e entra no lucro — e mora fora do modelo canônico

- **Status:** Aceito
- **Data:** 2026-08-25

## Contexto

Em 25/08/2026 a candidatura da Amazon Ads API foi aprovada, 12 dias depois do
pedido. Pela primeira vez o gasto com publicidade ficou disponível por API.

O primeiro número medido inverteu o sinal do resultado da conta:

| | |
|---|---|
| Lucro exibido no dashboard (30 dias) | **R$ 295,65** · verde · margem 58,7% |
| Gasto com anúncio no mesmo período | **R$ 312,98** |
| Resultado real | **−R$ 17,33** |

O painel vinha afirmando margem de 58,7% numa operação que estava **no vermelho**.
Não era erro de cálculo — era ausência do maior custo variável da operação.

📌 O sintoma já tinha chegado por outro caminho: um colega olhou a tela e disse
*"a margem da Amazon tá errando algum cálculo, tipo tá 50%"*. Na época conferimos
a conciliação contra o CSV de transações e bateu ao centavo em 15 de 15 pedidos.
O cálculo estava certo; o **escopo** é que estava incompleto.

### Por que o card "Anúncios" que já existia não resolvia

Existia um card de anúncios desde antes, lendo `feeBreakdown` com o padrão
`/advertis|productads/`. Ele **nunca funcionou**, e ninguém tinha percebido
porque o modo de falha era silencioso: exibia `R$ 0,00` com o texto
*"Nenhuma despesa com anúncios no período"*.

Verificado em 25/08/2026 — os únicos `fee_type` gravados em
`workspace_channel_order_fees` são:

```
commission · refund · fulfillment
```

**Gasto com anúncio não é tarifa de pedido.** É cobrança de conta, e nunca vai
aparecer numa tabela indexada por `external_order_id`. O card procurava no lugar
errado e a ausência virava um zero afirmativo.

## Decisão

### 1. O card "Lucro" desconta anúncio

Decisão dela, em 25/08/2026: *"o card de lucro passa a descontar também o ads,
isso é lucro real"*.

```
Lucro = Faturamento − taxas − custo − imposto − anúncio
```

Margem e ROI derivam do **mesmo** número. Deixar margem positiva ao lado de lucro
negativo repetiria o defeito de 24/08, quando "Custo R$ 0,00" convivia com
"aguardando repasse" — dois cards vizinhos se contradizendo.

A composição vai escrita no contexto do card, componente por componente, para o
número não parecer líquido de coisas que não desconta.

### 2. Métricas de anúncio ficam FORA do modelo canônico (ADR-001)

Tabela própria: `workspace_ad_metrics`, uma linha por **dia × campanha**.

Publicidade não é canal de venda — não tem pedido, não tem item, não tem
comprador. Enfiar em `workspace_channel_orders` criaria um `provider` fantasma
que sync, overview e dashboard teriam de aprender a ignorar em todo lugar. É o
mesmo motivo pelo qual o token do Ads já não mora em `workspace_integrations`.

### 3. A tabela nasce agnóstica de canal

A coluna `provider` existe desde a primeira migration, com Amazon como primeiro
valor. Mercado Livre (Product Ads), TikTok (GMV Max) e Shopee (AdsManager) também
têm API de anúncio — pesquisado em 25/08/2026.

**O segundo canal tem de ser um `INSERT`, não uma tabela nova.** É a lição de
24/08, quando a regra de cobertura de estoque foi equalizada em dois canais e os
outros dois ficaram para trás.

### 4. A ingestão é assíncrona, em dois passos separados

O relatório da Ads API **não responde na hora**. Medido em 25/08/2026:

| Janela pedida | Tempo até `COMPLETED` |
|---|---|
| 30 dias, granularidade diária (81 linhas) | **~11 minutos** |
| 1 dia (6 linhas) | **105 segundos** |

Nenhuma tela espera por isso. Então:

```
pedirRelatorioDeAnuncios()   → cria na Amazon, grava o report_id
colherRelatoriosDeAnuncios() → busca os pendentes, grava quando ficar pronto
resumoDeAnuncios() / anunciosNoPeriodo()  → o que a tela lê, só do banco
```

Um ciclo do cron **colhe antes de pedir**: colher libera a vaga do
`MAX_PENDENTES`, então o relatório pronto é gravado e o próximo pedido na mesma
rodada. Invertido, seria metade da cadência de graça.

⚠️ `MAX_PENDENTES = 1` não é otimização. Um passo que pede sem colher **entope a
fila** — foi exatamente o que travou o extrato financeiro do TikTok por 85
rodadas em agosto, com o cron reportando sucesso o tempo todo.

### 5. `null ≠ 0` também vale para anúncio

Três estados distintos, três telas distintas:

| Situação | Tela |
|---|---|
| Sem conta de anúncio conectada | Lucro normal — quem não anuncia não fica travado esperando |
| Ads conectado, métrica **não** sincronizada | Lucro `—`. Gasto desconhecido não vira lucro otimista |
| Ads conectado, métrica presente | Lucro desconta anúncio |

### 6. O anúncio segue o MESMO período do resto do financeiro

`anunciosNoPeriodo(inicioISO, fimISO)` recebe a janela que o dashboard já usa. Se
o gasto fosse fixo em 30 dias, o filtro de 7 dividiria gasto de 30 por
faturamento de 7 e o TACOS sairia ~4× maior.

Medido em 25/08/2026, por janela:

| Filtro | Gasto | Venda do anúncio | ACOS |
|---|---|---|---|
| 7 dias | R$ 193,93 | R$ 161,35 | **120,2%** |
| 15 dias | R$ 312,98 | R$ 496,16 | 63,1% |
| 30 dias | R$ 312,98 | R$ 496,16 | 63,1% |

### 7. ACOS e TACOS são cards separados porque são perguntas separadas

| | Fórmula | Responde |
|---|---|---|
| **ACOS** | gasto ÷ venda **do anúncio** | o anúncio se paga? |
| **TACOS** | gasto ÷ faturamento **total** | quanto da operação o anúncio consome? |

ACOS pode estar ótimo enquanto o anúncio devora a operação inteira. Só o TACOS
mostra dependência de mídia — e foi ele que expôs os 52,9% desta conta.

Sem venda atribuída, ACOS é `—`, nunca `0%`: dividir por zero daria `Infinity`, e
"0,0%" diria que o anúncio saiu de graça. Os dois mentem.

### 8. Anúncio postado como tarifa não é descontado duas vezes

Se algum dia a Amazon postar anúncio como tarifa de pedido, o valor já entra em
`fees` e já saiu de `estimatedProfit`. O código detecta e **não** desconta a Ads
API por cima. Hoje nenhum `fee_type` casa com o padrão, mas a trava existe porque
o custo do engano é contar o mesmo dinheiro duas vezes.

## Consequências

**O número da tela piora, e isso é o ponto.** A margem da Amazon sai de 58,7%
para −2,9%. Quem lia o painel decidindo preço e compra de estoque estava
decidindo com um número que ignorava o maior custo variável da operação.

**Os outros três canais ficam devendo.** Enquanto ML, Shopee e TikTok não tiverem
ingestão de anúncio, o lucro deles continua sem esse desconto — e a comparação
entre canais fica injusta com a Amazon. Registrado no `TODO.md`.

**O filtro "Hoje" mostra gasto sem percentual.** O gasto do dia é real e já saiu
do bolso; a venda atribuída ao clique entra depois. Então o card exibe o valor
com o aviso *"Hoje ainda está somando"*, e ACOS/TACOS ficam `—` até fechar.

## O que esta entrega errou, para não repetir

**1. Afirmei sobre a Amazon sem medir.** Escrevi no código e mandei para produção
o texto *"A Amazon publica o gasto do dia só no dia seguinte"*. Testado no mesmo
dia: **falso** — um relatório de hoje voltou com 6 linhas, R$ 17,53 e 17 cliques,
em 105 segundos. O que era verdade é que *eu* tinha escolhido pedir até ontem
para o número não mudar durante o dia. Decisão de projeto virou afirmação sobre
terceiro. Registrado no changelog de `docs/amazon-ads.md`.

**2. Testei a regra e não testei a fiação.** O card foi para produção mostrando
`—` com o dado já gravado no banco. A rota devolvia `ads`; a página, que monta
`ProfitData` **campo a campo**, nunca lia. Os três campos são opcionais, então o
TypeScript compilou calado e os 687 testes passaram — todos cobriam a regra, e a
regra estava certa.

> **Regra pura testada não prova tela ligada.** Onde um objeto é montado campo a
> campo a partir de um payload, existe uma emenda que nenhum teste de unidade vê.
> Hoje há três testes cobrindo exatamente essa emenda.

**3. Entreguei infraestrutura quando o pedido era um card.** Migration aplicada
em produção, sync, testes — tudo antes de existir um pixel na tela, e sem ela ter
decidido. A cobrança foi direta: *"eu pedi o card apenas, você fez isso?"*. A
tabela era necessária (o relatório é assíncrono), mas a **ordem** foi escolha
minha, e mudança de schema em produção não é passo técnico óbvio.

## Referências

- `migrations/0012_metricas_de_anuncio.sql`
- `src/lib/integrations/amazonAdsSync.ts`
- `src/app/amazon/amazonFinancialCards.ts`
- `docs/amazon-ads.md` → "Changelog observado — Ads API"
- [ADR-001] modelo canônico · [ADR-016] ciclo de vida do dado · [ADR-020] definição única de faturamento
