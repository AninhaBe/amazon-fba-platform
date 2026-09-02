# Auditoria do dashboard da Amazon — todo número, sua fonte e sua equação

**Por que este documento existe.** Em 01–02/09/2026 a vendedora achou **cinco**
defeitos de coerência em dois dias, um por vez, cada um num print. Consertar de
um em um fez dela a auditora do produto — palavra dela: *"você falha toda hora
todo dia, assim fica difícil"*. Este documento enumera **todo** número visível da
tela, diz de que **fonte** e de que **universo** ele vem, e registra a **equação**
que ele precisa fechar. A próxima divergência tem de aparecer aqui, não no print
dela.

Gerado e conferido por `scripts/auditar-dashboard-amazon.mjs`.

---

## Os três universos

A família inteira de defeitos vem de misturar estes três. Nenhum é errado; o
errado é somar números de universos diferentes na mesma conta.

| universo | o que é | quem define |
|---|---|---|
| **TOTAL** | todo pedido não cancelado do período, **pendentes inclusos** | decisão dela, 31/08: *"o lucro tem que ser em cima do Faturamento"*. Vem do `orderMetrics` |
| **CONCILIADO** | só o pedido cujo repasse a Amazon já postou | o painel "Repasses, taxas e lucro" declara isso no próprio subtítulo |
| **PERÍODO** | custo sem atribuição por pedido — hoje só o **anúncio** | a Ads API entrega por dia, nunca por pedido |

⚠️ **Anúncio não pertence a TOTAL nem a CONCILIADO.** Ele entra no lucro do
período (cards) e fica **fora** do painel do conciliado — se entrasse, quebraria a
igualdade `centro = fatias`. É por isso que o resultado do painel se chama
"Resultado dos repasses" e não "Lucro": dois nomes diferentes para dois números
legitimamente diferentes.

---

## A tabela

Medido em 02/09/2026, período 01/09–01/09, conexão `amazon:A15NQMF7A6J1Y0`.

| número na tela | fonte | universo | valor medido |
|---|---|---|---|
| Faturamento (card) | `profit.revenueDoLucro` | TOTAL | 1.665,54¹ |
| **Taxas (card)** | `profit.fees` | TOTAL | **487,77** |
| └ oficial | `fees − feesEstimadas` | TOTAL | 58,99 |
| └ estimada | `profit.feesEstimadas` | TOTAL | 428,78 |
| Custo (card) | `profit.cogs` | TOTAL | 446,50¹ |
| Impostos (card) | `profit.taxes` | TOTAL | 0,00 |
| Estornos (card) | `profit.refunds` | TOTAL | — |
| Ads (card) | `profit.ads` | PERÍODO | 0,00 |
| Lucro (card) | `profit.estimatedProfit` | TOTAL | 731,27¹ |
| Margem (card) | lucro ÷ base | TOTAL | — |
| Painel: centro | `composicaoDoConciliado.receita` | CONCILIADO | 12,89 |
| Painel: taxas | `composicaoDoConciliado.tarifa` | CONCILIADO | 7,45 |
| Painel: custo | `composicaoDoConciliado.custo` | CONCILIADO | 2,42 |
| Painel: resultado | `composicaoDoConciliado.lucro` | CONCILIADO | 3,02 |
| Painel: margem | resultado ÷ centro | CONCILIADO | 23,43% |
| Pedidos do período | `profit.pedidosDoPeriodo` | TOTAL | 50 |
| Pedidos com valor | `profit.pedidosComValor` | TOTAL | 50 |
| Pedidos sem valor | `profit.pedidosSemValor` | TOTAL | 0 |
| Pedidos com estimativa | `profit.pedidosComTarifaEstimada` | TOTAL | 42 |
| Pedidos do painel | `composicaoDoConciliado.pedidos` | CONCILIADO | 1 |
| Linhas de rentabilidade | `profitabilityLines.length` | TOTAL | 50 |
| Unidades sem custo | `profit.unitsWithoutCost` | TOTAL | 0 |

¹ medido com o faturamento injetado; a execução do script sem credencial cai no
piso do banco e mostra `—`.

---

## As equações

| equação | estado |
|---|---|
| cards: faturamento − custo − taxas − imposto − estorno − ads = lucro | **FECHA** (1.665,54 − 446,50 − 487,77 = 731,27) |
| painel: taxas + custo + resultado = centro | **FECHA** (7,45 + 2,42 + 3,02 = 12,89) |
| card Taxas = oficial + estimada | **FECHA** (58,99 + 428,78 = 487,77) |
| pedidos: com valor + sem valor = do período | **FECHA** (50 + 0 = 50) |
| painel: pedidos do painel ≤ pedidos com valor | **FECHA** (1 ≤ 50) |
| margem do card = lucro ÷ base | **FECHA** |
| margem do painel = resultado ÷ centro | **FECHA** (23,43%) |

---

## Divergências: estado

### B2 — a base de contagem não é única — **MEDIDO**

As três contagens da tela existem, são diferentes **de propósito**, e a relação
entre elas é exata:

| número | fonte | conta | medido 01/09 |
|---|---|---|---|
| "vendas" (hero) | `metrics.totalOrders` | **todos** os status, cancelado incluso | 54 |
| pedidos do período | `profit.pedidosDoPeriodo` | não cancelados | 50 |
| cancelados | `cancelledOrders` | só cancelados | 4 |
| aviso da tarifa | `pedidosComTarifaEstimada` | os que têm tarifa estimada | 42 |

**54 − 4 = 50, ao centavo.** Nenhum número está errado: o hero conta o que a
Amazon chama de venda (com cancelado), e o lucro conta o que rende (sem).

⚠️ **O defeito é de RÓTULO, não de conta.** A tela chama os dois de "pedidos" e
não diz que um inclui cancelado e o outro não — por isso "15 de 50" ao lado de
"62 vendas" parece contradição. O conserto é **nomear**, como manda a ADR-028:
o hero diz "vendas (inclui canceladas)" e o aviso diz de quantos **do período**
ele fala.

### B4 — a regra do cancelado — **MEDIDA E ESCRITA**

Medido em 01/09: 4 pedidos cancelados, R$ 51,70 de valor de tabela; o card
"Canceladas" exibia R$ 22,90 num recorte anterior.

**A regra, como o código a implementa hoje:**

1. cancelado **não entra** no faturamento (`revenueDoLucro` filtra
   `status <> 'cancelled'`);
2. cancelado **não entra** no custo nem na tarifa — as duas consultas usam o
   mesmo filtro;
3. cancelado **não é abatido** de lugar nenhum. O card "Canceladas" fica **ao
   lado**, informando, e não participa de nenhuma equação;
4. o valor exibido ali é o **preço de tabela** capturado antes do cancelamento
   (`ordered_gross`), porque a Amazon zera o `gross` ao cancelar.

Isso já satisfaz a spec — *"cancelado antes do envio não deve gerar comissão nem
entrar no faturamento realizado"*. **Nada a mudar; faltava estar escrito.**

### O ADR — **DECIDIDO**

`ADR-028 — Cada bloco exibe o resíduo do universo que declara`, emenda à ADR-025.
Todo bloco fecha no universo que declara, o resultado é o resíduo, a margem sai
do próprio centro, e nomes distintos para números de universos distintos. O
anúncio sai do painel do conciliado por não ter atribuição por pedido — e o
propósito da ADR-025 continua atendido pelo NOME, não pelo valor.

---

## O que já foi consertado nesta frente

| data | defeito | commit |
|---|---|---|
| 02/09 | card Taxas mostrava 58,99 e o lucro descontava 312,43 | `d1c19dc` |
| 02/09 | o conserto não chegava na tela: estado gravava `feesDoLucro`, página lia `profit.fees` | `608805f` |
| 02/09 | painel do conciliado com centro de um universo e fatias de outro (margem 5673%) | `cb7a1d6` |
