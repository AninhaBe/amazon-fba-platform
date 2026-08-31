# Achado: a Amazon tem DUAS bases financeiras, e elas discordam na tela

- **Status:** achado registrado, **não corrigido**. A decisão é da vendedora.
- **Data:** 2026-08-30
- **Achado durante:** a entrega "o gasto com anúncio entra no lucro" (commit `1e1cdd1`)
- **Família:** a mesma de quando a Ana conferiu o NEXO contra outro software e os
  números não bateram. "Duas telas leem bases diferentes" explica aquela classe
  inteira, e por isso isto está em arquivo com nome e não só num relatório.

## O que foi medido

Conta real (`AO62LVXJMX3AA`), em 30/08/2026, mesmo workspace, mesmo canal:

| Superfície | Fonte financeira | Receita (30d) | Anúncio descontado |
|---|---|---|---|
| Dashboard da Amazon | canônico (`workspace_channel_orders` + `_fees`) | R$ 748,56 | **R$ 417,09** (Ads API) |
| Monitor e Home | Transactions API 2024-06-19 (`profit.ts`) | R$ 748,56 | **R$ 0,00** |

O zero do monitor não é defeito: o extrato da Transactions traz
**`AdvertisingFee: R$ 256,22`** no período, e esse valor **já saiu do repasse
líquido**. A guarda de dupla contagem (`anuncioJaNoExtrato`, em
`src/lib/anuncioDoCanal.ts`) viu a tarifa e não descontou a Ads API por cima —
exatamente o que ela existe para fazer.

**O problema é outro: os dois números do anúncio não são iguais.**

- Extrato (Transactions): **R$ 256,22** — só o que a Amazon já postou.
- Ads API: **R$ 417,09** — o que foi gasto de fato.

Resultado: **o monitor subestima o custo de anúncio em R$ 160,87** no período de
30 dias, porque confia na fonte que atrasa.

## E ele muda de comportamento conforme a janela

Medido no mesmo dia, mesma conta:

| Janela | `AdvertisingFee` no extrato? | O que o monitor desconta |
|---|---|---|
| Hoje (30/08) | não (ainda não postado) | **R$ 8,79**, da Ads API |
| Últimos 30 dias | sim (R$ 256,22) | **R$ 0,00** — a guarda desarma o desconto |

Ou seja: a mesma tela desconta anúncio por caminhos diferentes dependendo do
período escolhido. Nenhum dos dois está *errado* pela regra que existe hoje, e é
justamente isso que faz o achado ser sobre a REGRA e não sobre um defeito.

## O que NÃO é

- ⚠️ **Não é regressão da entrega de 30/08.** As duas bases já divergiam antes:
  a mesma medição pegou receita de R$ 680,24 (Transactions) contra R$ 719,66
  (canônico) no mesmo período, e isso é anterior ao anúncio entrar no lucro.
- **Não é a fronteira do anúncio quebrada.** A fronteira
  (`src/lib/financialMath.ts`) diz que `estimatedProfit` inclui o anúncio e que
  quem consome não subtrai de novo. Os dois produtores cumprem. Eles só têm
  **entradas diferentes**.

## A decisão que falta, e de quem ela é

**Qual fonte manda quando as duas falam?** Três caminhos, e nenhum é
obviamente certo:

1. **O extrato manda** (hoje). Vantagem: é dinheiro conciliado, o mesmo que o
   banco vê. Custo: atrasa, e o lucro sai otimista enquanto atrasa.
2. **A Ads API manda**, e a tarifa do extrato é ignorada. Vantagem: é o gasto
   real. Custo: exige subtrair do repasse o que já foi descontado nele, ou o
   dinheiro conta duas vezes — não é trocar uma constante, é reescrever a conta.
3. **O maior dos dois manda.** Barato de implementar e conservador no sentido
   certo (nunca subestima custo), mas é uma regra que ninguém pediu e que
   ninguém consegue explicar para um contador.

⚠️ **Isso é decisão da vendedora, não nossa.** É o mesmo tipo de escolha que ela
já tomou em 25/08 ("o card de lucro passa a descontar também o ads, isso é lucro
real"): o que conta como custo, e quando. Levar como pergunta técnica produziria
uma resposta técnica para uma pergunta de negócio.

## Como reproduzir

```
PROBE_WORKSPACE_ID=<workspace> node --env-file=.env.local \
  --experimental-strip-types --import ./scripts/ts-resolver.mjs \
  scripts/dashboard-diff-campo-a-campo.mjs capturar /tmp/foto.json
```

A foto traz `amazonOverview.profit.ads` e `amazonProfit.ads` lado a lado, além
de `amazonProfit.finance.feeBreakdown[*].type`, que é onde o `AdvertisingFee`
aparece.

---

# RESOLVIDO em 31/08/2026 — e o que sobrou

## A divergência acabou: uma definição só

`profit.ts` **deixou de calcular** o lucro e passou a **ler** o de
`amazonOverviewCanonical`. Antes eram duas fórmulas, e na conta da vendedora elas
discordavam em **R$ 292,16 no mesmo instante** — central +R$ 276,53, dashboard
−R$ 15,63. Depois do alinhamento, as duas devolvem o mesmo número, verificado
termo a termo (lucro, ads, imposto e COGS idênticos).

Os três caminhos possíveis que este documento listava caíram para um, e **não foi
decisão de negócio**: foi medição. As duas diferenças eram

1. **base** — `netProceeds` (repasse líquido, tardio) contra receita **bruta**, que
   é a base do card de Faturamento ao lado;
2. **anúncio** — `ProductAdsPayment` do extrato (só o **faturado**, R$ 256,22)
   contra a Ads API (o gasto real, R$ 428,88). Descontar o menor **inflava** o
   lucro.

## ⚠️ O ACHADO QUE SOBROU, E ELE É DELA: O ESTORNO NÃO ENTRA NO LUCRO

Medido no banco, em todo o histórico da Amazon:

| `fee_type` | ocorrências | total |
|---|---|---|
| `refund` | **123** | **R$ 3.091,33** |

`amazonOverviewCanonical.ts` exclui o estorno do `fees` **de propósito** —
estorno é devolução ao comprador, não tarifa, e somá-lo como tarifa contaria a
devolução como custo operacional. A exclusão está certa.

**Mas ele também não entra em nenhum outro termo da fórmula.** Resultado: os
R$ 3.091,33 devolvidos a compradores **não reduzem o lucro em tela nenhuma**.

⚠️ **Isto NÃO é consequência do alinhamento — já faltava nos DOIS produtores
antes dele.** Foi encontrado durante a enumeração dos `fee_type`, e deliberadamente
não corrigido junto: mudar o tratamento do estorno dentro de um lote que já
altera o lucro dela faria o número se mexer por dois motivos ao mesmo tempo, e
nenhum dos dois seria verificável.

**A pergunta é dela, e é uma só:** estorno reduz o resultado do período, ou é
tratado à parte? Só ela sabe como fecha o mês.

## O critério que ficou, e vale além deste caso

> **ENUMERAR ANTES DE MIGRAR.**

Antes de trocar a fórmula, foi listado *tudo* que existia dentro do `netProceeds`
em vez de assumir "netProceeds = vendas − tarifas". A lista trouxe um
`DebtRecovery` de **+R$ 119,50** que a fórmula assumida teria perdido em silêncio
— e que, medido, era o mesmo valor cobrado no cartão dela em 30/08, a pergunta
que estava sem resposta desde aquele dia.

Assumir a fórmula teria produzido um número errado que a gente chamaria de
"alinhamento". É o espelho da premissa *"a Amazon não tem imposto do vendedor"*:
lá se afirmou o que não se mediu; aqui se teria deixado de ver o que não se listou.

