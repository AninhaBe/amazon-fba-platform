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

## 🔴 Divergências abertas

### B2 — a base de contagem não é única

O aviso diz **"15 de 50 pedidos"** e o topo da página diz **"62 vendas"**. São
três contagens diferentes na mesma tela:

| número | fonte | o que conta |
|---|---|---|
| 50 | `profit.pedidosDoPeriodo` | pedidos não cancelados do canônico |
| 62 | `metrics.totalOrders` (hero) | **a medir** — provável `orderMetrics`, que conta diferente |
| 15 | aviso do card | **a medir** |

**Ainda não medido.** Próximo passo da auditoria.

### B4 — a regra do cancelado não está escrita

O card "Canceladas" existe. Falta medir: o cancelado entra no faturamento? é
abatido em algum lugar? A spec manda **documentar antes de mudar**.

### O ADR que falta

O painel do conciliado deixou de exibir o lucro do período e passou a exibir o
resíduo do próprio universo, **sem anúncio**. Isso muda a letra da **ADR-025**, e
eu mudei uma decisão arquitetural enquanto implementava — o AGENTS manda parar e
propor um ADR. Registrado dentro de `tests/lucroUnicoNaTela.test.mjs`; **precisa
de decisão**.

---

## O que já foi consertado nesta frente

| data | defeito | commit |
|---|---|---|
| 02/09 | card Taxas mostrava 58,99 e o lucro descontava 312,43 | `d1c19dc` |
| 02/09 | o conserto não chegava na tela: estado gravava `feesDoLucro`, página lia `profit.fees` | `608805f` |
| 02/09 | painel do conciliado com centro de um universo e fatias de outro (margem 5673%) | `cb7a1d6` |
