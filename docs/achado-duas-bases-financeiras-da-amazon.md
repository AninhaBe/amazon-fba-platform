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
